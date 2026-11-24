// Blueprint registry: lookup by id + version; old versions stay retrievable (AMP-011).
// The four launch blueprints share one document engine and one set of inputs, steps, QA, fulfilment and marketing
// defaults; each family only differs in its page sections. Pilot family: printable planner.
import { compareSemver, isSemver, validateBlueprint } from './schema.ts';
import type { BlueprintDefinition, BuildStep, InputSpec, OutputSection } from './schema.ts';

export const sharedInputs: InputSpec[] = [
  { key: 'niche', label: 'Niche', type: 'text', min: 2, max: 60 },
  { key: 'audience', label: 'Who it is for', type: 'text', min: 3, max: 120 },
  { key: 'pricePointMinor', label: 'Price point', type: 'integer', min: 300, max: 10000, unit: 'whole cents, AUD incl. GST' },
  { key: 'weeklyHours', label: 'Hours you can give each week', type: 'integer', min: 1, max: 40, unit: 'hours' },
  { key: 'budgetMinor', label: 'Launch budget', type: 'integer', min: 0, max: 1000000, unit: 'whole cents, AUD' },
];

const sharedSteps: BuildStep[] = [
  { title: 'Confirm the idea', ownerAction: 'Read the product outline and approve the niche and audience.', hours: 0.5 },
  { title: 'Generate the draft document', ownerAction: 'Review the generated pages and note anything to change.', hours: 1.5 },
  { title: 'Run the quality checks', ownerAction: 'Work through the QA checklist and fix any failed check.', hours: 1 },
  { title: 'Make cover and listing images', ownerAction: 'Approve the cover and the mockup images.', hours: 1 },
  { title: 'Set up delivery', ownerAction: 'Upload the final file and send yourself a test order.', hours: 0.5 },
  { title: 'Approve the launch', ownerAction: 'Approve the listing and the first week of posts before anything goes out.', hours: 0.5 },
];

const sharedQa = [
  'Every page prints cleanly on A4 and US Letter with nothing cut off.',
  'Text is readable at normal print size and fonts are embedded.',
  'No page contains placeholder text, broken links or another seller’s branding.',
  'The file opens on a phone, a laptop and a printer-ready PDF viewer.',
  'The listing makes no income, health or legal promises.',
  'A test purchase delivers the file to the buyer.',
];

const sharedMarketing = {
  channels: ['Pinterest', 'Email'],
  launchContent: [
    { day: 0, channel: 'Email', title: 'Launch announcement to your list' },
    { day: 1, channel: 'Pinterest', title: 'Pin 1: cover and what is inside' },
    { day: 3, channel: 'Pinterest', title: 'Pin 2: one page shown in use' },
    { day: 7, channel: 'Pinterest', title: 'Pin 3: a tip related to the niche' },
    { day: 10, channel: 'Email', title: 'Follow-up with a short how-to-use guide' },
    { day: 14, channel: 'Pinterest', title: 'Pin 4: best-seller style close-up' },
  ],
};

function make(
  id: string,
  family: BlueprintDefinition['family'],
  title: string,
  summary: string,
  sections: OutputSection[],
  extraCost: BlueprintDefinition['costDefaults']['lines'] = [],
): BlueprintDefinition {
  return {
    id, version: '1.0.0', family, engine: 'document', businessModel: 'digital-templates', title, summary,
    requiredInputs: structuredClone(sharedInputs),
    output: { formats: ['PDF', 'ZIP'], sections },
    costDefaults: {
      currency: 'AUD',
      lines: [
        { label: 'Design tool (free tier)', amountMinor: 0, note: 'Free tiers are enough to start.' },
        { label: 'Cover and mockup images', amountMinor: 800, note: 'One set of listing images.' },
        { label: 'Pinterest test promotion', amountMinor: 2000, note: 'Optional; skip it and the plan still works.' },
        ...extraCost,
      ],
    },
    steps: structuredClone(sharedSteps),
    qaChecklist: [...sharedQa],
    fulfilment: {
      method: 'digital-download',
      delivery: 'The buyer gets a download link straight after payment; no shipping and no stock.',
      supportNote: 'Answer questions and resend the link within 2 business days.',
    },
    marketing: structuredClone(sharedMarketing),
  };
}

