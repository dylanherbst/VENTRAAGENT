// Pure rules for what the desktop window may open. No Electron imports so they can be tested with plain node.
'use strict';

/** The app's own origin, from AIMP_APP_URL (https required except localhost). Returns null when the value is unusable. */
function appOrigin(raw) {
  try {
    const u = new URL(raw);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
    return u.origin;
  } catch { return null; }
}

/** 'inside' = load in the app window, 'external' = hand to the default browser, 'block' = refuse. */
function classify(target, origin) {
  let u;
  try { u = new URL(target); } catch { return 'block'; }
  if (u.origin === origin) return 'inside';
  if (u.protocol === 'https:') return 'external';
  return 'block';
}

module.exports = { appOrigin, classify };
