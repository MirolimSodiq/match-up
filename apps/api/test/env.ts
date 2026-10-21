// E2E muhit: alohida baza va Redis DB 15, background worker'lar o'chiq, OTP limitlari keng.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://matchup:matchup_dev_only@localhost:5432/matchup_e2e';
process.env.REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/15';
process.env.RUN_WORKERS = 'false';
process.env.OTP_PROVIDER = 'console';
process.env.OTP_RESEND_SEC = '1';
process.env.OTP_MAX_PER_PHONE_HOUR = '1000';
process.env.OTP_MAX_PER_IP_HOUR = '100000';
process.env.PAYME_KEY = 'payme_test_key';
process.env.CLICK_SECRET_KEY = 'click_test_secret';
delete process.env.JWT_PRIVATE_KEY_FILE;
delete process.env.TICKET_PRIVATE_KEY_FILE;
// Social login: client ID'lar va bot token test qiymatlari; JWKS URL'larini social testi lokal serverga yo'naltiradi.
process.env.GOOGLE_CLIENT_IDS = 'e2e-google-ios.apps.googleusercontent.com,e2e-google-web.apps.googleusercontent.com';
process.env.APPLE_CLIENT_IDS = 'uz.matchup.player';
process.env.TELEGRAM_BOT_TOKEN = '123456789:e2e-telegram-bot-secret';
process.env.TELEGRAM_APP_REDIRECTS = 'matchup://,exp://';
process.env.PUBLIC_BASE_URL = 'https://api.e2e.matchup.example';
// GDPR eksport fayllari repo'dan tashqarida
process.env.STORAGE_DIR = require('node:path').join(require('node:os').tmpdir(), 'matchup-e2e-storage');
// Highlight pipeline: MinIO (docker compose: minio) yoki CI service. Alohida bucket'lar — dev ma'lumotlariga tegmaydi;
// global-setup ularni yaratadi. Qism hajmi S3 minimumi (5 MiB) — test fayllari kichik.
process.env.S3_ENDPOINT = process.env.E2E_S3_ENDPOINT ?? 'http://localhost:9000';
delete process.env.S3_PUBLIC_ENDPOINT;
process.env.S3_REGION = 'us-east-1';
process.env.S3_ACCESS_KEY_ID = process.env.E2E_S3_ACCESS_KEY_ID ?? 'matchup';
process.env.S3_SECRET_ACCESS_KEY = process.env.E2E_S3_SECRET_ACCESS_KEY ?? 'matchup_dev_only';
process.env.S3_FORCE_PATH_STYLE = 'true';
process.env.MEDIA_RAW_BUCKET = 'matchup-e2e-media-raw';
process.env.MEDIA_BUCKET = 'matchup-e2e-media';
process.env.MEDIA_UPLOAD_PART_SIZE = String(5 * 1024 * 1024);
process.env.MEDIA_JOBS_STREAM = 'matchup:media-jobs';
process.env.MEDIA_RECORDING_JOBS_STREAM = 'matchup:media-jobs:recording';
process.env.MEDIA_RECORDING_PART_SIZE = String(5 * 1024 * 1024);
process.env.MEDIA_WORKER_TOKEN = 'e2e-media-worker-token-0123456789abcdef';
delete process.env.MEDIA_CDN_DOMAIN;