export const printablePlanner = make(
  'printable-planner', 'planner', 'Printable planner',
  'A dated or undated planner buyers print at home.',
  [
    { title: 'Cover and how to use', pages: 2 },
    { title: 'Year at a glance', pages: 2 },
    { title: 'Monthly spreads', pages: 12 },
    { title: 'Weekly pages', pages: 26 },
    { title: 'Notes and goals', pages: 6 },
  ],
);

export const printableTracker = make(
  'printable-tracker', 'tracker', 'Printable tracker',
  'A habit, fitness or money tracker buyers print and fill in.',
  [
    { title: 'Cover and how to use', pages: 2 },
    { title: 'Tracker grids', pages: 6 },
    { title: 'Monthly review', pages: 3 },
    { title: 'Notes', pages: 2 },
  ],
);

export const printableChecklist = make(
  'printable-checklist', 'checklist', 'Printable checklist',
  'A step-by-step checklist for one task or event.',
  [
    { title: 'Cover and how to use', pages: 1 },
    { title: 'Checklist pages', pages: 4 },
    { title: 'Notes', pages: 1 },
  ],
);

export const nicheKit = make(
  'niche-kit', 'niche-kit', 'Niche kit',
  'A small bundle of planner, tracker and checklist pages for one niche.',
  [
    { title: 'Cover and how to use', pages: 2 },
    { title: 'Planner pages', pages: 8 },
    { title: 'Tracker pages', pages: 4 },
    { title: 'Checklist pages', pages: 3 },
    { title: 'Bonus notes page', pages: 1 },
  ],
  [{ label: 'Bundle cover image', amountMinor: 400, note: 'One extra image for the bundle listing.' }],
);

/** Written by the seller in the Offer builder, never generated by AI. Only the opening pages are fixed; the rest is the seller's own content,
 *  so it is kept OUT of `launchBlueprints` (the four AI-generated families) and added to the registry separately. */
export const sellerWorkbook = make(
  'seller-workbook', 'checklist', 'Seller workbook',
  'A checklist, workbook or guide written by the seller from what they know.',
  [{ title: 'Start here', pages: 2 }],
);

export const launchBlueprints: readonly BlueprintDefinition[] = [printablePlanner, printableTracker, printableChecklist, nicheKit];

export interface BlueprintRegistry {
  /** Exact id + version. */
  get(id: string, version: string): BlueprintDefinition | undefined;
  /** Newest version when none is given. */
  find(id: string, version?: string): BlueprintDefinition | undefined;
  versions(id: string): string[];
  list(): BlueprintDefinition[];
}

export type RegistryResult = { ok: true; registry: BlueprintRegistry } | { ok: false; errors: string[] };

/** Build a registry. Invalid or duplicate blueprints are reported together; nothing is thrown. */
export function createRegistry(definitions: readonly BlueprintDefinition[]): RegistryResult {
  const errors: string[] = [];
  const byKey = new Map<string, BlueprintDefinition>();
  for (const d of definitions) {
    const v = validateBlueprint(d);
    const name = `${(d as { id?: unknown }).id}@${(d as { version?: unknown }).version}`;
    if (!v.ok) { for (const e of v.errors) errors.push(`${name}: ${e}`); continue; }
    if (byKey.has(name)) { errors.push(`${name}: this id and version are already registered.`); continue; }
    byKey.set(name, d);
  }
  if (errors.length) return { ok: false, errors };
  const registry: BlueprintRegistry = {
    get: (id, version) => byKey.get(`${id}@${version}`),
    versions: (id) => [...byKey.values()].filter((d) => d.id === id).map((d) => d.version).sort(compareSemver),
    find(id, version) {
      if (version !== undefined) return isSemver(version) ? byKey.get(`${id}@${version}`) : undefined;
      const vs = registry.versions(id);
      const latest = vs[vs.length - 1];
      return latest ? byKey.get(`${id}@${latest}`) : undefined;
    },
    list: () => [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id) || compareSemver(a.version, b.version)),
  };
  return { ok: true, registry };
}

const built = createRegistry([...launchBlueprints, sellerWorkbook]);
if (!built.ok) throw new Error(`Built-in blueprints are invalid: ${built.errors.join(' ')}`);
/** The built-in registry. Throws only at load time if the shipped data is wrong (caught by tests). */
export const blueprintRegistry: BlueprintRegistry = built.registry;
