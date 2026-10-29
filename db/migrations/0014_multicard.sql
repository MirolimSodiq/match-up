-- =============================================================================
-- Match Up — 0014: Rahmat (Multicard) onlayn to'lovi
--
-- FAQAT ADDITIVE: payment_provider enum'iga 'multicard'.
--   * Payme/Click/Uzum'dan farqi: Multicard'ni biz chaqiramiz — server-to-server invoys (`POST /payment/invoice`),
--     javobdagi `uuid` -> payments.provider_transaction_id (to'lovdan keyin — callback'dagi tranzaksiya `uuid`),
--     `checkout_url` -> payments.checkout_url. Holat payments.provider_state'da:
--     {"invoice_uuid": .., "status": "draft|progress|billing|success|error|revert", "ps": "uzcard|humo|payme|..",
--      "card_pan": "8600****1234", "receipt_url": .., "lang": "uz", ...}.
--   * Yangi jadval yoki ustun kerak emas: invoys holatini so'rash job'i payments_open_idx dan foydalanadi.
--   * payment_provider_configs qatori bu yerda ham, dev seed'da ham qo'shilmaydi: seed 0001 sxemasiga mos
--     (db/tests/verify.sh uni 0001 dan keyinoq yuklaydi, 'multicard' qiymati u yerda yo'q). Production'da operator
--     qo'shadi (DEPLOYMENT.md §10), e2e — Multicard spec'ining o'zi.
--
-- ALTER TYPE ... ADD VALUE tranzaksiya ichida ishlaydi (PG >= 12), lekin yangi qiymat shu tranzaksiyada
-- ishlatilmaydi — bu faylda faqat enum o'zgaradi.
-- =============================================================================

ALTER TYPE payment_provider ADD VALUE IF NOT EXISTS 'multicard' BEFORE 'stripe';
