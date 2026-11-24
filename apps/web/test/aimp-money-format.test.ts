// AMP-099: money text in buyer emails and site-version messages follows the currency's own decimals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeDeliveryEmail, formatMoney } from '../lib/aimp/fulfilment/email.ts';
import { plainError, plainErrors } from '../lib/aimp/site-versions/messages.ts';

test('email formatMoney uses the currency decimals', () => {
  assert.equal(formatMoney(500, 'JPY'), '500 JPY');
  assert.equal(formatMoney(1500, 'KWD'), '1.500 KWD');
  assert.equal(formatMoney(1250, 'USD'), '12.50 USD');
  assert.equal(formatMoney(1250, 'AUD'), 'A$12.50 AUD'); // unchanged from before
});

test('delivery email Paid line uses the currency decimals', () => {
  const paid = (amountMinor: number, currency: string): string => {
    const e = composeDeliveryEmail({
      order: { id: 'ord_1', title: 'Guide', amountMinor, currency, buyerEmail: 'b@example.com', productVersion: 1 },
      storeName: 'Shop', downloadUrl: 'https://example.com/d/x', grant: { expiresAt: '2030-01-01T00:00:00Z', maxDownloads: 3 }, reissue: false,
    } as Parameters<typeof composeDeliveryEmail>[0]);
    return e.text.split('\n').find((l) => l.startsWith('Paid: ')) ?? '';
  };
  assert.equal(paid(500, 'JPY'), 'Paid: 500 JPY');
  assert.equal(paid(1500, 'KWD'), 'Paid: 1.500 KWD');
  assert.equal(paid(1250, 'USD'), 'Paid: 12.50 USD');
  assert.equal(paid(1250, 'AUD'), 'Paid: A$12.50 AUD');
});

test('site-version price message uses the currency decimals when a currency is given', () => {
  const rule = 'products[0].price: whole cents between 500 and 1500';
  assert.equal(plainError(rule, 'JPY'), 'Product 1 price must be a price between 500 JPY and 1,500 JPY.');
  assert.equal(plainError(rule, 'KWD'), 'Product 1 price must be a price between 0.500 KWD and 1.500 KWD.');
  assert.equal(plainError(rule, 'USD'), 'Product 1 price must be a price between 5.00 USD and 15.00 USD.');
  assert.deepEqual(plainErrors([rule], 'JPY'), ['Product 1 price must be a price between 500 JPY and 1,500 JPY.']);
});

test('site-version price message without a currency keeps the old dollar text', () => {
  const rule = 'products[0].price: whole cents between 100 and 123456';
  const want = 'Product 1 price must be a price between $1.00 and $1,234.56.';
  assert.equal(plainError(rule), want);
  assert.equal(plainError(rule, 'AUD'), want);
  assert.deepEqual(plainErrors([rule]), [want]);
});
