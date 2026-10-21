"""FFmpeg/ffprobe bosqichlari: probe -> validatsiya -> HLS (720p, 480p) -> thumbnail -> 9:16 MP4.

Funksiyalar faqat lokal fayllar bilan ishlaydi (storage va navbatdan mustaqil) — testlarda to'g'ridan-to'g'ri
chaqiriladi. Telefon videolaridagi aylantirish (display matrix) FFmpeg'ning autorotate'i bilan qo'llanadi,
shuning uchun barcha o'lchamlar *ko'rinadigan* (display) o'lchamlarda hisoblanadi.
"""

from __future__ import annotations

import json
import math
import re
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

from .errors import JobError, RetryableError

ALLOWED_FORMATS = ("mov", "mp4")
#: Telefon yozuvi konteyner davomiyligida bir oz farq qilishi mumkin
DURATION_TOLERANCE_MS = 1_000
MIN_DURATION_MS = 500


@dataclass(frozen=True)
class Probe:
    format_name: str
    duration_ms: int
    size_bytes: int
    bit_rate: int | None
    video_codec: str
    coded_width: int
    coded_height: int
    rotation: int
    width: int
    """Ko'rinadigan kenglik (aylantirish hisobga olingan)."""
    height: int
    fps: float
    has_audio: bool
    audio_codec: str | None

    def summary(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class RenditionSpec:
    name: str
    width: int
    height: int
    video_kbps: int
    audio_kbps: int
    level: str
    codecs: str


#: highlight_v1 ladder: qisqa tomon bo'yicha (portret 720x1280, landshaft 1280x720)
LADDER = (
    ("720p", 720, 2_500, 128, "4.0", "avc1.4d4028,mp4a.40.2"),
    ("480p", 480, 1_200, 96, "3.1", "avc1.4d401f,mp4a.40.2"),
)

VERTICAL_SIZE = (720, 1280)
THUMB_SHORT_SIDE = 720


def _even(v: float) -> int:
    return max(2, int(round(v / 2)) * 2)


def run(args: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
    """FFmpeg'ni ishga tushiradi. Signal bilan o'ldirilgan (OOM) yoki timeout — qayta urinish mumkin."""
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as e:
        raise RetryableError(f"{args[0]} timeout ({timeout}s)") from e
    if proc.returncode < 0:
        raise RetryableError(f"{args[0]} signal {-proc.returncode} bilan to'xtadi")
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()[-5:]
        raise RetryableError(f"{args[0]} exit {proc.returncode}: {' | '.join(tail)}")
    return proc


def _rotation(stream: dict) -> int:
    for sd in stream.get("side_data_list") or []:
        if "rotation" in sd:
            return int(round(float(sd["rotation"]))) % 360
    tag = (stream.get("tags") or {}).get("rotate")
    return int(tag) % 360 if tag else 0


def _fps(stream: dict) -> float:
    for key in ("avg_frame_rate", "r_frame_rate"):
        v = stream.get(key) or "0/0"
        num, _, den = v.partition("/")
        try:
            if float(den or 1) > 0 and float(num) > 0:
                return round(float(num) / float(den or 1), 3)
        except ValueError:
            continue
    return 0.0


def probe(path: Path) -> Probe:
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, text=True, timeout=60, check=False,
        )
    except subprocess.TimeoutExpired as e:
        raise RetryableError("ffprobe timeout") from e
    if proc.returncode != 0:
        raise JobError("NOT_A_VIDEO", (proc.stderr or "").strip()[-300:])
    data = json.loads(proc.stdout or "{}")
    fmt = data.get("format") or {}
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")), None)
    if video is None:
        raise JobError("NOT_A_VIDEO", "video oqimi yo'q")
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    rotation = _rotation(video)
    cw, ch = int(video.get("width") or 0), int(video.get("height") or 0)
    w, h = (ch, cw) if rotation in (90, 270) else (cw, ch)
    duration = float(fmt.get("duration") or video.get("duration") or 0)
    return Probe(
        format_name=str(fmt.get("format_name") or ""),
        duration_ms=int(round(duration * 1000)),
        size_bytes=int(fmt.get("size") or path.stat().st_size),
        bit_rate=int(fmt["bit_rate"]) if fmt.get("bit_rate") else None,
        video_codec=str(video.get("codec_name") or ""),
        coded_width=cw,
        coded_height=ch,
        rotation=rotation,
        width=w,
        height=h,
        fps=_fps(video),
        has_audio=audio is not None,
        audio_codec=str(audio.get("codec_name")) if audio else None,
    )


def validate(p: Probe, max_duration_ms: int, max_bytes: int) -> None:
    """Kontrakt cheklovlari (≤ 60 s, ≤ 150 MB, mp4/mov). Buzilsa — qayta urinish ma'nosiz."""
    if not any(f in p.format_name.split(",") for f in ALLOWED_FORMATS):
        raise JobError("UNSUPPORTED_FORMAT", p.format_name)
    if p.width < 16 or p.height < 16:
        raise JobError("NOT_A_VIDEO", f"o'lcham {p.width}x{p.height}")
    if p.duration_ms > max_duration_ms + DURATION_TOLERANCE_MS:
        raise JobError("DURATION_TOO_LONG", f"{p.duration_ms} ms > {max_duration_ms} ms")
    if p.duration_ms < MIN_DURATION_MS:
        raise JobError("DURATION_TOO_SHORT", f"{p.duration_ms} ms")
    if p.size_bytes > max_bytes:
        raise JobError("FILE_TOO_LARGE", f"{p.size_bytes} bayt")


def plan_renditions(p: Probe) -> list[RenditionSpec]:
    """Upscale yo'q: manbaning qisqa tomonidan katta rendition'lar tashlanadi; juda kichik manba — bitta asl o'lchamda."""
    short, long_ = min(p.width, p.height), max(p.width, p.height)
    out: list[RenditionSpec] = []
    for name, target, vk, ak, level, codecs in LADDER:
        if short < target * 0.9:
            continue
        s = min(target, short)
        l_ = _even(long_ * s / short)
        w, h = (s, l_) if p.width <= p.height else (l_, s)
        out.append(RenditionSpec(name, _even(w), _even(h), vk, ak, level, codecs))
    if not out:
        name, _, vk, ak, level, codecs = LADDER[-1]
        out.append(RenditionSpec(name, _even(p.width), _even(p.height), vk, ak, level, codecs))
    return out


def _x264(preset: str, threads: int) -> list[str]:
    return ["-c:v", "libx264", "-preset", preset, "-pix_fmt", "yuv420p", "-threads", str(threads), "-fpsmax", "30"]


def _audio(p: Probe, kbps: int) -> list[str]:
    return ["-c:a", "aac", "-b:a", f"{kbps}k", "-ac", "2", "-ar", "48000"] if p.has_audio else ["-an"]


def encode_hls(src: Path, out_dir: Path, p: Probe, spec: RenditionSpec, preset: str = "veryfast", threads: int = 0) -> Path:
    """Bitta rendition: H.264 Main + AAC, MPEG-TS segmentlar ~4 s, keyframe har 2 s (rendition'lar o'rtasida mos)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    playlist = out_dir / "index.m3u8"
    run([
        "ffmpeg", "-y", "-v", "error", "-i", str(src),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", f"scale={spec.width}:{spec.height}:flags=bicubic,setsar=1",
        *_x264(preset, threads),
        "-profile:v", "main", "-level:v", spec.level,
        "-b:v", f"{spec.video_kbps}k", "-maxrate", f"{int(spec.video_kbps * 1.07)}k", "-bufsize", f"{int(spec.video_kbps * 1.5)}k",
        "-force_key_frames", "expr:gte(t,n_forced*2)", "-sc_threshold", "0",
        *_audio(p, spec.audio_kbps),
        "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments",
        "-hls_segment_type", "mpegts", "-hls_segment_filename", str(out_dir / "seg_%03d.ts"),
        str(playlist),
    ])
    return playlist


def parse_playlist(playlist: Path) -> list[tuple[str, float]]:
    """[(segment, davomiylik_s)] — BANDWIDTH hisoblash va testlar uchun."""
    segs: list[tuple[str, float]] = []
    dur: float | None = None
    for line in playlist.read_text().splitlines():
        line = line.strip()
        m = re.match(r"#EXTINF:([\d.]+)", line)
        if m:
            dur = float(m.group(1))
        elif line and not line.startswith("#") and dur is not None:
            segs.append((line, dur))
            dur = None
    return segs


def peak_bandwidth(playlist: Path) -> int:
    """HLS BANDWIDTH = eng og'ir segmentning bit/s (+10%)."""
    peak = 0.0
    for name, dur in parse_playlist(playlist):
        size = (playlist.parent / name).stat().st_size
        if dur > 0:
            peak = max(peak, size * 8 / dur)
    return int(math.ceil(peak * 1.1)) or 1


def codecs(spec: RenditionSpec, has_audio: bool) -> str:
    return spec.codecs if has_audio else spec.codecs.split(",")[0]


def write_master(path: Path, entries: list[tuple[RenditionSpec, int]], has_audio: bool = True) -> None:
    lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS"]
    for spec, bw in sorted(entries, key=lambda e: -e[1]):
        lines += [
            f'#EXT-X-STREAM-INF:BANDWIDTH={bw},RESOLUTION={spec.width}x{spec.height},CODECS="{codecs(spec, has_audio)}"',
            f"{spec.name}/index.m3u8",
        ]
    path.write_text("\n".join(lines) + "\n")


def thumbnail(src: Path, dst: Path, p: Probe) -> tuple[int, int]:
    """Kadr: min(1 s, o'rta) — boshidagi qora kadrdan qochish."""
    at = min(1.0, p.duration_ms / 2000)
    short = min(p.width, p.height)
    s = min(THUMB_SHORT_SIDE, short)
    w, h = (s, _even(p.height * s / p.width)) if p.width <= p.height else (_even(p.width * s / p.height), s)
    w, h = _even(w), _even(h)
    dst.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{at:.3f}", "-i", str(src), "-frames:v", "1",
         "-vf", f"scale={w}:{h}:flags=bicubic", "-q:v", "3", str(dst)], timeout=120)
    return w, h


