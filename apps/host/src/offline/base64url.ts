/**
 * base64url (RFC 4648 §5, padding'siz) — platformaga bog'lanmagan (Hermes, Node, brauzer).
 * `atob`/`Buffer` ishlatilmaydi: Hermes'da ham, unit testda ham bir xil ishlaydi.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

/** Noto'g'ri belgi yoki uzunlikda `null`. */
export function base64UrlDecode(input: string): Uint8Array | null {
  const s = input.replace(/=+$/, '');
  if (s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (const ch of s) {
    const v = LOOKUP.get(ch);
    if (v === undefined) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET[(buffer >> bits) & 63];
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (6 - bits)) & 63];
  return out;
}

/**
 * UTF-8 baytlar -> matn (JSON payload uchun). Hermes'ning barcha versiyalarida `TextDecoder` bo'lmagani uchun
 * o'zimizniki; noto'g'ri ketma-ketlikda `null`.
 */
export function utf8Decode(bytes: Uint8Array): string | null {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let cp: number;
    let extra: number;
    if (b < 0x80) [cp, extra] = [b, 0];
    else if (b >= 0xc2 && b < 0xe0) [cp, extra] = [b & 0x1f, 1];
    else if (b >= 0xe0 && b < 0xf0) [cp, extra] = [b & 0x0f, 2];
    else if (b >= 0xf0 && b < 0xf5) [cp, extra] = [b & 0x07, 3];
    else return null;
    for (let k = 1; k <= extra; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    if ((extra === 2 && cp < 0x800) || (extra === 3 && (cp < 0x10000 || cp > 0x10ffff)) || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

/** Faqat ASCII matn -> baytlar (imzolangan xabar `mu1.<base64url>` doim ASCII); boshqa belgida `null`. */
export function asciiBytes(text: string): Uint8Array | null {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0x7f) return null;
    out[i] = c;
  }
  return out;
}
