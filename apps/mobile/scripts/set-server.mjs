// Writes AIMP_APP_URL into capacitor.config.json as server.url (https only), then you run `cap sync`. (The address is public, not a secret.)
import { readFileSync, writeFileSync } from 'node:fs';
const raw = process.env.AIMP_APP_URL ?? '';
let u; try { u = new URL(raw); } catch { u = null; }
if (!u || u.protocol !== 'https:') { console.error('Set AIMP_APP_URL to the deployed https address, e.g. https://app.yourdomain.com/app'); process.exit(1); }
const p = new URL('../capacitor.config.json', import.meta.url);
const cfg = JSON.parse(readFileSync(p, 'utf8'));
cfg.server = { ...cfg.server, url: u.href };
writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
console.log('server.url set to', u.href);
