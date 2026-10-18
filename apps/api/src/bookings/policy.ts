import type { Locale } from '../common/i18n';

export interface PolicyRule {
  min_hours_before: number;
  refund_pct: number;
  destination?: 'original_method' | 'wallet';
}

export interface RefundDecision {
  refundPct: number;
  destination: 'original_method' | 'wallet';
  rule: PolicyRule;
}

/** Bekor qilish vaqtiga mos qoidani topadi (qoidalar min_hours_before bo'yicha kamayish tartibida). */
export function decideRefund(rules: PolicyRule[], hoursBeforeStart: number): RefundDecision {
  const sorted = [...rules].sort((a, b) => b.min_hours_before - a.min_hours_before);
  const rule = sorted.find((r) => hoursBeforeStart >= r.min_hours_before) ?? { min_hours_before: 0, refund_pct: 0 };
  return { refundPct: rule.refund_pct, destination: rule.destination ?? 'wallet', rule };
}

export function ruleLabel(rule: PolicyRule): string {
  return `>=${rule.min_hours_before}h: ${rule.refund_pct}%${rule.refund_pct > 0 ? ` ${rule.destination ?? 'wallet'}` : ''}`;
}

/** Foydalanuvchiga ko'rsatiladigan qisqa matn. */
export function policySummary(rules: PolicyRule[], locale: Locale): string {
  const sorted = [...rules].sort((a, b) => b.min_hours_before - a.min_hours_before);
  const dest = (d: PolicyRule['destination']) => {
    if (locale === 'ru') return d === 'original_method' ? 'на карту' : 'в кошелёк';
    if (locale === 'en') return d === 'original_method' ? 'to card' : 'to wallet';
    return d === 'original_method' ? 'kartaga' : "hamyonga";
  };
  return sorted
    .map((r) => {
      if (r.refund_pct === 0) {
        if (locale === 'ru') return 'позже — без возврата';
        if (locale === 'en') return 'later — no refund';
        return 'keyin — qaytarilmaydi';
      }
      if (locale === 'ru') return `за ${r.min_hours_before} ч и раньше — ${r.refund_pct}% ${dest(r.destination)}`;
      if (locale === 'en') return `${r.min_hours_before}h+ before — ${r.refund_pct}% ${dest(r.destination)}`;
      return `${r.min_hours_before} soatdan oldin — ${r.refund_pct}% ${dest(r.destination)}`;
    })
    .join('; ');
}
