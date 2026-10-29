import type { Env } from '../config/env';

/** Fiskal chekdagi xizmat nomi — barcha provider'larda bir xil. */
export const FISCAL_ITEM_TITLE = "Havaskor sport o'yinida ishtirok";

/** Xizmatimizning MXIK (IKPU) va o'lchov birligi kodi; sozlanmagan bo'lsa — null (chek provider kassasi sozlamasidan). */
export function fiscalCodes(env: Env): { mxik: string; packageCode: string } | null {
  if (!env.FISCAL_MXIK_CODE || !env.FISCAL_PACKAGE_CODE) return null;
  return { mxik: env.FISCAL_MXIK_CODE, packageCode: env.FISCAL_PACKAGE_CODE };
}
