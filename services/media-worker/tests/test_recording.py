"""AI-Cam A: to'liq o'yin yozuvi (`recording_v1`) va host belgisidan klip (`clip_v1`)."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

from media_worker import ffmpeg
from media_worker.errors import JobError
from media_worker.pipeline import Pipeline
from media_worker.storage import LocalStorage

REC_PREFIX = "recordings/m1/rec1/"
CLIP_PREFIX = "highlights/m1/clip1/"
REC_LIMITS = {"max_duration_ms": 3 * 3600_000, "max_bytes": 40 * 1024**3}


@pytest.fixture
def storage(tmp_path: Path) -> LocalStorage:
    return LocalStorage(tmp_path / "s3")


def recording_job(storage: LocalStorage, src: Path) -> dict:
    key = REC_PREFIX + "source" + src.suffix
    dst = storage.root / "raw" / key
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(src.read_bytes())
    return {
        "job_id": "rec-job",
        "type": "transcode",
        "profile": "recording_v1",
        "media": {"id": "rec1", "size_bytes": src.stat().st_size, "checksum_sha256": None},
        "source": {"bucket": "raw", "key": key},
        "output": {"bucket": "out", "prefix": REC_PREFIX},
        "limits": REC_LIMITS,
    }


def clip_job(start_ms: int, duration_ms: int) -> dict:
    return {
        "job_id": "clip-job",
        "type": "transcode",
        "profile": "clip_v1",
        "media": {"id": "clip1", "size_bytes": None, "checksum_sha256": None},
        "source": {"bucket": "out", "key": REC_PREFIX + "hls/1080p/index.m3u8", "kind": "hls", "start_ms": start_ms, "duration_ms": duration_ms},
        "output": {"bucket": "out", "prefix": CLIP_PREFIX},
        "limits": {"max_duration_ms": 60_000, "max_bytes": 150 * 1024 * 1024},
    }


def frame_psnr(a: Path, a_t: float, b: Path, b_t: float) -> float:
    """Ikki videodagi kadrlar o'xshashligi (dB, 320x180 da): bir xil kadr — > 40, boshqa kadr — ~20."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-ss", str(a_t), "-i", str(a), "-ss", str(b_t), "-i", str(b), "-lavfi",
         "[0:v]scale=320:180,trim=end_frame=1[x];[1:v]scale=320:180,trim=end_frame=1[y];[x][y]psnr", "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    )
    m = re.search(r"average:([\d.]+|inf)", proc.stderr)
    assert m, proc.stderr[-500:]
    return float(m.group(1))


def test_recording_ladder_by_short_side() -> None:
    def probe(w: int, h: int) -> ffmpeg.Probe:
        return ffmpeg.Probe("mov", 1000, 1, None, "hevc", w, h, 0, w, h, 30.0, True, "aac")

    uhd = ffmpeg.plan_renditions(probe(3840, 2160), ffmpeg.RECORDING_LADDER)
    assert [(s.name, s.width, s.height) for s in uhd] == [("1080p", 1920, 1080), ("720p", 1280, 720), ("480p", 854, 480)]
    hd = ffmpeg.plan_renditions(probe(1280, 720), ffmpeg.RECORDING_LADDER)
    assert [s.name for s in hd] == ["720p", "480p"]


def test_select_segments() -> None:
    segs = [(f"seg_{i:05d}.ts", 4.0) for i in range(10)]  # 0..40 s
    picked, first = ffmpeg.select_segments(segs, 9.0, 15.0)
    assert [n for n, _ in picked] == ["seg_00002.ts", "seg_00003.ts"] and first == 8.0
    picked, first = ffmpeg.select_segments(segs, 0.0, 4.0)
    assert [n for n, _ in picked] == ["seg_00000.ts"] and first == 0.0
    assert ffmpeg.select_segments(segs, 50.0, 55.0) == ([], 0.0)


def test_recording_pipeline_single_pass(tmp_path: Path, storage: LocalStorage, field: Path) -> None:
    stages: list[str] = []
    out = Pipeline(storage, tmp_path / "work", preset="ultrafast").run(recording_job(storage, field), stages.append)

    assert stages == ["download", "probe", "validate", "hls", "thumbnail", "upload"]
    assert [(r["name"], r["width"], r["height"]) for r in out["renditions"]] == [("1080p", 1920, 1080), ("720p", 1280, 720), ("480p", 854, 480)]
    assert out["vertical_key"] is None
    assert 11_900 <= out["duration_ms"] <= 12_100 and out["has_audio"] is True
    root = storage.root / "out"
    for r in out["renditions"]:
        segs = ffmpeg.parse_playlist(root / r["playlist_key"])
        assert segs and all(name.startswith("seg_") and len(name) == len("seg_00000.ts") for name, _ in segs)
    assert (root / out["thumbnail_key"]).is_file()
    assert not list(root.rglob("vertical.mp4"))
    assert storage.get_json("out", REC_PREFIX + "manifest.json")["profile"] == "recording_v1"


def test_clip_cut_from_recording_hls(tmp_path: Path, storage: LocalStorage, field: Path) -> None:
    Pipeline(storage, tmp_path / "work", preset="ultrafast").run(recording_job(storage, field))
    downloads: list[str] = []
    real = storage.download

    def tracking(bucket: str, key: str, dst: Path) -> int:
        downloads.append(key)
        return real(bucket, key, dst)

    storage.download = tracking  # type: ignore[method-assign]
    stages: list[str] = []
    out = Pipeline(storage, tmp_path / "work", preset="ultrafast").run(clip_job(5_000, 4_000), stages.append)

    assert stages == ["cut", "probe", "validate", "hls", "thumbnail", "vertical", "upload"]
    # Faqat playlist va 5..9 s ni qamragan segmentlar (4 s dan: 4..8, 8..12)
    assert downloads[0] == REC_PREFIX + "hls/1080p/index.m3u8"
    assert [k.rsplit("/", 1)[1] for k in downloads[1:]] == ["seg_00001.ts", "seg_00002.ts"]
    assert 3_900 <= out["duration_ms"] <= 4_100
    assert (out["width"], out["height"]) == (1920, 1080)
    assert out["vertical_key"] == CLIP_PREFIX + "vertical.mp4"
    root = storage.root / "out"
    source = root / CLIP_PREFIX / "source.mp4"  # media_assets.object_key
    assert source.is_file() and (root / out["vertical_key"]).is_file()
    # Kadr aniqligi: klip yozuvning aynan 5-soniyasidan boshlanadi (keyingi keyframe'dan emas)
    assert frame_psnr(source, 0, field, 5.0) > 35
    assert frame_psnr(source, 0, field, 6.0) < 30


def test_clip_outside_recording(tmp_path: Path, storage: LocalStorage, field: Path) -> None:
    Pipeline(storage, tmp_path / "work", preset="ultrafast").run(recording_job(storage, field))
    with pytest.raises(JobError) as e:
        Pipeline(storage, tmp_path / "work").run(clip_job(30_000, 5_000))
    assert e.value.code == "CLIP_OUT_OF_RANGE"


def test_clip_rejects_foreign_segment_uris(tmp_path: Path, storage: LocalStorage) -> None:
    pl = storage.root / "out" / REC_PREFIX / "hls/1080p/index.m3u8"
    pl.parent.mkdir(parents=True, exist_ok=True)
    pl.write_text("#EXTM3U\n#EXTINF:4.0,\n../../other/seg.ts\n#EXT-X-ENDLIST\n")
    with pytest.raises(JobError) as e:
        Pipeline(storage, tmp_path / "work").run(clip_job(0, 3_000))
    assert e.value.code == "BAD_PLAYLIST"
