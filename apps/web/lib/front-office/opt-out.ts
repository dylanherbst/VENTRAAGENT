// Opt-out detection (master plan guardrails; AU Spam Act 2003: a working unsubscribe, honoured promptly).
// Any of these as the whole message halts all automation for the contact on every channel and is logged.
const words = ['stop', 'stopall', 'stop all', 'unsubscribe', 'remove me', 'opt out', 'optout', 'quit', 'do not contact me', "don't contact me", 'leave me alone'];
const normalise = (s: string) => s.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function isOptOut(body: string): boolean {
  const t = normalise(body);
  return words.includes(t) || /^(please )?(stop|unsubscribe|remove me)( (texting|messaging|contacting) me)?( please)?$/.test(t);
}
export const OPT_OUT_CONFIRMATION = 'You are unsubscribed and will not get more messages from us. Reply START to opt back in.';
export const OPT_OUT_PROMPT_VERSION = 'system/opt-out-confirmation@1';
const optInWords = ['start', 'unstop', 'subscribe', 'opt in', 'yes start'];
/** START (or similar) as the whole message re-subscribes a contact who opted out. */
export function isOptIn(body: string): boolean {
  return optInWords.includes(normalise(body));
}
