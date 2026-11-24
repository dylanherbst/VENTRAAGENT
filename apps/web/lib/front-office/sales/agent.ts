// The AI Sales agent (tracker 2.8 to 2.10), foundation. One turn on a booked lead: open from the Setter's handoff, run
// discovery, quote only from the offer config, handle objections from the playbook, and end in a logged outcome (won,
// lost or a dated follow-up) with a summary and a score. Anything outside the config goes to a person.
// Not wired live yet: the orchestrator exposes AgentHooks.sales, but no route passes it until the owner approves.
// Payment links: no provider is chosen (docs/agents/OWNER_TODO.md), so sending one always hands the close to a person.
import { checkedHandoff } from '../handoff';
import type { Agent, Channel, Handoff } from '../handoff';
import type { Llm, ToolResultBlock, ToolSpec, ToolUseBlock } from '../llm';
import type { ChannelAuth, Rpc } from '../orchestrator';
import { canTransition } from '../state';
import type { ContactState } from '../state';
import { transcript } from '../setter/agent';
import { quote } from './config';
import type { Quote, SalesConfig } from './config';
import { SALES_PROMPT_VERSION, salesSystemPrompt } from './prompt';

type Context = {
  contact: { id: string; name: string | null; phone: string | null; email: string | null; state: ContactState; optedOut: boolean; answers: Record<string, string> };
  messages: { direction: 'inbound' | 'outbound'; body: string; agent: string | null; at: string }[];
  appointment: { id: string; starts: string; ends: string; status: string } | null;
  handoffs: { from: string; owner: string; intent: string; summary: string }[];
};
/** A payment link provider. None is chosen yet; paymentLinksFromEnv() returns null until one is built and approved. */
export type PaymentLinks = (i: { contact: string; packageId: string; totalAud: number; description: string }) => Promise<{ url: string }>;
export const paymentLinksFromEnv = (): PaymentLinks | null => null;

export type Outcome = 'won' | 'lost' | 'follow_up';
export type SalesTurn = { reply: string | null; state: ContactState; outcome: Outcome | null; score: number | null; handedTo: Agent | null; tools: string[] };
export type SalesDeps = { llm: Llm; rpc: Rpc; auth: ChannelAuth; config: SalesConfig; now: number; channel: Channel; payments?: PaymentLinks | null; timeZone?: string };
const replyLimit: Partial<Record<Channel, number>> = { sms: 320, 'web-chat': 700, email: 2000 };

export const salesTools: ToolSpec[] = [
  { name: 'quote_package', description: 'Get the exact price for a package, with an allowed discount id if one applies. Call before stating any price.', input_schema: { type: 'object', properties: { package_id: { type: 'string' }, discount_id: { type: 'string' } }, required: ['package_id'] } },
  { name: 'send_payment_link', description: 'Send the payment link for the package the contact chose.', input_schema: { type: 'object', properties: { package_id: { type: 'string' }, discount_id: { type: 'string' } }, required: ['package_id'] } },
  { name: 'record_outcome', description: 'Log how the conversation ended: won, lost, or follow_up with a date. Include a short summary and a score from 1 (cold) to 5 (ready).', input_schema: { type: 'object', properties: { outcome: { type: 'string', enum: ['won', 'lost', 'follow_up'] }, summary: { type: 'string' }, score: { type: 'integer', minimum: 1, maximum: 5 }, follow_up_on: { type: 'string', description: 'ISO date for follow_up, e.g. 2026-11-20' } }, required: ['outcome', 'summary', 'score'] } },
  { name: 'escalate_human', description: 'Custom terms, discounts not listed, contract, legal or refund questions, quotes that need a person, or anything not in the facts.', input_schema: { type: 'object', properties: { intent: { type: 'string' }, summary: { type: 'string' } }, required: ['intent', 'summary'] } },
];

const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const DAY = 86_400_000;

/** The Setter's latest handoff to Sales plus the saved answers, as one line for the prompt. */
export function handoffLine(ctx: Pick<Context, 'contact' | 'handoffs'>): string {
  const h = [...ctx.handoffs].reverse().find(x => x.owner === 'sales');
  const answers = Object.entries(ctx.contact.answers).map(([k, v]) => `${k}: ${v}`).join('; ');
  return [`Name: ${ctx.contact.name ?? 'unknown'}.`, h ? `Setter summary: ${h.summary}` : 'No Setter summary.', `Answers: ${answers || 'none'}.`].join(' ');
}

