// Line icons for the glass UI kit (24px grid, 1.8 stroke, currentColor).
import type { ReactNode } from 'react';
const s = (d: ReactNode, size = 20) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
export const I = {
  bell: s(<><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>),
  plus: s(<path d="M12 5v14M5 12h14" />, 18),
  more: s(<><circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" /></>),
  up: s(<path d="M7 14l5-5 5 5" />, 16),
  down: s(<path d="M7 10l5 5 5-5" />, 16),
  search: s(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>),
  chevron: s(<path d="M9 6l6 6-6 6" />, 18),
  check: s(<path d="M5 12.5l4.5 4.5L19 7.5" />, 16),
  close: s(<path d="M6 6l12 12M18 6 6 18" />, 18),
  info: s(<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>),
  warn: s(<><path d="M12 4 2.8 19.5h18.4Z" /><path d="M12 10v4.5M12 17h.01" /></>),
  mail: s(<><rect x="3.5" y="5.5" width="17" height="13" rx="3" /><path d="m4.5 7 7.5 6 7.5-6" /></>),
  calendar: s(<><rect x="4" y="5.5" width="16" height="14" rx="3" /><path d="M4 10h16M9 3.5v4M15 3.5v4" /></>),
  spark: s(<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9Z" />),
  doc: s(<><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20Z" /><path d="M14 3.5V8h4M9.5 13h5M9.5 16.5h5" /></>),
  users: s(<><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><path d="M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.8c1.6.6 2.6 2 3 4.2" /></>),
  inbox: s(<><path d="M4 13.5 6.5 5.5h11l2.5 8V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18Z" /><path d="M4 13.5h4.5l1 2h5l1-2H20" /></>),
};
