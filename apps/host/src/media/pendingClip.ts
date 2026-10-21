import type { PickedClip } from './pickClip';

/**
 * Tanlangan/yozilgan klip "Yangi highlight" ekraniga shu orqali o'tadi (fayl URI'larini route
 * parametrlarida tashimaymiz). Ekran ochilganda bir marta olinadi.
 */
let current: PickedClip | undefined;

export const pendingClip = {
  set(clip: PickedClip) {
    current = clip;
  },
  take(): PickedClip | undefined {
    const c = current;
    current = undefined;
    return c;
  },
};
