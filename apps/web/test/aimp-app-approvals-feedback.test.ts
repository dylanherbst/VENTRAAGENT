// AMP-136: after an Approvals decision the result is announced and focus lands on it, and the allowance box goes back to the saved value
// after a refused save. The view (TSX) cannot be loaded by the node test runner, so like the sibling test this checks the source text.
// Not proven here: real focus movement or screen reader output (no browser in this session).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const view = readFileSync(new URL('../app/app/[business]/approvals/approvals-view.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/app/[business]/approvals/approvals.css', import.meta.url), 'utf8');

test('AMP-136 the result sits in an always-present polite live region that takes focus when a result arrives', () => {
  assert.match(view, /<div ref=\{statusRef\} tabIndex=\{-1\} role="status" aria-live="polite"/);
  // The notice inside draws no second live role, so the result is not read twice.
  assert.match(view, /<GlassNotice tone=\{notice\.ok \? 'success' : 'error'\} live="none"/);
  assert.match(view, /useEffect\(\(\) => \{ if \(notice\) statusRef\.current\?\.focus\(\{ preventScroll: true \}\); \}, \[notice\]\)/);
  // The region is drawn before the lists, and a refusal and a success both set a notice (so both move focus).
  assert.ok(view.indexOf('role="status"') < view.indexOf('data-testid="pending"'));
  assert.match(view, /setNotice\(\{ ok: r\.ok,/);
  assert.match(view, /catch \{ setNotice\(\{ ok: false, text: UNREACHABLE \}\); \}/);
  assert.match(css, /\.aap-status:focus-visible \{[^}]*outline: 3px solid/);
});

test('AMP-136 a refused allowance save puts the saved value back in the box, and a re-read resets it too', () => {
  assert.match(view, /if \(op\.kind === 'cap' && !r\.ok\) setCap\(String\(vm\.usage\.limit\)\)/);
  assert.match(view, /useEffect\(\(\) => \{ setCap\(String\(vm\.usage\.limit\)\); \}, \[vm\.usage\.limit\]\)/);
  // The reset happens before the notice is set, so the box is already right when focus moves.
  assert.ok(view.indexOf('setCap(String(vm.usage.limit)); // a refused') < view.indexOf('setNotice({ ok: r.ok,'));
});
