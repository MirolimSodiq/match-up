import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { Env } from './env';

export interface KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** Ed25519 public key, raw 32 bayt, base64url — host app QR'ni offline tekshirishi uchun. */
  publicKeyRaw: string;
}

export interface SigningKeys {
  jwt: KeyPair;
  ticket: KeyPair;
}

export const SIGNING_KEYS = Symbol('SIGNING_KEYS');

const log = new Logger('Keys');

function resolvePath(file: string): string {
  return isAbsolute(file) ? file : join(process.cwd(), file);
}

function rawPublic(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' });
  if (!jwk.x) throw new Error('Ed25519 public key kutilgan edi');
  return jwk.x;
}

function loadPair(name: string, privFile: string | undefined, pubFile: string | undefined, env: Env): KeyPair {
  if (privFile && pubFile && existsSync(resolvePath(privFile)) && existsSync(resolvePath(pubFile))) {
    const priv = createPrivateKey(readFileSync(resolvePath(privFile), 'utf8'));
    const pub = createPublicKey(readFileSync(resolvePath(pubFile), 'utf8'));
    return { privateKey: priv, publicKey: pub, publicKeyRaw: rawPublic(pub) };
  }
  if (env.NODE_ENV === 'production') throw new Error(`${name} kalitlari topilmadi`);
  log.warn(`${name}: kalit fayllari topilmadi — vaqtinchalik Ed25519 kalit generatsiya qilindi (restart'da token'lar yaroqsiz bo'ladi). \`pnpm keys:gen\` ni ishga tushiring.`);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey, publicKeyRaw: rawPublic(publicKey) };
}

export function loadSigningKeys(env: Env): SigningKeys {
  return {
    jwt: loadPair('JWT', env.JWT_PRIVATE_KEY_FILE, env.JWT_PUBLIC_KEY_FILE, env),
    ticket: loadPair('Ticket', env.TICKET_PRIVATE_KEY_FILE, env.TICKET_PUBLIC_KEY_FILE, env),
  };
}
