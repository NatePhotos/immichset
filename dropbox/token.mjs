#!/usr/bin/env node
/* One-time helper: turns your Dropbox app's key and secret into the refresh token this server uses.
     node dropbox/token.mjs [app key] [app secret]
   Leave the key and secret off and it asks for them. It prints an address to open, you approve the app there, paste the code back, and it prints the token. */
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const args = process.argv.slice(2);
/* given on the command line, or asked for one at a time */
const key = (args[0] || await rl.question('App key: ')).trim();
const secret = (args[1] || await rl.question('App secret: ')).trim();
if (!key || !secret) { console.error('Both the app key and the app secret are needed.'); process.exit(1); }

console.log('\n1. Open this address, sign in, and click Allow:\n');
console.log(`   https://www.dropbox.com/oauth2/authorize?client_id=${encodeURIComponent(key)}&response_type=code&token_access_type=offline\n`);
const code = (await rl.question('2. Paste the code Dropbox shows you: ')).trim();
rl.close();

const r = await fetch('https://api.dropbox.com/oauth2/token', {
  method: 'POST',
  headers: { authorization: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ code, grant_type: 'authorization_code' }).toString(),
});
const b = await r.json().catch(() => ({}));
if (!r.ok || !b.refresh_token) { console.error('\nDropbox said no:', b.error_description || b.error || r.status); process.exit(1); }
console.log('\nYour refresh token (paste it into Connections > Dropbox):\n\n   ' + b.refresh_token + '\n');
