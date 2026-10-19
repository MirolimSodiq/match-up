'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdminDashboard } from '@matchup/contracts';
import { formatDay, formatPct } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Segmented } from './ui';

type Point = AdminDashboard['series'][number];
type Measure = 'matches' | 'gmv';

const H = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 44 };

/** Toza tick'lar: 0, 2, 4 ... / 0, 500K, 1M (kompakt). */
function ticks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1]! < max) out.push(out[out.length - 1]! + step);
  return out;
}

const compact = (v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : String(v));

/**
 * Kunlik ustunli diagramma, bitta seriya (match'lar yoki GMV — ikkita o'lchov bitta o'qda
 * ko'rsatilmaydi, toggle bilan almashtiriladi). Har ustun — hover/focus tooltip'li hit-target.
 */
export function DailyChart({ series }: { series: Point[] }) {
  const { m, lang } = useI18n();
  const [measure, setMeasure] = useState<Measure>('matches');
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const [width, setWidth] = useState(720);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);

  const values = useMemo(() => series.map((s) => (measure === 'matches' ? s.matches : s.gmv.amount / 100)), [series, measure]);
  const yt = ticks(Math.max(...values, 0));
  const top = yt[yt.length - 1] ?? 1;
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = series.length ? innerW / series.length : innerW;
  const barW = Math.max(4, Math.min(24, band - 2));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const day = (date: string) => formatDay(date, lang);
  const labelEvery = Math.max(1, Math.ceil(series.length / Math.floor(innerW / 56)));
  const hovered = hover === null ? null : series[hover];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          size="sm"
          value={measure}
          onChange={setMeasure}
          options={[
            { value: 'matches', label: m.dashboard.matches },
            { value: 'gmv', label: `${m.dashboard.gmv}, ${m.common.som}` },
          ]}
        />
        <button type="button" className="text-xs font-semibold text-text-muted hover:text-text" onClick={() => setAsTable((v) => !v)}>
          {asTable ? '▦' : '☰'} {asTable ? m.dashboard.daily : m.common.details}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="py-1.5">{m.common.date}</th>
                <th>{m.dashboard.matches}</th>
                <th>{m.matchStatus.cancelled}</th>
                <th>{m.dashboard.fillRate}</th>
                <th className="text-right">{m.dashboard.gmv}</th>
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.date} className="border-t border-border tabular-nums">
                  <td className="py-1.5">{day(s.date)}</td>
                  <td>{s.matches}</td>
                  <td>{s.cancelled}</td>
                  <td>{formatPct(s.fill_rate)}</td>
                  <td className="text-right">{s.gmv.formatted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative" ref={box}>
          <svg width={width} height={H} role="img" aria-label={m.dashboard.daily} onPointerLeave={() => setHover(null)}>
            {yt.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-text-muted text-[11px] tabular-nums">
                  {compact(t)}
                </text>
              </g>
            ))}
            {series.map((s, i) => {
              const v = values[i] ?? 0;
              const x = PAD.left + i * band + (band - barW) / 2;
              const h = Math.max(v > 0 ? 2 : 0, PAD.top + innerH - y(v));
              const r = Math.min(4, h, barW / 2);
              const base = PAD.top + innerH;
              // Yuqori burchaklar 4px yumaloq, asos to'g'ri
              const d = `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + barW - r} Q${x + barW},${base - h} ${x + barW},${base - h + r} V${base} Z`;
              return (
                <g key={s.date}>
                  {h > 0 && <path d={d} className={hover === null || hover === i ? 'fill-primary' : 'fill-primary/40'} />}
                  {i % labelEvery === 0 && (
                    <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="fill-text-muted text-[11px]">
                      {day(s.date)}
                    </text>
                  )}
                  <rect
                    x={PAD.left + i * band}
                    y={PAD.top}
                    width={band}
                    height={innerH}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${day(s.date)}: ${s.matches} ${m.dashboard.matches}, ${s.gmv.formatted}`}
                    onPointerMove={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    className="outline-none"
                  />
                </g>
              );
            })}
          </svg>
          {hovered && hover !== null && (
            <div
              className="pointer-events-none absolute z-10 min-w-40 rounded-md bg-surface px-3 py-2 text-xs shadow-float"
              style={{ left: Math.min(PAD.left + hover * band + band / 2 + 8, width - 176), top: 4 }}
            >
              <div className="font-semibold text-text-muted">{day(hovered.date)}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-base font-bold text-text tabular-nums">{hovered.matches}</span>
                <span className="text-text-muted">{m.dashboard.matches}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-bold text-text tabular-nums">{hovered.gmv.formatted}</span>
                <span className="text-text-muted">{m.dashboard.gmv}</span>
              </div>
              <div className="text-text-muted">
                {m.dashboard.fillRate}: <span className="font-semibold text-text">{formatPct(hovered.fill_rate)}</span>
                {hovered.cancelled ? ` · ${m.matchStatus.cancelled}: ${hovered.cancelled}` : ''}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
