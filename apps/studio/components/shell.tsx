import Link from 'next/link';
import { logoutAction } from '../app/login/actions';

type Tab = 'team' | 'ads' | 'setter';
export function Shell({ brand, tab, children }: { brand?: { id: string; businessName: string }; tab?: Tab; children: React.ReactNode }) {
  return (
    <div className="sh">
      <header className="sh-top">
        <Link href="/" className="sh-brand"><span className="sh-dot" aria-hidden="true" />{brand ? brand.businessName : 'Studio'}</Link>
        {brand ? (
          <nav className="sh-nav" aria-label="Brand">
            <Link href={`/b/${brand.id}`} aria-current={tab === 'team' ? 'page' : undefined}>AI Team</Link>
            <Link href={`/b/${brand.id}/ads`} aria-current={tab === 'ads' ? 'page' : undefined}>Ad angles</Link>
            <Link href={`/b/${brand.id}/setter`} aria-current={tab === 'setter' ? 'page' : undefined}>AI Setter</Link>
          </nav>
        ) : null}
        <nav className="sh-nav" aria-label="Account">
          {brand ? <Link href="/">All brands</Link> : null}
          <form action={logoutAction}><button className="sh-btn ghost" type="submit">Sign out</button></form>
        </nav>
      </header>
      <main className="sh" style={{ padding: 0 }}>{children}</main>
    </div>
  );
}
