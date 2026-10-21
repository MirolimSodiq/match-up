"""Test videolari FFmpeg lavfi bilan generatsiya qilinadi (testsrc2 + sine) — repoda binar fayl yo'q."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
    pytest.skip("ffmpeg/ffprobe topilmadi", allow_module_level=True)

CACHE = Path(__file__).parent / ".media"


def make_video(
    name: str,
    width: int,
    height: int,
    seconds: float,
    *,
    audio: bool = True,
    rotate: int | None = None,
    container: str = "mp4",
    fps: int = 30,
) -> Path:
    """Kesh qilingan sintetik video. `rotate` — telefon kabi display matrix (piksellar aylantirilmaydi)."""
    CACHE.mkdir(exist_ok=True)
    out = CACHE / f"{name}.{container}"
    if out.exists():
        return out
    args = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size={width}x{height}:rate={fps}:duration={seconds}"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}"]
    args += ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", str(fps)]
    if audio:
        args += ["-c:a", "aac", "-b:a", "64k", "-shortest"]
    tmp = out.with_name(out.stem + ".tmp." + container)
    subprocess.run([*args, str(tmp)], check=True)
    if rotate is not None:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-display_rotation", str(rotate), "-i", str(tmp), "-c", "copy", str(out)],
            check=True,
        )
        tmp.unlink()
    else:
        tmp.replace(out)
    return out


@pytest.fixture(scope="session")
def portrait() -> Path:
    """Telefon portret yozuvi: 1080x1920, 6 s, ovoz bilan."""
    return make_video("portrait", 1080, 1920, 6)


@pytest.fixture(scope="session")
def landscape_silent() -> Path:
    """Landshaft, ovozsiz: 1280x720, 5 s."""
    return make_video("landscape_silent", 1280, 720, 5, audio=False)


@pytest.fixture(scope="session")
def rotated() -> Path:
    """iPhone kabi: piksellar 1280x720, display matrix 90° -> ko'rinishi 720x1280 (mov)."""
    return make_video("rotated", 1280, 720, 4, rotate=90, container="mov")


@pytest.fixture(scope="session")
def small() -> Path:
    """Kichik manba (360x640) — upscale bo'lmasligi kerak."""
    return make_video("small", 360, 640, 3)


@pytest.fixture(scope="session")
def too_long() -> Path:
    """62 s — 60 s chegarasidan uzun (tolerance 1 s). Juda kichik o'lcham — tez generatsiya."""
    return make_video("too_long", 160, 288, 62, fps=5)
