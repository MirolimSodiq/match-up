import type { Locale } from '../common/i18n';

interface SharedHighlight {
  title: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  match: { public_code: string; sport: string; starts_at: string | null; timezone: string; venue_name: string };
  thumbnail_url: string | null;
  playback: { hls_url: string; mp4_url: string | null };
}

const T = {
  'uz-Latn': { title: 'Match Up highlight', missing: "Havola muddati tugagan yoki highlight o'chirilgan", app: "Match Up'da o'yin toping" },
  ru: { title: 'Хайлайт Match Up', missing: 'Срок ссылки истёк или хайлайт удалён', app: 'Найдите игру в Match Up' },
  en: { title: 'Match Up highlight', missing: 'This link has expired or the highlight was removed', app: 'Find a game on Match Up' },
} as const;

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function when(iso: string | null, tz: string, locale: Locale): string {
  if (!iso) return '';
  const lang = locale === 'ru' ? 'ru-RU' : locale === 'en' ? 'en-GB' : 'uz-Latn-UZ';
  try {
    return new Intl.DateTimeFormat(lang, { timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

/** Server tomonda yig'iladigan kichik sahifa: JS yo'q, faqat <video> (Safari — HLS, boshqalar — MP4). */
export function sharePage(h: SharedHighlight | undefined, locale: Locale): string {
  const t = T[locale === 'uz-Cyrl' ? 'uz-Latn' : locale];
  const lang = locale === 'uz-Cyrl' ? 'uz-Latn' : locale;
  if (!h) {
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(t.title)}</title></head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#0B132B;color:#fff;display:grid;place-items:center;min-height:100vh">
<p style="padding:24px;text-align:center">${esc(t.missing)}</p></body></html>`;
  }
  const heading = h.title ?? `${h.match.public_code} · ${h.match.venue_name}`;
  const sub = [h.match.venue_name, when(h.match.starts_at, h.match.timezone, locale)].filter(Boolean).join(' · ');
  const poster = h.thumbnail_url ? ` poster="${esc(h.thumbnail_url)}"` : '';
  const og = [
    `<meta property="og:type" content="video.other">`,
    `<meta property="og:title" content="${esc(heading)}">`,
    `<meta property="og:description" content="${esc(sub)}">`,
    h.thumbnail_url ? `<meta property="og:image" content="${esc(h.thumbnail_url)}">` : '',
    h.playback.mp4_url ? `<meta property="og:video" content="${esc(h.playback.mp4_url)}"><meta property="og:video:type" content="video/mp4">` : '',
  ].join('');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(heading)} — Match Up</title>${og}</head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#0B132B;color:#fff">
<main style="max-width:480px;margin:0 auto;padding:16px">
<video controls playsinline preload="metadata"${poster} style="width:100%;max-height:80vh;border-radius:16px;background:#000">
<source src="${esc(h.playback.hls_url)}" type="application/vnd.apple.mpegurl">
${h.playback.mp4_url ? `<source src="${esc(h.playback.mp4_url)}" type="video/mp4">` : ''}
</video>
<h1 style="font-size:20px;margin:16px 0 4px">${esc(heading)}</h1>
<p style="margin:0;opacity:.75">${esc(sub)}</p>
<p style="margin-top:24px;opacity:.6;font-size:14px">${esc(t.app)}</p>
</main></body></html>`;
}
