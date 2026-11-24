'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { appOrigin, classify } = require('../navigation.js');

test('only https (or http on localhost) is accepted as the app address', () => {
  assert.equal(appOrigin('https://app.example.com/app'), 'https://app.example.com');
  assert.equal(appOrigin('http://localhost:3000/app'), 'http://localhost:3000');
  assert.equal(appOrigin('http://app.example.com'), null);
  assert.equal(appOrigin('file:///etc/passwd'), null);
  assert.equal(appOrigin('nonsense'), null);
});

test('own pages stay inside, other https pages open in the browser, everything else is blocked', () => {
  const o = 'https://app.example.com';
  assert.equal(classify('https://app.example.com/app/b1/home', o), 'inside');
  assert.equal(classify('https://checkout.stripe.com/c/pay/x', o), 'external');
  assert.equal(classify('http://evil.test', o), 'block');
  assert.equal(classify('file:///etc/passwd', o), 'block');
  assert.equal(classify('javascript:alert(1)', o), 'block');
  assert.equal(classify('not a url', o), 'block');
});
