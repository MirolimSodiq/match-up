import { createContext, type PropsWithChildren, use } from 'react';

/**
 * Dizayn tizimi i18n'ga bog'lanmaydi: komponentlardagi umumiy matnlar ("Yopish", "Qayta urinish")
 * va xato matni (`code` bo'yicha lokal tarjima) ilovadan shu kontekst orqali keladi.
 */
export interface UIConfig {
  closeLabel: string;
  retryLabel: string;
  /** Xato obyektidan foydalanuvchi tilidagi matn. */
  formatError: (error: unknown) => string;
}

const DEFAULT_CONFIG: UIConfig = {
  closeLabel: 'Close',
  retryLabel: 'Retry',
  formatError: (error) => (error instanceof Error ? error.message : 'Error'),
};

const UIContext = createContext<UIConfig>(DEFAULT_CONFIG);

export const useUI = () => use(UIContext);

/** Ilova ildizida, til o'zgarganda yangi `value` bilan qayta render qilinadi. */
export function UIProvider({ value, children }: PropsWithChildren<{ value: UIConfig }>) {
  return <UIContext value={value}>{children}</UIContext>;
}
