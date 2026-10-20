#!/usr/bin/env bash
# Lokal staging (docker-compose.staging.yml) uchun Ed25519 kalitlar: .staging/keys/ (gitignore'da).
# Mavjud kalitlarga tegmaydi. Faqat lokal sinov uchun — AWS staging/prod kalitlari Secrets Manager'da.
set -euo pipefail
cd "$(dirname "$0")/../.."

dir=.staging/keys
mkdir -p "$dir"
node - "$dir" <<'JS'
const { generateKeyPairSync } = require('node:crypto');
const { existsSync, writeFileSync } = require('node:fs');
const dir = process.argv[2];
for (const name of ['jwt', 'ticket']) {
  const priv = `${dir}/${name}-private.pem`;
  if (existsSync(priv)) { console.log(`${name}: mavjud`); continue; }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  // 0644: compose secret fayli konteynerdagi `node` (uid 1000) foydalanuvchiga o'qilishi kerak
  writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o644 });
  writeFileSync(`${dir}/${name}-public.pem`, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
  console.log(`${name}: yaratildi`);
}
JS
