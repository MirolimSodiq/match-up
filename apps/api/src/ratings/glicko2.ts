/**
 * Glicko-2 (Mark Glickman, "Example of the Glicko-2 system", 2013). Bitta reyting davri = bitta match;
 * jamoaviy o'yinda raqib — boshqa jamoaning kompozit reytingi (`composite`).
 */

export interface Glicko {
  rating: number;
  rd: number;
  vol: number;
}

export interface GlickoGame {
  /** Raqib (yoki raqib jamoa kompoziti); vol ishlatilmaydi. */
  opponent: Pick<Glicko, 'rating' | 'rd'>;
  /** 1 — g'alaba, 0.5 — durang, 0 — mag'lubiyat. */
  score: number;
}

export const DEFAULT_GLICKO: Glicko = { rating: 1500, rd: 350, vol: 0.06 };
/** Volatillik o'zgarishini cheklaydi (Glickman: 0.3–1.2). */
const TAU = 0.5;
const SCALE = 173.7178;
const EPSILON = 0.000001;
/** RD chegaralari: juda ishonchli (30) va umuman noma'lum (350, yangi o'yinchi). */
const RD_MIN = 30;
const RD_MAX = 350;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** Bitta reyting davri natijasi. O'yin bo'lmasa — faqat RD o'sadi (2-qadam, 6-qadam). */
export function glicko2(player: Glicko, games: GlickoGame[]): Glicko {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;
  if (!games.length) {
    return { rating: player.rating, rd: clampRd(Math.sqrt(phi * phi + sigma * sigma) * SCALE), vol: sigma };
  }

  // 3–4: v (taxminiy dispersiya) va Δ (taxminiy yaxshilanish)
  let vInv = 0;
  let deltaSum = 0;
  for (const game of games) {
    const muJ = (game.opponent.rating - 1500) / SCALE;
    const phiJ = game.opponent.rd / SCALE;
    const e = expected(mu, muJ, phiJ);
    vInv += g(phiJ) ** 2 * e * (1 - e);
    deltaSum += g(phiJ) * (game.score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // 5: yangi volatillik — Illinois algoritmi
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const newSigma = Math.exp(A / 2);

  // 6–8: yangi RD va reyting
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;
  return { rating: newMu * SCALE + 1500, rd: clampRd(newPhi * SCALE), vol: newSigma };
}

/**
 * Jamoa kompoziti: reyting — o'rtacha, RD — o'rtacha kvadratik (noaniqlik jamoada ham saqlanadi).
 * Reytingi yo'q a'zolar (mehmonlar) hisobga olinmaydi; hech kim bo'lmasa — yangi o'yinchi.
 */
export function composite(members: Pick<Glicko, 'rating' | 'rd'>[]): Pick<Glicko, 'rating' | 'rd'> {
  if (!members.length) return { rating: DEFAULT_GLICKO.rating, rd: DEFAULT_GLICKO.rd };
  const rating = members.reduce((s, m) => s + m.rating, 0) / members.length;
  const rd = Math.sqrt(members.reduce((s, m) => s + m.rd * m.rd, 0) / members.length);
  return { rating, rd };
}

/** Hisob bo'yicha natija: 1 / 0.5 / 0. */
export const outcome = (own: number, other: number) => (own > other ? 1 : own === other ? 0.5 : 0);

function clampRd(rd: number) {
  return Math.min(RD_MAX, Math.max(RD_MIN, rd));
}