export async function runSalesTurn(contactId: string, d: SalesDeps): Promise<SalesTurn> {
  const a = { channel: d.auth.channel, channel_key: d.auth.key };
  const ctx = await d.rpc('fo_contact_context', { ...a, contact: contactId }) as Context;
  const used: string[] = [];
  let state = ctx.contact.state, outcome: Outcome | null = null, score: number | null = null, handedTo: Agent | null = null;
  let lastQuote: Quote | null = null, linkSent = false;
  if (ctx.contact.optedOut || state !== 'booked') return { reply: null, state, outcome, score, handedTo, tools: used };

  const tz = d.timeZone ?? 'Australia/Perth';
  const nowLabel = new Intl.DateTimeFormat('en-AU', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(d.now);
  const system = salesSystemPrompt(d.config, `${nowLabel} (${tz})`, d.channel, handoffLine(ctx));
  const messages = transcript(ctx.messages);

  async function moveTo(target: ContactState, reason: string) {
    if (state === target) return;
    if (!canTransition(state, target)) throw new Error(`Cannot move from ${state} to ${target}.`);
    state = await d.rpc('fo_set_state', { ...a, contact: contactId, new_state: target, agent_name: 'sales', reason: reason.slice(0, 500) }) as ContactState;
  }
  async function handoff(owner: Agent, intent: string, summary: string, nextAction: string) {
    const h: Handoff = checkedHandoff({
      contact: { id: contactId, name: ctx.contact.name, phone: ctx.contact.phone, email: ctx.contact.email, state },
      channel: d.channel, intent: intent || 'follow up', answers: ctx.contact.answers, summary: summary || 'See the conversation.', nextAction, from: 'sales', owner,
    });
    await d.rpc('fo_record_handoff', { ...a, contact: contactId, handoff: h });
    handedTo = owner;
  }

  async function run(t: ToolUseBlock): Promise<string> {
    used.push(t.name);
    const input = t.input ?? {};
    switch (t.name) {
      case 'quote_package': {
        const q = quote(d.config, str(input.package_id, 40), str(input.discount_id, 40) || null);
        if (!q) return `Unknown package. Use one of: ${d.config.packages.map(p => p.id).join(', ')}.`;
        lastQuote = q;
        if (q.needsPerson) return `${q.needsPerson} Do not state a price. Tell the contact a person will confirm it, and call escalate_human.`;
        return `${q.name}: A$${(q.totalAud as number).toLocaleString('en-AU')} ${q.billing}. State exactly this.`;
      }
      case 'send_payment_link': {
        const q = quote(d.config, str(input.package_id, 40), str(input.discount_id, 40) || null);
        if (!q) return 'Unknown package.';
        lastQuote = q;
        const payments = d.payments === undefined ? paymentLinksFromEnv() : d.payments;
        if (q.needsPerson || !payments || q.totalAud === null) {
          const why = q.needsPerson ?? 'Payment links are not set up yet.';
          await handoff('human', 'close the deal', `Ready to buy ${q.name}. ${why}`, 'A person sends the agreement and payment details');
          return `${why} A person has been asked to send the agreement and payment details. Tell the contact that, and do not share any link.`;
        }
        const r = await payments({ contact: contactId, packageId: q.packageId, totalAud: q.totalAud, description: `${d.config.businessName} ${q.name}` });
        if (!/^https:\/\//.test(r.url)) throw new Error('Payment provider returned no link.');
        linkSent = true;
        return `Payment link: ${r.url}. Share it exactly.`;
      }
      case 'record_outcome': {
        const kind = input.outcome, summary = str(input.summary, 3000);
        const s = typeof input.score === 'number' && Number.isInteger(input.score) && input.score >= 1 && input.score <= 5 ? input.score : null;
        if (kind !== 'won' && kind !== 'lost' && kind !== 'follow_up') return 'Unknown outcome.';
        if (!summary || s === null) return 'Give a summary and a score from 1 to 5.';
        const line = `Outcome: ${kind}. Score ${s}/5. ${summary}`;
        if (kind === 'won') {
          const q = lastQuote as Quote | null;
          if (!linkSent || !q || q.needsPerson) return 'Not yet: the deal is won only once a payment link was sent for a quoted package. Otherwise call escalate_human.';
          await moveTo('customer', 'Deal won');
          await handoff('onboarding', 'onboard new customer', `${line} Terms: ${q.name}, A$${q.totalAud} ${q.billing}${q.discountId ? `, discount ${q.discountId}` : ''}.`, 'Start onboarding; Setter asks for a referral after go-live');
        } else if (kind === 'lost') {
          await moveTo('nurture', 'Said no on the sales call');
          await handoff('setter', 'nurture', line, 'Monthly nurture; no sales follow-up');
        } else {
          const on = Date.parse(str(input.follow_up_on, 30));
          if (!Number.isFinite(on) || on < d.now - DAY || on > d.now + 90 * DAY) return 'Give the follow-up date they agreed, within the next 90 days.';
          await handoff('human', 'dated follow-up', `${line} Follow up on ${new Date(on).toISOString().slice(0, 10)}.`, `Follow up on ${new Date(on).toISOString().slice(0, 10)}`);
        }
        outcome = kind; score = s;
        return `Logged as ${kind}. Close politely.`;
      }
      case 'escalate_human':
        await handoff('human', str(input.intent, 200), str(input.summary, 4000), 'A person replies to the contact');
        return 'A person has been asked to follow up. Tell the contact someone will be in touch soon. Do not promise anything else.';
      default:
        return 'Unknown tool.';
    }
  }

  let reply = '';
  for (let round = 0; round < 6; round++) {
    const res = await d.llm({ system, messages, tools: salesTools });
    messages.push({ role: 'assistant', content: res.content });
    const calls = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    reply = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join(' ').trim();
    if (!calls.length || res.stopReason !== 'tool_use') break;
    const results: ToolResultBlock[] = [];
    for (const c of calls) {
      try { results.push({ type: 'tool_result', tool_use_id: c.id, content: await run(c) }); }
      catch (e) { results.push({ type: 'tool_result', tool_use_id: c.id, content: e instanceof Error ? e.message : 'Tool failed.', is_error: true }); }
    }
    messages.push({ role: 'user', content: results });
  }
  const limit = replyLimit[d.channel] ?? 600;
  const text = ((d.channel === 'email' ? reply : reply.replace(/\s+/g, ' ')).trim().slice(0, limit)) || null;
  if (text) await d.rpc('fo_log_outbound', { ...a, contact: contactId, message: text, agent_name: 'sales', prompt: SALES_PROMPT_VERSION });
  return { reply: text, state, outcome, score, handedTo, tools: used };
}
