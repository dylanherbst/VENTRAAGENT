import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile, restoreProfile, serializeProfile, storageKey } from '../lib/onboarding.ts';
import { blankOffer, formatOfferPrice, offerPriceMinor, saveLocalOffer, offerStorageKey } from '../lib/local-offers.ts';
import {
  businessPlanStorageKey,
  persistBusinessPlanDraft,
  saveBusinessPlanDraft,
  blankBusinessPlanDraftInput,
} from '../lib/local-business-plan-draft.ts';
import {
  offerValidationStorageKey,
  persistOfferValidationWorksheet,
  saveOfferValidationWorksheet,
  snapshotFromLocalOffer,
  blankOfferValidationExperimentInput,
} from '../lib/local-offer-validation-worksheet.ts';
import {
  formatPricingScenarioHours,
  persistPricingScenarioWorksheet,
  pricingScenarioAmountPerHourMinor,
  pricingScenarioEstimateAllowlistKeys,
  pricingScenarioHoursCenti,
  pricingScenarioMarginMinor,
  pricingScenarioStorageKey,
  pricingScenarioWorksheetAllowlistKeys,
  projectPricingScenarioEstimates,
  restorePricingScenarioWorksheet,
  savePricingScenarioWorksheet,
  blankPricingScenarioInput,
} from '../lib/local-pricing-scenario.ts';

const profile = {
  ...blankProfile(),
  name: 'Studio North',
  audience: 'Local founders',
  goal: 'Validate workshop demand',
  expertise: 'Workshops',
  industry: 'Training',
  pathways: ['education', 'business'] as ('education' | 'business')[],
};

const offerDraft = {
  ...blankOffer(profile),
  name: 'Onboarding workshop',
  outcome: 'Hands-on templates for week one',
  price: '499.00',
  delivery: 'Half-day in person',
};

const offers = saveLocalOffer([], offerDraft, profile, 'offer-ws-1');
const snapshot = snapshotFromLocalOffer(offers[0], '2026-03-01T10:00:00.000Z');

const scenarioInput = {
  ...blankPricingScenarioInput('offer-ws-1'),
  alternativePrice: '550.00',
  directCostPerSale: '120.50',
  hoursPerSale: '2.5',
  targetHourlyAmount: '200.00',
  assumptionNote: 'Assumes one facilitator, no venue.',
};

const worksheet = savePricingScenarioWorksheet(scenarioInput, profile.id, snapshot, null);

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};

test('exact decimal conversion and per-hour math without float cents', () => {
  assert.equal(offerPriceMinor('0.29'), 29);
  assert.equal(formatOfferPrice(29), '0.29');
  assert.equal(pricingScenarioHoursCenti('2.5'), 250);
  assert.equal(formatPricingScenarioHours(250), '2.5');
  const margin = pricingScenarioMarginMinor(offerPriceMinor('550.00'), offerPriceMinor('120.50'));
  assert.equal(margin, 42950);
  const perHour = pricingScenarioAmountPerHourMinor(margin, 250);
  assert.equal(perHour, 17180);
  assert.equal(formatOfferPrice(perHour!), '171.80');
});

test('zero hours yields no per-hour estimate', () => {
  const zeroHours = savePricingScenarioWorksheet(
    { ...scenarioInput, hoursPerSale: '0' },
    profile.id,
    snapshot,
    null,
  );
  const projection = projectPricingScenarioEstimates(zeroHours, offers);
  assert.equal(projection.amountPerHourMinor, null);
  assert.equal(projection.amountPerHourLabel, null);
  assert.ok(projection.hoursPerSaleLabel.includes('0'));
});

test('disclaimer and projection allowlist exclude worksheet storage fields', () => {
  const projection = projectPricingScenarioEstimates(worksheet, offers);
  assert.ok(projection.disclaimer.toLowerCase().includes('exclude taxes'));
  assert.ok(projection.disclaimer.toLowerCase().includes('no ai'));
  assert.ok(!projection.disclaimer.toLowerCase().includes('optimal'));
  assert.ok(!projection.disclaimer.toLowerCase().includes('guarantee profit'));
  for (const key of Object.keys(projection)) {
    assert.ok((pricingScenarioEstimateAllowlistKeys() as readonly string[]).includes(key));
  }
  assert.ok(!('alternativePriceMinor' in projection));
  assert.ok(!('profileId' in projection));
});

test('linkage detects missing offer and drift', () => {
  const ok = projectPricingScenarioEstimates(worksheet, offers);
  assert.equal(ok.linkageWarnings.length, 0);

  const missing = projectPricingScenarioEstimates(worksheet, []);
  assert.ok(missing.linkageWarnings.some(w => w.includes('no longer')));

  const drifted = saveLocalOffer(offers, { ...offerDraft, price: '599.00' }, profile, 'offer-ws-1');
  const drift = projectPricingScenarioEstimates(worksheet, drifted);
  assert.ok(drift.linkageWarnings.some(w => w.toLowerCase().includes('drift')));
});

