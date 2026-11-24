'use client';
// The onboarding screens in the app's look: Grainient background, the app tokens and glass skin, and the light/dark switch top right.
// The sign-in screen draws its own full-screen Grainient capsule, so it skips the shared backdrop (one WebGL canvas at a time).
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppBackdrop } from '../app/[business]/app-backdrop';
import { ThemeToggle } from '../app/[business]/theme-toggle';

export function StartShell({ children }: { children: ReactNode }) {
  const own = (usePathname() ?? '').startsWith('/start/account');
  return (
    <>
      {own ? null : <AppBackdrop />}
      <div className="amg amg-skin start-shell">{children}</div>
      <div className="start-theme"><ThemeToggle /></div>
    </>
  );
}
