import type { Metadata } from 'next';
import { contactEmail } from '../../../lib/site/content';
import { Footer, Nav } from '../_ui/chrome';
export const metadata: Metadata = { title: 'Terms of use', alternates: { canonical: '/terms' } };
export default function Terms() {
  return <><Nav /><main className="vs-legal">
    <h1>Terms of use</h1>
    <p>Last updated 6 November 2026. These terms cover using this website and messaging VENTRA.</p>
    <h2>Messages</h2>
    <p>When you contact us, our AI assistant or our team may reply by SMS, email or web chat. Message and data rates may apply. Reply STOP or “unsubscribe” at any time.</p>
    <h2>Demos and labels</h2>
    <p>Previews on this site are labelled Live, Demo or Coming soon. Demos are simulations with sample data; they do not place calls, send messages or book appointments.</p>
    <h2>Prices and offers</h2>
    <p>Prices, guarantees and terms only apply when confirmed in writing by a person at VENTRA.</p>
    <h2>Liability</h2>
    <p>Nothing in these terms excludes rights you have under the Australian Consumer Law. To the extent the law allows, we are not liable for indirect loss from using this website.</p>
    <h2>Contact</h2>
    <p><a href={`mailto:${contactEmail}`}>{contactEmail}</a> · Perth, Western Australia. These terms are governed by the laws of Western Australia.</p>
  </main><Footer /></>;
}
