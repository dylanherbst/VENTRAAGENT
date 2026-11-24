// Competitor gaps: a customer lists the tools their buyers could use instead, rates what each does at each step from idea to first
// customers, and we show the steps nobody covers well. Each gap says what is proved, what is only an absence, how this business can
// close it, the smallest test, and a landing-page claim that stays locked until the shop can show the result.
// Pure: no network, no AI. Real research (web, reviews) is added later as evidence; this only reasons over what the owner records.

export const STEPS = ['idea', 'demand', 'offer', 'page', 'checkout', 'delivery', 'customers'] as const;
export type Step = (typeof STEPS)[number];
export type Coverage = 'does' | 'partial' | 'not_offered' | 'unknown';

export const STEP_LABEL: Record<Step, string> = {
  idea: 'Choosing what to sell', demand: 'Testing that people will pay', offer: 'Making the offer', page: 'A published sales page',
  checkout: 'Taking payment', delivery: 'Delivering what was bought', customers: 'Finding the first customers',
};
/** How much a first-time seller with a day job feels a miss at this step (1 to 3). A product choice, not a measurement. */
const WEIGHT: Record<Step, number> = { idea: 2, demand: 3, offer: 2, page: 1, checkout: 1, delivery: 1, customers: 3 };

export interface StepRating { coverage: Coverage; note?: string; evidenceUrl?: string }
export interface Friction { text: string; url?: string }
export interface Competitor { id: string; name: string; price?: string; steps: Partial<Record<Step, StepRating>>; frictions: Friction[] }

/** What this business can really do today. 'proved' = a real run exists; 'built' = works on test data; 'planned' = not yet. */
export type Ability = 'proved' | 'built' | 'planned';
export type Abilities = Record<Step, Ability>;

export interface Gap {
  step: Step; label: string; score: number;
  coverage: { does: number; partial: number; notOffered: number; unknown: number };
  /** 'evidenced' = at least one gap rating has a source link; 'absence only' = ratings without a source; 'thin' = mostly unknown. */
  confidence: 'evidenced' | 'absence only' | 'thin';
  stuck: string;
  evidence: { text: string; url?: string }[];
  closeWith: { action: string; href: string; ability: Ability };
  smallestTest: string;
  claim: { text: string; unlocked: boolean; lockedReason: string | null };
}

const CLOSE: Record<Step, { action: string; path: string; test: string; claim: string }> = {
  idea: { action: 'Rank five ideas with the buyer, first-buyer channel, cost and your work for each.', path: '/home',
    test: 'Show 5 people your top idea and ask which one they would buy first.', claim: 'Five ideas ranked for your time, budget and skills.' },
  demand: { action: 'Put a priced pre-order or waitlist page live before you build, with a pass or fail rule.', path: '/website',
    test: 'Send the page to 20 people who fit your buyer. Count how many leave money or an email.', claim: 'Know whether people will pay before you build.' },
  offer: { action: 'Generate the product file, sample, listing and price together.', path: '/products',
    test: 'Show 5 buyers the sample and ask what they would pay for the whole file.', claim: 'A finished product, sample and price in one sitting.' },
  page: { action: 'Publish a sales page from your real product in one approval.', path: '/website',
    test: 'Time a first-time user from product to live page.', claim: 'A live sales page from your real product.' },
  checkout: { action: 'Turn on checkout with a test payment first.', path: '/payments',
    test: 'Make a test purchase and check the buyer gets the right file once.', claim: 'Take a payment and deliver the file once.' },
  delivery: { action: 'Send the paid file automatically; a replay never delivers twice.', path: '/orders',
    test: 'Replay a payment and confirm no second delivery.', claim: 'Paid orders deliver themselves.' },
  customers: { action: 'Get a launch kit written around your product and live link, with replies drafted for your approval.', path: '/marketing',
    test: 'Give 5 people the kit and count first visits and sales over two weeks.', claim: 'Your first-customer posts, written around your actual product.' },
};

