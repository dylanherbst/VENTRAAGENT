import Link from 'next/link';
import { contactEmail } from '../../../lib/site/content';
import { GetStartedButton } from './get-started';
export function Nav() {
  return <header className="vs-nav"><div className="vs-wrap">
    <Link href="/site" className="vs-logo" aria-label="VENTRA home"><i aria-hidden="true" />VENTRA</Link>
    <nav className="vs-nav-links" aria-label="Main"><a href="/site#ai-team">AI team</a><a href="/site#in-action">Product</a><a href="/site#pricing">Pricing</a><a href="/site#faq">FAQ</a></nav>
    <GetStartedButton from="nav" small />
  </div></header>;
}
export function Footer() {
  return <footer className="vs-footer"><div className="vs-wrap">
    <span>© 2026 VENTRA · Perth, Western Australia</span>
    <nav aria-label="Footer"><Link href="/site/privacy">Privacy</Link><Link href="/site/terms">Terms</Link><a href={`mailto:${contactEmail}`}>{contactEmail}</a></nav>
  </div></footer>;
}
