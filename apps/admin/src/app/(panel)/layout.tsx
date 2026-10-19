import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { hasSession } from '@/server/session';

/** Sessiya cookie'si bo'lmasa — login. Token'ni server komponent yangilamaydi (cookie yozolmaydi), buni BFF route'lari qiladi. */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  if (!(await hasSession())) redirect('/login');
  return <Shell>{children}</Shell>;
}
