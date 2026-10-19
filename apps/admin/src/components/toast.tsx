'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { IconAlert, IconCheck } from './icons';

type Tone = 'success' | 'danger';
interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

const Ctx = createContext<(text: string, tone?: Tone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const show = useCallback((text: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-pill px-5 py-3 text-sm font-semibold shadow-float ${
              t.tone === 'success' ? 'bg-primary text-on-primary' : 'bg-danger text-text-inverse'
            }`}
          >
            {t.tone === 'success' ? <IconCheck /> : <IconAlert />}
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
