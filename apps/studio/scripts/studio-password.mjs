// Makes the two login settings for the studio. Run it yourself: npm run password
// It asks for a password (hidden), then prints STUDIO_PASSWORD_HASH and a fresh STUDIO_SESSION_SECRET to paste into .env.local / Vercel.
// The password itself is never printed or stored.
import { randomBytes, scrypt } from 'node:crypto';
import { stdin, stdout } from 'node:process';

function ask(q) {
  return new Promise((resolve) => {
    stdout.write(q); let s = '';
    stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding('utf8');
    const on = (c) => {
      if (c === '\r' || c === '\n') { stdin.setRawMode?.(false); stdin.pause(); stdin.off('data', on); stdout.write('\n'); resolve(s); }
      else if (c === '\u0003') process.exit(1);
      else if (c === '\u007f') s = s.slice(0, -1);
      else s += c;
    };
    stdin.on('data', on);
  });
}
const pw = await ask('New studio password (12+ characters): ');
if (pw.length < 12) { console.error('Too short. Use at least 12 characters.'); process.exit(1); }
if ((await ask('Type it again: ')) !== pw) { console.error('They did not match.'); process.exit(1); }
const salt = randomBytes(16), N = 32768;
const hash = await new Promise((res, rej) => scrypt(pw, salt, 64, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
console.log('\nAdd these two lines to apps/studio/.env.local (and to the studio project in Vercel):\n');
console.log(`STUDIO_PASSWORD_HASH=scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`);
console.log(`STUDIO_SESSION_SECRET=${randomBytes(32).toString('hex')}`);
