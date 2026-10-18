/** Dev uchun Ed25519 kalit juftliklarini yaratadi: JWT va QR chipta imzosi uchun alohida. */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname, '../keys');
mkdirSync(dir, { recursive: true });
for (const name of ['jwt', 'ticket']) {
  const priv = join(dir, `${name}-private.pem`);
  if (existsSync(priv)) {
    console.log(`${name}: mavjud, o'tkazib yuborildi`);
    continue;
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(join(dir, `${name}-public.pem`), publicKey.export({ type: 'spki', format: 'pem' }));
  console.log(`${name}: yaratildi`);
}
