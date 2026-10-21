"""Highlight pipeline (profil `highlight_v1`): download -> probe -> validate -> hls -> thumbnail -> vertical -> upload.

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

PROFILE = "highlight_v1"
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
        if job.get("profile", PROFILE) != PROFILE:
            raise JobError("UNSUPPORTED_PROFILE", str(job.get("profile")))
        out_bucket, prefix = job["output"]["bucket"], job["output"]["prefix"]
        media = job["media"]

        manifest = self.storage.get_json(out_bucket, prefix + "manifest.json")
        if manifest and manifest.get("profile") == PROFILE and manifest.get("source_size") == media.get("size_bytes"):
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

        specs = ffmpeg.plan_renditions(p)

        def hls() -> None:
            entries = []
            for spec in specs:
                pl = ffmpeg.encode_hls(src, out / "hls" / spec.name, p, spec, self.preset, self.threads)
                entries.append((spec, ffmpeg.peak_bandwidth(pl)))
            ffmpeg.write_master(out / "hls" / "master.m3u8", entries, p.has_audio)
            (work / "renditions.json").write_text(json.dumps([[s.__dict__, bw] for s, bw in entries]))

        step("hls", hls)
        step("thumbnail", lambda: ffmpeg.thumbnail(src, out / "thumb.jpg", p))
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
            "vertical_key": f"{prefix}vertical.mp4",
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
            {"profile": PROFILE, "worker_version": WORKER_VERSION, "job_id": job["job_id"], "source_size": media.get("size_bytes"), "output": output},
        )
        return output