test('overflow guards on extreme minor units and hours', () => {
  const huge = `${Number.MAX_SAFE_INTEGER}`;
  assert.throws(() => offerPriceMinor(huge));
  assert.throws(() => pricingScenarioHoursCenti('10000'));
  assert.throws(() => pricingScenarioAmountPerHourMinor(Number.MAX_SAFE_INTEGER, 1));
});

test('restore rejects corrupt, mismatched and oversize payloads', () => {
  assert.equal(restorePricingScenarioWorksheet(null, profile.id), null);
  for (const raw of [
    '{',
    'null',
    '{}',
    JSON.stringify({ ...worksheet, version: 2 }),
    JSON.stringify({ ...worksheet, profileId: 'other' }),
    ' '.repeat(64001),
  ]) {
    assert.throws(() => restorePricingScenarioWorksheet(raw, profile.id));
  }
  const sanitized = restorePricingScenarioWorksheet(JSON.stringify({ ...worksheet, extra: true }), profile.id)!;
  assert.equal(sanitized.alternativePriceMinor, worksheet.alternativePriceMinor);
  assert.deepEqual(
    [...pricingScenarioWorksheetAllowlistKeys()].sort(),
    [
      'alternativePriceMinor',
      'assumptionNote',
      'directCostPerSaleMinor',
      'hoursPerSaleCenti',
      'offerId',
      'offerSnapshot',
      'profileId',
      'revision',
      'targetHourlyMinor',
      'updatedAt',
      'version',
    ].sort(),
  );
});

test('persist uses optimistic concurrency, quota and stale tab preserve prior raw', () => {
  const storage = fakeStorage();
  const key = pricingScenarioStorageKey(profile.id);
  const raw = persistPricingScenarioWorksheet(storage, profile.id, null, worksheet);
  assert.equal(storage.getItem(key), raw);
  assert.throws(() => persistPricingScenarioWorksheet(storage, profile.id, null, worksheet));
  const edited = savePricingScenarioWorksheet(
    { ...scenarioInput, alternativePrice: '560.00' },
    profile.id,
    snapshot,
    worksheet,
  );
  assert.equal(edited.revision, 2);
  const raw2 = persistPricingScenarioWorksheet(storage, profile.id, raw, edited);
  assert.equal(restorePricingScenarioWorksheet(raw2, profile.id)!.alternativePriceMinor, offerPriceMinor('560.00'));
  const quota = {
    getItem: () => null,
    setItem: () => {
      throw new Error('Quota exceeded');
    },
  };
  assert.throws(() => persistPricingScenarioWorksheet(quota, profile.id, null, worksheet), /Quota/);
  assert.equal(storage.getItem(key), raw2);
});

test('pricing scenario storage does not mutate profile, offer, plan, or validation bytes', () => {
  const storage = fakeStorage();
  storage.setItem(storageKey, serializeProfile(profile));
  const offerRaw = JSON.stringify(offers);
  storage.setItem(offerStorageKey(profile.id), offerRaw);
  const plan = saveBusinessPlanDraft(
    {
      ...blankBusinessPlanDraftInput('offer-ws-1'),
      audienceProblem: 'Founders struggle.',
      offerDifferentiation: 'Workshop.',
      deliveryOperations: 'In person.',
      pricingAssumptions: 'List price.',
      evidenceUncertainty: 'Unknown.',
      nextActions30Day: 'Interview.',
    },
    profile.id,
    snapshot,
    null,
  );
  persistBusinessPlanDraft(storage, profile.id, null, plan);
  const validation = saveOfferValidationWorksheet(
    {
      offerId: 'offer-ws-1',
      hypothesis: 'Test.',
      experiments: [
        {
          ...blankOfferValidationExperimentInput(),
          id: 'exp-1',
          method: 'Poll',
          successCriterion: 'Five replies',
          resultNotes: '',
          marketEvidenceSourceId: '',
        },
      ],
      decision: 'undecided',
    },
    profile.id,
    snapshot,
    null,
  );
  persistOfferValidationWorksheet(storage, profile.id, null, validation);

  const profileBytesBefore = storage.getItem(storageKey);
  const offerBytesBefore = storage.getItem(offerStorageKey(profile.id));
  const planBytesBefore = storage.getItem(businessPlanStorageKey(profile.id));
  const validationBytesBefore = storage.getItem(offerValidationStorageKey(profile.id));

  persistPricingScenarioWorksheet(storage, profile.id, null, worksheet);

  assert.equal(storage.getItem(storageKey), profileBytesBefore);
  assert.equal(storage.getItem(offerStorageKey(profile.id)), offerBytesBefore);
  assert.deepEqual(JSON.parse(storage.getItem(offerStorageKey(profile.id))!), JSON.parse(offerBytesBefore!));
  assert.equal(offers[0].amountMinor, 49900);
  assert.equal(storage.getItem(businessPlanStorageKey(profile.id)), planBytesBefore);
  assert.equal(storage.getItem(offerValidationStorageKey(profile.id)), validationBytesBefore);
  assert.deepEqual(restoreProfile(storage.getItem(storageKey)), profile);
});
