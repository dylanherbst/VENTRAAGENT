import assert from 'node:assert/strict';
import test from 'node:test';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import {
  COST_SPREAD_SALES, FAMILY_PRICE_DEFAULTS, MIN_MARGIN_MINOR, PRICE_MAX_MINOR, PRICE_MIN_MINOR, estimateFees, formatAud, suggestPrice, usableComparables,
} from '../lib/aimp/catalogue/index.ts';
import { cardFeeMinor } from '../lib/aimp/preview/generate.ts';

const bp = (id: string) => {
  const b = blueprintRegistry.find(id);
  assert.ok(b);
  return b;
};

test('fee estimate: Stripe fee, platform fee and seller net are exact integer cents', () => {
  const f = estimateFees(1200);
  assert.equal(f.stripeFeeMinor, 50); // 1.65% of 1200 = 19.8 -> 20, plus 30
  assert.equal(f.platformFeeMinor, 0);
  assert.equal(f.sellerNetMinor, 1150);
  assert.equal(f.marginMinor, 1150);
  assert.equal(f.isEstimate, true);
  assert.ok(f.notes.some((n) => n.startsWith('ESTIMATE')));
  // a half-cent tie rounds up, with no float drift: 1.65% of 1000 = 16.5 -> 17
  assert.equal(estimateFees(1000).stripeFeeMinor, 47);
});

test('fee estimate: platform fee and cost share reduce the margin', () => {
  const f = estimateFees(1200, { platformFeeBp: 250, costPerSaleMinor: 56 });
  assert.equal(f.platformFeeMinor, 30);
  assert.equal(f.sellerNetMinor, 1120);
  assert.equal(f.marginMinor, 1064);
  assert.equal(f.marginBp, 8867); // 1064 / 1200 = 88.67%
  assert.deepEqual(f.rates, { stripeBp: 165, stripeFixedMinor: 30, platformBp: 250 });
});

test('fee estimate: GST for a registered seller is one eleventh, rounded', () => {
  assert.equal(estimateFees(1100, { gstRegistered: true }).gstMinor, 100);
  assert.equal(estimateFees(1200, { gstRegistered: true }).gstMinor, 109); // 109.09
  assert.equal(estimateFees(1200).gstMinor, 0);
});

test('fee estimate: every price from A$3 to A$100 splits into whole cents that add up', () => {
  for (let p = PRICE_MIN_MINOR; p <= PRICE_MAX_MINOR; p += 1) {
    const f = estimateFees(p, { platformFeeBp: 175, costPerSaleMinor: 56 });
    for (const n of [f.stripeFeeMinor, f.platformFeeMinor, f.sellerNetMinor, f.gstMinor, f.marginMinor, f.marginBp]) assert.ok(Number.isInteger(n), `price ${p}`);
    assert.equal(f.stripeFeeMinor + f.platformFeeMinor + f.sellerNetMinor, p);
    assert.equal(f.marginMinor, f.sellerNetMinor - f.gstMinor - 56);
    // agrees with the profit calculator's card fee to within a cent (it uses floats; this does not)
    assert.ok(Math.abs(estimateFees(p).stripeFeeMinor - cardFeeMinor(p)) <= 1, `price ${p}`);
  }
});

test('fee estimate: refuses fractions, negatives and bad rates', () => {
  assert.throws(() => estimateFees(12.5), RangeError);
  assert.throws(() => estimateFees(-1), RangeError);
  assert.throws(() => estimateFees(Number.NaN), RangeError);
  assert.throws(() => estimateFees(1200, { platformFeeBp: 1.5 }), RangeError);
  assert.throws(() => estimateFees(1200, { platformFeeBp: 20000 }), RangeError);
  assert.throws(() => estimateFees(1200, { costPerSaleMinor: 0.5 }), RangeError);
  assert.equal(estimateFees(0).stripeFeeMinor, 0);
});

test('suggestion without comparables uses the labelled family assumption and explains itself', () => {
  const s = suggestPrice({ blueprint: bp('printable-planner') });
  assert.equal(s.basis, 'family_default');
  assert.equal(s.comparablesUsed, 0);
  assert.equal(s.suggestedMinor, FAMILY_PRICE_DEFAULTS.planner.anchorMinor);
  assert.equal(s.lowMinor, 1000);
  assert.equal(s.highMinor, 2200);
  assert.equal(s.costShareMinor, Math.ceil(2800 / COST_SPREAD_SALES)); // 0 + 800 + 2000 from the blueprint
  assert.ok(s.reasons.some((r) => r.includes('No comparable prices were supplied') && r.includes('not market data')));
  assert.ok(s.reasons.some((r) => r.includes('A$28')), 'names the blueprint setup cost');
  assert.equal(s.isEstimate, true);
  assert.equal(s.fees.priceMinor, s.suggestedMinor);
});

