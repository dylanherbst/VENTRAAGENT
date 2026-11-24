import type { Metadata } from 'next';
import { contactEmail } from '../../../lib/site/content';
import { Footer, Nav } from '../_ui/chrome';
export const metadata: Metadata = { title: 'Privacy policy', alternates: { canonical: '/privacy' } };
// Draft for the owner to have checked. Required by Google OAuth verification for the calendar connection.
export default function Privacy() {
  const mail = <a href={`mailto:${contactEmail}`}>{contactEmail}</a>;
  return <><Nav /><main className="vs-legal">
    <h1>Privacy policy</h1>
    <p>Last updated 6 November 2026. This policy explains how VENTRA, a business based in Perth, Western Australia (“VENTRA”, “we”), handles personal information. We follow the Australian Privacy Principles in the Privacy Act 1988 (Cth).</p>
    <h2>What we collect</h2>
    <ul><li>Contact details you give us or that come with your message: name, mobile number, email address, and a random web chat visitor ID.</li><li>The messages you send us by SMS, email or web chat, and our replies.</li><li>Your answers to our questions about your business and needs, and details of any appointment you book.</li><li>Whether you have asked us to stop contacting you.</li><li>If you allow it, counts of visits and clicks on this site. No advertising trackers.</li></ul>
    <h2>How we use it</h2>
    <ul><li>To reply to your enquiry, work out whether we can help, book and remind you of appointments, and follow up if you go quiet.</li><li>To keep a record of what was said, including which version of our AI assistant wrote each message, so we can check quality and fix mistakes.</li><li>We do not sell personal information and do not use it for advertising.</li></ul>
    <h2>AI assistant</h2>
    <p>Many of our replies are written by an AI assistant. It says it is an AI assistant, and a person can take over at any time; just ask.</p>
    <h2>Google user data</h2>
    <p>VENTRA connects to Google Calendar for our own business calendar. We read free and busy times to offer appointment times, and we create, update or cancel the events for appointments booked with us. We do not read the content of other calendar events, and we do not use Google data for advertising or to train AI models.</p>
    <p>VENTRA’s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
    <h2>Who we share it with</h2>
    <p>We use service providers to run VENTRA: Supabase (database), Anthropic (AI model), Twilio (SMS), Postmark (email) and Google (calendar). They process information for us under their own privacy and security terms. Some are located outside Australia, including the United States. We do not disclose personal information to anyone else unless the law requires it.</p>
    <h2>Opting out</h2>
    <p>Reply STOP to any text, or “unsubscribe” to any email, and we stop automated messages straight away. You can also email {mail}.</p>
    <h2>Keeping it safe and for how long</h2>
    <p>Information is stored with access controls and encryption in transit. We keep conversation records for as long as we need them to provide our service and meet our legal obligations, then delete or de-identify them.</p>
    <h2>Access, correction and complaints</h2>
    <p>You can ask to see or correct the information we hold about you, or ask us to delete it, by emailing {mail}. If you are not happy with our response, you can contact the Office of the Australian Information Commissioner at <a href="https://www.oaic.gov.au">oaic.gov.au</a>.</p>
  </main><Footer /></>;
}
