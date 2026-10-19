'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorBox, Field, Segmented } from '@/components/ui';
import { IconAlert } from '@/components/icons';
import { ApiError, authFetch } from '@/lib/api';
import { LANGS, useI18n, type Lang } from '@/lib/i18n';
import { gradients, sportColors } from '@/lib/tokens';

interface Challenge {
  challenge_id: string;
  expires_in: number;
  resend_after: number;
}

function LoginForm() {
  const { m, f, lang, setLang } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const reason = params.get('reason');
  const next = params.get('next');

  const [phone, setPhone] = useState('+998 ');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = await authFetch<Challenge>('/api/auth/otp/request', { phone: phone.replace(/\s/g, '') });
      setChallenge(c);
      setWait(c.resend_after);
      setCode('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      await authFetch('/api/auth/otp/verify', { challenge_id: challenge.challenge_id, code });
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
      router.refresh();
    } catch (err) {
      setError(err);
      if (err instanceof ApiError && (err.code === 'OTP_EXPIRED' || err.code === 'OTP_TOO_MANY_ATTEMPTS' || err.code === 'NOT_ADMIN')) setChallenge(null);
      setBusy(false);
    }
  }

  const notice = reason === 'reused' ? m.login.reused : reason === 'expired' ? m.login.expired : null;
  const notAdmin = error instanceof ApiError && error.code === 'NOT_ADMIN';

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex items-center justify-between">
        <span className="display text-2xl text-text">Match Up</span>
        <Segmented size="sm" value={lang} onChange={(v: Lang) => setLang(v)} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} />
      </div>
      <h1 className="display text-[34px] leading-10">{m.login.title}</h1>
      <p className="mt-2 text-sm text-text-muted">{m.login.subtitle}</p>

      {notice && (
        <div className="mt-5 flex gap-2 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning" role="status">
          <IconAlert className="mt-0.5 shrink-0" />
          {notice}
        </div>
      )}

      {!challenge ? (
        <form onSubmit={requestCode} className="mt-6 space-y-4">
          <Field label={m.login.phone}>
            <input className="field h-12 text-base tracking-wide" inputMode="tel" autoComplete="tel" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          {error ? notAdmin ? <ErrorBox error={new ApiError(403, 'NOT_ADMIN', m.login.notAdmin)} /> : <ErrorBox error={error} /> : null}
          <Button type="submit" className="w-full" loading={busy} disabled={phone.replace(/\D/g, '').length < 9}>
            {m.login.sendCode}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-6 space-y-4">
          <p className="text-sm text-text">{f(m.login.codeSent, { phone })}</p>
          <Field label={m.login.code}>
            <input
              className="field h-14 text-center font-display text-3xl tracking-[0.5em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </Field>
          {error ? <ErrorBox error={error} /> : null}
          <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>
            {m.login.verify}
          </Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="font-semibold text-text-muted hover:text-text" onClick={() => setChallenge(null)}>
              {m.login.changePhone}
            </button>
            <button type="button" className="font-semibold text-text disabled:text-text-muted" disabled={wait > 0 || busy} onClick={() => requestCode()}>
              {m.login.resend}
              {wait > 0 ? ` (${wait})` : ''}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Bezak: sport rangidagi "match kartalari" (player'dagi AuthLayout uslubida). */
function Hero() {
  const { m } = useI18n();
  const cards = [
    { sport: 'football', time: '19:00', code: 'MU-RACE', fill: 0.86 },
    { sport: 'basketball', time: '17:00', code: 'MU-BSK1', fill: 0.6 },
    { sport: 'volleyball', time: '20:30', code: 'MU-VLY3', fill: 0.4 },
  ];
  return (
    <div className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12" style={{ background: `linear-gradient(150deg, ${gradients.hero.join(', ')})` }}>
      <div>
        <div className="display text-[56px] leading-[60px] text-on-primary">Match Up</div>
        <div className="mt-2 text-lg text-on-primary-muted">{m.app.tagline}</div>
      </div>
      <div className="relative h-80">
        {cards.map((c, i) => {
          const col = sportColors(c.sport);
          return (
            <div
              key={c.code}
              className="absolute w-72 rounded-xl p-5 text-on-sport shadow-float"
              style={{ background: `linear-gradient(160deg, ${col.base}, ${col.deep})`, left: `${i * 56}px`, top: `${i * 84}px`, transform: `rotate(${(i - 1) * 4}deg)` }}
            >
              <div className="flex items-center justify-between text-xs font-semibold" style={{ color: col.muted }}>
                <span>{m.sports[c.sport]}</span>
                <span>{c.code}</span>
              </div>
              <div className="display mt-3 text-5xl">{c.time}</div>
              <div className="mt-4 h-1.5 rounded-pill bg-sport-glass">
                <div className="h-full rounded-pill bg-on-sport" style={{ width: `${c.fill * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <Suspense>
        <Hero />
      </Suspense>
      <div className="flex items-center justify-center bg-surface px-4 py-12">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
