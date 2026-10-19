import type { SVGProps } from 'react';

/** Kichik stroke ikonalar to'plami (24x24, currentColor). */
function Icon({ paths, ...props }: Omit<SVGProps<SVGSVGElement>, 'd'> & { paths: string | string[] }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      {(Array.isArray(paths) ? paths : [paths]).map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;
export const IconDashboard = (p: P) => <Icon {...p} paths={['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z']} />;
export const IconCalendar = (p: P) => <Icon {...p} paths={['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z']} />;
export const IconPlus = (p: P) => <Icon {...p} paths={['M12 5v14', 'M5 12h14']} />;
export const IconPin = (p: P) => <Icon {...p} paths={['M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z']} />;
export const IconUsers = (p: P) => <Icon {...p} paths={['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8']} />;
export const IconCard = (p: P) => <Icon {...p} paths={['M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M2 10h20']} />;
export const IconRefund = (p: P) => <Icon {...p} paths={['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5']} />;
export const IconLogout = (p: P) => <Icon {...p} paths={['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9']} />;
export const IconSearch = (p: P) => <Icon {...p} paths={['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3']} />;
export const IconChevronLeft = (p: P) => <Icon {...p} paths="M15 18l-6-6 6-6" />;
export const IconChevronRight = (p: P) => <Icon {...p} paths="M9 18l6-6-6-6" />;
export const IconX = (p: P) => <Icon {...p} paths={['M18 6L6 18', 'M6 6l12 12']} />;
export const IconCheck = (p: P) => <Icon {...p} paths="M20 6L9 17l-5-5" />;
export const IconAlert = (p: P) => <Icon {...p} paths={['M12 9v4', 'M12 17h.01', 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z']} />;
export const IconExternal = (p: P) => <Icon {...p} paths={['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14L21 3']} />;
export const IconEdit = (p: P) => <Icon {...p} paths={['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']} />;
export const IconClock = (p: P) => <Icon {...p} paths={['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2']} />;
export const IconBall = (p: P) => <Icon {...p} paths={['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 7l4.5 3.3-1.7 5.2H9.2l-1.7-5.2z', 'M12 2v5', 'M21.5 9.5l-5 0.8', 'M2.5 9.5l5 0.8', 'M6 20l3.2-4.5', 'M18 20l-3.2-4.5']} />;
