import Link from 'next/link';

// Pointer page inside the tools list. The showcase itself needs a full-bleed backdrop, and the tools layout wraps
// every page in the VENTRA shell, so the showcase lives at /start/showcase.
export default function AimpGlassTools() {
  return <main>
    <h1>Peach &amp; Lavender Glass UI library</h1>
    <p><span className="v-status" data-testid="page-mode">DEMO · sample content, no account or data is touched</span></p>
    <p>The component showcase (three reference screens, every component and state) opens on its own full-screen backdrop.</p>
    <ul>
      <li><Link href="/start/showcase">Open the component showcase</Link></li>
      <li><Link href="/start">Open the real entry flow: Welcome</Link></li>
      <li><Link href="/start/account">Create account or sign in</Link></li>
      <li><Link href="/start/tour">Feature overview</Link></li>
      <li><Link href="/start/goals">Goal questions</Link></li>
    </ul>
  </main>;
}
