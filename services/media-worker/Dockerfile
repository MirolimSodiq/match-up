# Match Up media worker: Python 3.12 + FFmpeg (Debian trixie — FFmpeg 7.x).
#   docker build -t matchup-media-worker services/media-worker
FROM ghcr.io/astral-sh/uv:0.13.4 AS uv

FROM python:3.12-slim-trixie AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=uv /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
# Bog'liqliklar alohida qatlamda (kod o'zgarsa qayta o'rnatilmaydi)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY media_worker ./media_worker
RUN uv sync --frozen --no-dev

# Root FS faqat o'qiladi (ECS readonlyRootFilesystem) — ish papkasi /tmp da (ephemeral volume)
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    WORK_DIR=/tmp/media-worker
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["python", "-m", "media_worker", "health"]
CMD ["python", "-m", "media_worker"]