def vertical_crop(p: Probe) -> tuple[int, int, int, int]:
    """Markazdan 9:16 crop (w, h, x, y) ko'rinadigan kadrda."""
    if p.width * 16 > p.height * 9:  # kengroq -> yon tomonlar kesiladi
        h = p.height - (p.height % 2)
        w = min(p.width - (p.width % 2), _even(h * 9 / 16))
    else:  # balandroq -> tepa/past kesiladi
        w = p.width - (p.width % 2)
        h = min(p.height, _even(w * 16 / 9))
    return w, h, (p.width - w) // 2, (p.height - h) // 2


def encode_vertical(src: Path, dst: Path, p: Probe, preset: str = "veryfast", threads: int = 0) -> tuple[int, int]:
    """Reels/Telegram uchun 9:16 MP4 (720x1280, faststart)."""
    w, h, x, y = vertical_crop(p)
    ow, oh = VERTICAL_SIZE
    dst.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-y", "-v", "error", "-i", str(src),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", f"crop={w}:{h}:{x}:{y},scale={ow}:{oh}:flags=bicubic,setsar=1",
        *_x264(preset, threads), "-profile:v", "high", "-crf", "23", "-maxrate", "3500k", "-bufsize", "7000k",
        *_audio(p, 128), "-movflags", "+faststart", str(dst),
    ])
    return ow, oh