const clean = (s: unknown, max: number): string => String(s ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, max);
export function safeUrl(u: unknown): string | undefined {
  const t = clean(u, 300); if (!t) return undefined;
  try { const x = new URL(t); return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : undefined; } catch { return undefined; }
}
/** Accept only well-formed competitor input; unknown steps and bad coverage values are dropped. */
export function sanitizeCompetitor(raw: Partial<Competitor> & { id?: string }): Competitor | null {
  const name = clean(raw.name, 60); if (!name) return null;
  const steps: Competitor['steps'] = {};
  for (const s of STEPS) {
    const r = raw.steps?.[s]; if (!r) continue;
    const coverage = (['does', 'partial', 'not_offered', 'unknown'] as const).includes(r.coverage) ? r.coverage : 'unknown';
    steps[s] = { coverage, note: clean(r.note, 200) || undefined, evidenceUrl: safeUrl(r.evidenceUrl) };
  }
  const frictions = (raw.frictions ?? []).slice(0, 6).map((f) => ({ text: clean(f.text, 240), url: safeUrl(f.url) })).filter((f) => f.text);
  return { id: clean(raw.id, 40) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), name, price: clean(raw.price, 80) || undefined, steps, frictions };
}

export function analyseGaps(competitors: readonly Competitor[], abilities: Abilities): Gap[] {
  const total = competitors.length;
  if (!total) return [];
  const gaps: Gap[] = [];
  for (const step of STEPS) {
    const c = { does: 0, partial: 0, notOffered: 0, unknown: 0 };
    const evidence: Gap['evidence'] = [];
    let linked = false;
    for (const comp of competitors) {
      const r = comp.steps[step] ?? { coverage: 'unknown' as Coverage };
      if (r.coverage === 'does') c.does++; else if (r.coverage === 'partial') c.partial++;
      else if (r.coverage === 'not_offered') c.notOffered++; else c.unknown++;
      if ((r.coverage === 'partial' || r.coverage === 'not_offered') && (r.note || r.evidenceUrl)) {
        evidence.push({ text: `${comp.name}: ${r.note ?? (r.coverage === 'not_offered' ? 'not offered' : 'only partly covered')}`, url: r.evidenceUrl });
        if (r.evidenceUrl) linked = true;
      }
    }
    const missing = c.notOffered + c.partial * 0.5;
    if (missing === 0) continue;
    const known = total - c.unknown;
    const frictionHits = competitors.reduce((n, comp) => n + comp.frictions.filter((f) => stepWords[step].test(f.text)).length, 0);
    for (const comp of competitors) for (const f of comp.frictions) if (stepWords[step].test(f.text)) evidence.push({ text: `${comp.name}: ${f.text}`, url: f.url });
    if (evidence.some((e) => e.url)) linked = true;
    const score = Math.round(((missing / total) * WEIGHT[step] * 10 + Math.min(frictionHits, 3)) * 10) / 10;
    const confidence: Gap['confidence'] = known * 2 < total ? 'thin' : linked ? 'evidenced' : 'absence only';
    const k = CLOSE[step]; const ability = abilities[step];
    const unlocked = ability === 'proved';
    gaps.push({
      step, label: STEP_LABEL[step], score, coverage: c, confidence,
      stuck: `${c.notOffered} of ${total} do not offer this and ${c.partial} cover it only partly.${c.unknown ? ` ${c.unknown} not checked yet.` : ''}`,
      evidence: evidence.slice(0, 6),
      closeWith: { action: k.action, href: k.path, ability },
      smallestTest: k.test,
      claim: { text: k.claim, unlocked, lockedReason: unlocked ? null : ability === 'built' ? 'Works on test data only. Run it for real once, then use this line.' : 'Not built yet. Do not use this line.' },
    });
  }
  return gaps.sort((a, b) => b.score - a.score);
}

