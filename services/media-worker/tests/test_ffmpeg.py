from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from media_worker import ffmpeg
from media_worker.errors import JobError

LIMITS = dict(max_duration_ms=60_000, max_bytes=150 * 1024 * 1024)


def dims(path: Path) -> tuple[int, int]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip().splitlines()[0]  # MPEG-TS: stream program ostida ham takrorlanadi
    w, h = out.split(",")
    return int(w), int(h)


def test_probe_portrait(portrait: Path) -> None:
    p = ffmpeg.probe(portrait)
    assert (p.width, p.height, p.rotation) == (1080, 1920, 0)
    assert 5_900 <= p.duration_ms <= 6_100
    assert p.has_audio and p.audio_codec == "aac"
    assert p.video_codec == "h264" and p.fps == 30
    assert "mp4" in p.format_name


def test_probe_rotation_swaps_display_dims(rotated: Path) -> None:
    p = ffmpeg.probe(rotated)
    assert (p.coded_width, p.coded_height) == (1280, 720)
    assert p.rotation in (90, 270)
    assert (p.width, p.height) == (720, 1280)
    assert "mov" in p.format_name


def test_probe_not_a_video(tmp_path: Path) -> None:
    f = tmp_path / "x.mp4"
    f.write_bytes(b"definitely not a video" * 100)
    with pytest.raises(JobError) as e:
        ffmpeg.probe(f)
    assert e.value.code == "NOT_A_VIDEO"


def test_validate_limits(portrait: Path, too_long: Path) -> None:
    ffmpeg.validate(ffmpeg.probe(portrait), **LIMITS)
    with pytest.raises(JobError) as e:
        ffmpeg.validate(ffmpeg.probe(too_long), **LIMITS)
    assert e.value.code == "DURATION_TOO_LONG"
    with pytest.raises(JobError) as e:
        ffmpeg.validate(ffmpeg.probe(portrait), max_duration_ms=60_000, max_bytes=1000)
    assert e.value.code == "FILE_TOO_LARGE"


def test_validate_rejects_other_containers(tmp_path: Path, landscape_silent: Path) -> None:
    mkv = tmp_path / "clip.mkv"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(landscape_silent), "-c", "copy", str(mkv)], check=True)
    with pytest.raises(JobError) as e:
        ffmpeg.validate(ffmpeg.probe(mkv), **LIMITS)
    assert e.value.code == "UNSUPPORTED_FORMAT"


def test_plan_renditions_orientation_and_no_upscale(portrait: Path, landscape_silent: Path, small: Path) -> None:
    assert [(r.name, r.width, r.height) for r in ffmpeg.plan_renditions(ffmpeg.probe(portrait))] == [
        ("720p", 720, 1280),
        ("480p", 480, 854),
    ]
    assert [(r.name, r.width, r.height) for r in ffmpeg.plan_renditions(ffmpeg.probe(landscape_silent))] == [
        ("720p", 1280, 720),
        ("480p", 854, 480),
    ]
    # 360x640: 480p ham upscale bo'lardi -> bitta rendition asl o'lchamda
    assert [(r.width, r.height) for r in ffmpeg.plan_renditions(ffmpeg.probe(small))] == [(360, 640)]


def test_hls_segments_and_bandwidth(tmp_path: Path, portrait: Path) -> None:
    p = ffmpeg.probe(portrait)
    spec = ffmpeg.plan_renditions(p)[1]
    pl = ffmpeg.encode_hls(portrait, tmp_path / "480p", p, spec, preset="ultrafast")
    text = pl.read_text()
    assert "#EXT-X-PLAYLIST-TYPE:VOD" in text and "#EXT-X-ENDLIST" in text
    segs = ffmpeg.parse_playlist(pl)
    assert len(segs) >= 2 and all(n.startswith("seg_") and n.endswith(".ts") for n, _ in segs)
    assert abs(sum(d for _, d in segs) - p.duration_ms / 1000) < 0.5
    assert all(d <= 4.5 for _, d in segs)  # keyframe har 2 s -> segment ~4 s
    assert dims(tmp_path / "480p" / segs[0][0]) == (480, 854)
    assert ffmpeg.peak_bandwidth(pl) > 100_000

    ffmpeg.write_master(tmp_path / "master.m3u8", [(spec, 1_500_000)], has_audio=True)
    master = (tmp_path / "master.m3u8").read_text()
    assert 'BANDWIDTH=1500000,RESOLUTION=480x854,CODECS="avc1.4d401f,mp4a.40.2"' in master
    assert "480p/index.m3u8" in master


def test_hls_without_audio(tmp_path: Path, landscape_silent: Path) -> None:
    p = ffmpeg.probe(landscape_silent)
    spec = ffmpeg.plan_renditions(p)[1]
    pl = ffmpeg.encode_hls(landscape_silent, tmp_path / "480p", p, spec, preset="ultrafast")
    seg = tmp_path / "480p" / ffmpeg.parse_playlist(pl)[0][0]
    streams = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(seg)],
                             capture_output=True, text=True, check=True).stdout.split()
    assert set(streams) == {"video"}
    assert ffmpeg.codecs(spec, has_audio=False) == "avc1.4d401f"


def test_thumbnail(tmp_path: Path, portrait: Path, landscape_silent: Path) -> None:
    out = tmp_path / "thumb.jpg"
    assert ffmpeg.thumbnail(portrait, out, ffmpeg.probe(portrait)) == (720, 1280)
    assert out.read_bytes()[:2] == b"\xff\xd8" and dims(out) == (720, 1280)
    assert ffmpeg.thumbnail(landscape_silent, out, ffmpeg.probe(landscape_silent)) == (1280, 720)


@pytest.mark.parametrize(
    ("w", "h", "expected"),
    [
        (1920, 1080, (608, 1080, 656, 0)),  # landshaft: yon tomonlar kesiladi, markazda
        (1080, 1920, (1080, 1920, 0, 0)),  # aniq 9:16 — crop yo'q
        (1080, 2400, (1080, 1920, 0, 240)),  # juda baland (20:9): tepa/past kesiladi
    ],
)
def test_vertical_crop_math(w: int, h: int, expected: tuple[int, int, int, int]) -> None:
    p = ffmpeg.Probe("mov,mp4", 1000, 1, None, "h264", w, h, 0, w, h, 30.0, False, None)
    cw, ch, x, y = ffmpeg.vertical_crop(p)
    assert (cw, ch, x, y) == expected
    assert cw % 2 == 0 and ch % 2 == 0
    assert abs(cw / ch - 9 / 16) < 0.01


def test_vertical_from_landscape_and_rotated(tmp_path: Path, landscape_silent: Path, rotated: Path) -> None:
    for src in (landscape_silent, rotated):
        out = tmp_path / f"{src.stem}.mp4"
        ffmpeg.encode_vertical(src, out, ffmpeg.probe(src), preset="ultrafast")
        assert dims(out) == (720, 1280)
        # faststart: moov atom mdat'dan oldin
        head = out.read_bytes()[:200_000]
        assert head.find(b"moov") != -1 and (head.find(b"mdat") == -1 or head.find(b"moov") < head.find(b"mdat"))
