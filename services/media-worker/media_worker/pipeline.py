"""Qayta ishlash profillari (job `profile`):

  * `highlight_v1` — host klipi: download -> probe -> validate -> hls (720p/480p) -> thumbnail -> vertical -> upload;
  * `recording_v1` — to'liq o'yin (AI-Cam A): download -> probe -> validate -> hls (1080p/720p/480p, bitta o'tish)
    -> thumbnail (60-soniya) -> upload; 9:16 yo'q (markazdan crop butun maydon uchun ma'nosiz);
  * `clip_v1` — host belgisidan klip: cut (yozuv HLS'idan faqat kerakli segmentlar yuklanadi, ulanib aniq kesiladi)
    -> keyin `highlight_v1` bilan bir xil. Kesilgan manba `source.mp4` sifatida natijalar bilan yuklanadi.

Idempotentlik:
  * har bosqich natijasi ish papkasida (`work/<job_id>/`) va `.done-<stage>` belgisi bilan — bir container ichida
    qayta urinishda tugagan bosqichlar o'tkazib yuboriladi;
  * chiqish kalitlari deterministik (`<prefix>hls/720p/index.m3u8`, ...) — qayta yuklash xavfsiz ustiga yozish;
  * `<prefix>manifest.json` oxirida yoziladi: boshqa worker xabarni qayta olsa (API'ga natija yetmay qolgan),
    qayta kodlamasdan manifest'dagi natijani yuboradi.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
from collections.abc import Callable
from pathlib import Path

from . import WORKER_VERSION, ffmpeg
from .errors import JobError
from .storage import Storage

log = logging.getLogger("media_worker.pipeline")

HIGHLIGHT = "highlight_v1"
RECORDING = "recording_v1"
CLIP = "clip_v1"
PROFILES = (HIGHLIGHT, RECORDING, CLIP)
#: Yozuv thumbnail'i — o'yin boshlangandan keyingi kadr (boshida odatda shtativ o'rnatilmoqda)
RECORDING_THUMB_AT_S = 60.0
Progress = Callable[[str], None]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Pipeline:
    def __init__(self, storage: Storage, work_root: Path, preset: str = "veryfast", threads: int = 0) -> None:
        self.storage = storage
        self.work_root = work_root
        self.preset = preset
        self.threads = threads

    def workdir(self, job_id: str) -> Path:
        return self.work_root / job_id

    def cleanup(self, job_id: str) -> None:
        shutil.rmtree(self.workdir(job_id), ignore_errors=True)

    def run(self, job: dict, progress: Progress = lambda _s: None) -> dict:
        """`job` — `POST /internal/media/jobs/{id}/start` javobi. Natija — API `result.output`."""
        profile = job.get("profile", HIGHLIGHT)
        if profile not in PROFILES:
            raise JobError("UNSUPPORTED_PROFILE", str(profile))
        recording = profile == RECORDING
        out_bucket, prefix = job["output"]["bucket"], job["output"]["prefix"]
        media = job["media"]

        manifest = self.storage.get_json(out_bucket, prefix + "manifest.json")
        if manifest and manifest.get("profile") == profile and manifest.get("source_size") == media.get("size_bytes"):
            log.info("job %s: manifest bor — qayta kodlanmaydi", job["job_id"])
            return manifest["output"]

        work = self.workdir(job["job_id"])
        out = work / "out"
        work.mkdir(parents=True, exist_ok=True)

        def step(name: str, fn: Callable[[], object]) -> None:
            marker = work / f".done-{name}"
            if marker.exists():
                return
            progress(name)
            fn()
            marker.touch()

        if profile == CLIP:
            src = out / "source.mp4"
            step("cut", lambda: self.cut(job["source"], work / "clip-src", src))
        else:
            src = work / ("source" + Path(job["source"]["key"]).suffix.lower())

            def download() -> None:
                self.storage.download(job["source"]["bucket"], job["source"]["key"], src)
                expected = media.get("checksum_sha256")
                if expected and sha256_file(src) != expected.lower():
                    raise JobError("CHECKSUM_MISMATCH", "sha256 client e'lon qilgani bilan mos emas")

            step("download", download)

        probe_file = work / "probe.json"

        def do_probe() -> None:
            probe_file.write_text(json.dumps(ffmpeg.probe(src).summary()))

        step("probe", do_probe)
        p = ffmpeg.Probe(**json.loads(probe_file.read_text()))

        step("validate", lambda: ffmpeg.validate(p, job["limits"]["max_duration_ms"], job["limits"]["max_bytes"]))

        specs = ffmpeg.plan_renditions(p, ffmpeg.RECORDING_LADDER if recording else ffmpeg.LADDER)

        def hls() -> None:
            if recording:
                playlists = ffmpeg.encode_hls_multi(src, out / "hls", p, specs, self.preset, self.threads)
                entries = [(spec, ffmpeg.peak_bandwidth(pl)) for spec, pl in zip(specs, playlists)]
            else:
                entries = []
                for spec in specs:
                    pl = ffmpeg.encode_hls(src, out / "hls" / spec.name, p, spec, self.preset, self.threads)
                    entries.append((spec, ffmpeg.peak_bandwidth(pl)))
            ffmpeg.write_master(out / "hls" / "master.m3u8", entries, p.has_audio)
            (work / "renditions.json").write_text(json.dumps([[s.__dict__, bw] for s, bw in entries]))

        step("hls", hls)
        step("thumbnail", lambda: ffmpeg.thumbnail(src, out / "thumb.jpg", p, RECORDING_THUMB_AT_S if recording else 1.0))
        if not recording:
            step("vertical", lambda: ffmpeg.encode_vertical(src, out / "vertical.mp4", p, self.preset, self.threads))

        def upload() -> None:
            files = sorted(f for f in out.rglob("*") if f.is_file())
            # Playlist'lar segmentlardan keyin: o'quvchi hech qachon yo'q segmentga ishora qiluvchi playlist ko'rmaydi
            files.sort(key=lambda f: f.suffix == ".m3u8")
            for f in files:
                self.storage.upload_file(f, out_bucket, prefix + f.relative_to(out).as_posix())

        step("upload", upload)

        rendered = json.loads((work / "renditions.json").read_text())
        output = {
            "hls_master_key": f"{prefix}hls/master.m3u8",
            "renditions": [
                {
                    "name": s["name"],
                    "width": s["width"],
                    "height": s["height"],
                    "bandwidth": bw,
                    "codecs": ffmpeg.codecs(ffmpeg.RenditionSpec(**s), p.has_audio),
                    "playlist_key": f"{prefix}hls/{s['name']}/index.m3u8",
                }
                for s, bw in rendered
            ],
            "thumbnail_key": f"{prefix}thumb.jpg",
            "vertical_key": None if recording else f"{prefix}vertical.mp4",
            "duration_ms": p.duration_ms,
            "width": p.width,
            "height": p.height,
            "has_audio": p.has_audio,
            "probe": {
                "format": p.format_name,
                "video_codec": p.video_codec,
                "audio_codec": p.audio_codec,
                "fps": p.fps,
                "rotation": p.rotation,
                "coded_width": p.coded_width,
                "coded_height": p.coded_height,
                "bit_rate": p.bit_rate,
            },
        }
        self.storage.put_json(
            out_bucket,
            prefix + "manifest.json",
            {"profile": profile, "worker_version": WORKER_VERSION, "job_id": job["job_id"], "source_size": media.get("size_bytes"), "output": output},
        )
        return output

    def cut(self, source: dict, work: Path, dst: Path) -> None:
        """`clip_v1`: yozuv playlist'i -> [start, start+duration) segmentlari (bir necha MB) -> ulash -> aniq kesish."""
        if source.get("kind") != "hls":
            raise JobError("UNSUPPORTED_SOURCE", str(source.get("kind")))
        work.mkdir(parents=True, exist_ok=True)
        playlist = work / "index.m3u8"
        self.storage.download(source["bucket"], source["key"], playlist)
        start_s, duration_s = source["start_ms"] / 1000, source["duration_ms"] / 1000
        picked, first_start = ffmpeg.select_segments(ffmpeg.parse_playlist(playlist), start_s, start_s + duration_s)
        if not picked:
            raise JobError("CLIP_OUT_OF_RANGE", f"{start_s:.1f} s yozuvdan tashqarida")
        base = source["key"].rsplit("/", 1)[0] + "/"
        joined = work / "joined.ts"
        with joined.open("wb") as fh:
            for name, _dur in picked:
                if "/" in name or name.startswith(".") or "://" in name:
                    raise JobError("BAD_PLAYLIST", name)
                seg = work / name
                self.storage.download(source["bucket"], base + name, seg)
                with seg.open("rb") as part:
                    shutil.copyfileobj(part, fh)
                seg.unlink()
        ffmpeg.cut_clip(joined, dst, start_s - first_start, duration_s, self.preset, self.threads)
