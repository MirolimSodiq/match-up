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