const stepWords: Record<Step, RegExp> = {
  idea: /\bidea|choose|what to sell\b/i, demand: /\bdemand|validate|test|pre-?sale|will (people|they) pay\b/i,
  offer: /\bgeneric|product|offer|copy\b/i, page: /\bsite|page|edit|design\b/i, checkout: /\bcheckout|payment|fee\b/i,
  delivery: /\bdeliver|download|file\b/i, customers: /\baudience|traffic|first (sale|customer)|customers?|discover\b/i,
};

export interface GapPlan { gap: Gap; alongside: string }
/** The shop's own plan: its main job stays first; the top gaps are added as small extra tasks, never replacing it. */
export function planAround(mainJob: string, gaps: readonly Gap[], max = 3): { mainJob: string; add: GapPlan[] } {
  return { mainJob: clean(mainJob, 200), add: gaps.slice(0, max).map((gap) => ({ gap, alongside: `${gap.closeWith.action} (${gap.label.toLowerCase()})` })) };
}

/** Honest default: nothing is proved until a real run exists. Callers pass `proved` only with evidence. */
export const BUILT_ON_TEST_DATA: Abilities = { idea: 'built', demand: 'planned', offer: 'built', page: 'built', checkout: 'built', delivery: 'built', customers: 'built' };

/** A worked example (website and store builders for side hustlers), clearly labelled as an example in the UI. Sources are the vendors' own pages. */
export const EXAMPLE_COMPETITORS: Competitor[] = [
  { id: 'wix', name: 'Wix Business Launcher', price: 'Free to start; domain needs an upgrade', frictions: [{ text: 'A reviewer expected a few hours of editing to fix the generated site', url: 'https://www.techradar.com/pro/website-building/wixs-new-ai-tool-aims-to-take-you-from-idea-to-profit-in-record-time' }],
    steps: { idea: { coverage: 'does', note: 'three ideas with a market brief' }, demand: { coverage: 'partial', note: 'market size and SEO data, no customer test', evidenceUrl: 'https://www.wix.com/business/business-launcher' }, offer: { coverage: 'partial', note: 'name, logo and site brief' }, page: { coverage: 'partial', note: 'generated, needs editing' }, checkout: { coverage: 'not_offered', note: 'none described for this tool', evidenceUrl: 'https://support.wix.com/en/article/wix-business-launcher-creating-a-new-business-initiative' }, customers: { coverage: 'partial', note: 'unspecified marketing tools' } } },
  { id: 'buildpad', name: 'Buildpad', price: '$39 to $85 a month', frictions: [],
    steps: { idea: { coverage: 'does', note: 'brainstorms from Reddit pain points' }, demand: { coverage: 'partial', note: 'desk research, no direct customer test mentioned', evidenceUrl: 'https://www.buildpad.io' }, page: { coverage: 'partial', note: 'simple site builder with email capture' }, checkout: { coverage: 'unknown', note: 'not confirmed on its pages' }, customers: { coverage: 'partial', note: 'content calendar the user posts' } } },
  { id: 'durable', name: 'Durable', price: 'Free; $25 and $49 a month', frictions: [],
    steps: { idea: { coverage: 'not_offered' }, demand: { coverage: 'not_offered' }, page: { coverage: 'does', note: 'site in minutes' }, checkout: { coverage: 'partial', note: 'not designed for ecommerce', evidenceUrl: 'https://durable.com/pricing' }, customers: { coverage: 'partial', note: 'local directories on paid plans' } } },
  { id: 'stan', name: 'Stan Store', price: '$29 a month', frictions: [{ text: 'Suits creators who already bring their own traffic', url: 'https://hustlestepladder.substack.com/p/i-researched-a-beginner-choose-the' }],
    steps: { idea: { coverage: 'not_offered' }, demand: { coverage: 'not_offered' }, page: { coverage: 'does' }, checkout: { coverage: 'does' }, customers: { coverage: 'partial', note: 'Instagram auto replies only', evidenceUrl: 'https://stan.store/blog/stan-store-pricing/' } } },
];
