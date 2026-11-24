'use client';
// Light / dark switch, next to the profile icon. The theme lives on <html data-theme>; the choice is remembered in localStorage.
import { useEffect, useState } from 'react';
import './theme-toggle.css';

type Theme = 'light' | 'dark';
const read = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    setTheme(read());
    const o = new MutationObserver(() => setTheme(read()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => o.disconnect();
  }, []);
  return theme;
}

export function ThemeToggle() {
  const theme = useTheme();
  const dark = theme === 'dark';
  const flip = () => {
    const next: Theme = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('aimp-theme', next); } catch { /* private mode: the choice just is not remembered */ }
  };
  return (
    <button type="button" className="wn-theme" onClick={flip} aria-pressed={dark} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
      {dark
        ? <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        : <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>}
    </button>
  );
}