test('suggestion with three or more comparables uses their middle and spread', () => {
  const s = suggestPrice({ blueprint: bp('printable-planner'), comparablePricesMinor: [1800, 900, 1500, 2100, 1200] });
  assert.equal(s.basis, 'comparables');
  assert.equal(s.comparablesUsed, 5);
  assert.equal(s.suggestedMinor, 1500);
  assert.equal(s.lowMinor, 1200);
  assert.equal(s.highMinor, 1800);
  assert.ok(s.reasons.some((r) => r.startsWith('5 comparable prices were supplied')));
});

test('suggestion ignores unusable comparables and needs three to use a band', () => {
  assert.deepEqual(usableComparables([1200, 12.5, -5, 50, 99999, Number.NaN, '900' as unknown as number, 900]), [900, 1200]);
  const s = suggestPrice({ blueprint: bp('printable-tracker'), comparablePricesMinor: [900, 1200, 5, 99999] });
  assert.equal(s.basis, 'family_default');
  assert.equal(s.comparablesUsed, 2);
  assert.ok(s.reasons.some((r) => r.includes('Only 2 comparable prices were usable and at least 3 are needed')));
});

test('suggestion is deterministic', () => {
  const input = { blueprint: bp('niche-kit'), comparablePricesMinor: [1500, 1900, 2500] };
  assert.deepEqual(suggestPrice(input), suggestPrice(input));
});

test('suggestion keeps every sale profitable, for every launch blueprint', () => {
  for (const b of blueprintRegistry.list()) {
    for (const comps of [undefined, [300, 300, 300], [500, 600, 700]]) {
      const s = suggestPrice({ blueprint: b, comparablePricesMinor: comps });
      assert.ok(s.lowMinor <= s.suggestedMinor && s.suggestedMinor <= s.highMinor, b.id);
      assert.ok(s.suggestedMinor >= s.floorMinor, b.id);
      assert.ok(s.lowMinor >= s.floorMinor, b.id);
      assert.ok(s.suggestedMinor >= PRICE_MIN_MINOR && s.highMinor <= PRICE_MAX_MINOR, b.id);
      assert.ok(s.fees.marginMinor >= MIN_MARGIN_MINOR, `${b.id} margin ${s.fees.marginMinor}`);
    }
  }
});

test('the floor lifts a low anchor when fees are high, and says so', () => {
  const s = suggestPrice({ blueprint: bp('printable-planner'), comparablePricesMinor: [300, 300, 300], fees: { platformFeeBp: 9000 } });
  assert.ok(s.floorMinor > 2000, `floor ${s.floorMinor}`);
  assert.ok(s.suggestedMinor >= s.floorMinor);
  assert.ok(s.fees.marginMinor >= MIN_MARGIN_MINOR);
  assert.ok(s.reasons.some((r) => r.includes('raised to keep each sale profitable')));
  // the price just under the floor really would fall short
  const below = estimateFees(s.floorMinor - 1, { platformFeeBp: 9000, costPerSaleMinor: s.costShareMinor });
  assert.ok(below.marginMinor < MIN_MARGIN_MINOR);
});

test('formatAud shows whole dollars without cents', () => {
  assert.equal(formatAud(1200), 'A$12');
  assert.equal(formatAud(1250), 'A$12.50');
});

test('formatAud puts the minus sign before the currency', () => {
  assert.equal(formatAud(-150), '-A$1.50');
  assert.equal(formatAud(-1200), '-A$12');
  assert.equal(formatAud(-5), '-A$0.05');
  assert.equal(formatAud(0), 'A$0');
});

test('when no price in range can be profitable, the suggestion says so and is flagged', () => {
  const s = suggestPrice({ blueprint: bp('printable-planner'), fees: { platformFeeBp: 10000 } });
  assert.equal(s.profitable, false);
  assert.equal(s.floorMinor, PRICE_MAX_MINOR);
  assert.equal(s.suggestedMinor, PRICE_MAX_MINOR);
  assert.ok(s.fees.marginMinor < MIN_MARGIN_MINOR);
  assert.ok(s.reasons.some((r) => r.includes('No profitable price exists in the allowed range')));
  assert.ok(!s.reasons.some((r) => r.includes('is the lowest price that still leaves')));
  // a normal case is flagged profitable
  assert.equal(suggestPrice({ blueprint: bp('printable-planner') }).profitable, true);
});
