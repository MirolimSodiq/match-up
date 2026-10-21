from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

import pytest

from media_worker import ffmpeg
from media_worker.errors import JobError
from media_worker.pipeline import Pipeline
from media_worker.storage import LocalStorage

PREFIX = "highlights/m1/media1/"


def job_for(storage: LocalStorage, src: Path, *, checksum: str | None = None) -> dict:
    key = PREFIX + "source" + src.suffix
    dst = storage.root / "raw" / key
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    return {
        "job_id": "job-1",
        "type": "transcode",
        "profile": "highlight_v1",
        "media": {"id": "media1", "size_bytes": src.stat().st_size, "checksum_sha256": checksum},
        "source": {"bucket": "raw", "key": key},
        "output": {"bucket": "out", "prefix": PREFIX},
        "limits": {"max_duration_ms": 60_000, "max_bytes": 150 * 1024 * 1024},
    }


@pytest.fixture
def storage(tmp_path: Path) -> LocalStorage:
    return LocalStorage(tmp_path / "s3")


def test_full_pipeline_outputs(tmp_path: Path, storage: LocalStorage, portrait: Path) -> None:
    sha = hashlib.sha256(portrait.read_bytes()).hexdigest()
    stages: list[str] = []
    out = Pipeline(storage, tmp_path / "work", preset="ultrafast").run(job_for(storage, portrait, checksum=sha), stages.append)

    assert stages == ["download", "probe", "validate", "hls", "thumbnail", "vertical", "upload"]
    assert out["hls_master_key"] == PREFIX + "hls/master.m3u8"
    assert [(r["name"], r["width"], r["height"]) for r in out["renditions"]] == [("720p", 720, 1280), ("480p", 480, 854)]
    assert out["renditions"][0]["codecs"] == "avc1.4d4028,mp4a.40.2"
    assert (out["width"], out["height"], out["has_audio"]) == (1080, 1920, True)
    assert 5_900 <= out["duration_ms"] <= 6_100

    root = storage.root / "out"
    for key in [out["hls_master_key"], out["thumbnail_key"], out["vertical_key"], *(r["playlist_key"] for r in out["renditions"])]:
        assert (root / key).is_file(), key
    seg = sorted((root / PREFIX / "hls/720p").glob("seg_*.ts"))
    assert seg, "segmentlar yuklanmagan"
    types = {k.rsplit(".", 1)[-1]: t for _, k, t in storage.uploads}
    assert types == {"ts": "video/mp2t", "m3u8": "application/vnd.apple.mpegurl", "jpg": "image/jpeg", "mp4": "video/mp4"}
    # Playlist'lar segmentlardan keyin yuklanadi
    kinds = [k.rsplit(".", 1)[-1] for _, k, _ in storage.uploads]
    assert kinds.index("m3u8") > max(i for i, k in enumerate(kinds) if k == "ts")
    assert storage.get_json("out", PREFIX + "manifest.json")["output"] == out


def test_checksum_mismatch_is_final(tmp_path: Path, storage: LocalStorage, portrait: Path) -> None:
    with pytest.raises(JobError) as e:
        Pipeline(storage, tmp_path / "work").run(job_for(storage, portrait, checksum="0" * 64))
    assert e.value.code == "CHECKSUM_MISMATCH"


def test_too_long_is_rejected_before_encoding(tmp_path: Path, storage: LocalStorage, too_long: Path) -> None:
    stages: list[str] = []
    with pytest.raises(JobError) as e:
        Pipeline(storage, tmp_path / "work").run(job_for(storage, too_long), stages.append)
    assert e.value.code == "DURATION_TOO_LONG"
    assert stages == ["download", "probe", "validate"]
    assert not storage.uploads


def test_steps_are_idempotent_within_workdir(tmp_path: Path, storage: LocalStorage, landscape_silent: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    job = job_for(storage, landscape_silent)
    pipe = Pipeline(storage, tmp_path / "work", preset="ultrafast")

    calls = {"n": 0}
    real = ffmpeg.encode_vertical

    def flaky(*a, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("container OOM")
        return real(*a, **kw)

    monkeypatch.setattr(ffmpeg, "encode_vertical", flaky)
    with pytest.raises(RuntimeError):
        pipe.run(job)
    stages: list[str] = []
    out = pipe.run(job, stages.append)
    # Tugagan bosqichlar (download..thumbnail) qayta bajarilmaydi
    assert stages == ["vertical", "upload"]
    assert out["has_audio"] is False and out["renditions"][0]["codecs"] == "avc1.4d4028"


def test_manifest_short_circuits_redelivery(tmp_path: Path, storage: LocalStorage, small: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    job = job_for(storage, small)
    first = Pipeline(storage, tmp_path / "work-a", preset="ultrafast").run(job)

    def boom(*_a, **_kw):
        raise AssertionError("qayta kodlanmasligi kerak")

    monkeypatch.setattr(ffmpeg, "encode_hls", boom)
    # Boshqa worker (boshqa ish papkasi) — manifest'dan natija
    stages: list[str] = []
    assert Pipeline(storage, tmp_path / "work-b").run(job, stages.append) == first
    assert stages == []


def test_unknown_profile(tmp_path: Path, storage: LocalStorage, small: Path) -> None:
    job = job_for(storage, small) | {"profile": "aicam_v9"}
    with pytest.raises(JobError) as e:
        Pipeline(storage, tmp_path / "work").run(job)
    assert e.value.code == "UNSUPPORTED_PROFILE"
