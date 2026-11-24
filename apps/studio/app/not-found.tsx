import Link from 'next/link';
export default function NotFound() {
  return <main className="sh-login"><div className="sh-card"><h1 className="sh-h1">Not found</h1><p className="sh-muted">That brand or page does not exist.</p><Link href="/">Back to your brands</Link></div></main>;
}
