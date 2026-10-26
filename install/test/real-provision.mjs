/* Run by .github/workflows/bundled.yml against a REAL Immich and a REAL Docker, after install.sh has started both.
   It is the only place the Immich API facts this app depends on (account sign-up, API keys and their permissions) are
   checked for real. Not part of the normal test run: it needs the stack to be up.

   usage: node install/test/real-provision.mjs <install dir> [base url]                                                  */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2], B = process.argv[3] || 'http://127.0.0.1:3000';
if (!dir) { console.error('usage: node real-provision.mjs <install dir> [base url]'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let cookie = '';
async function call(method, path, body) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', origin: B, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of (r.headers.getSetCookie?.() || [])) cookie += (cookie ? '; ' : '') + c.split(';')[0];
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, body: json, text };
}
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) process.exitCode = 1; };

const code = readFileSync(join(dir, 'immichset-data', 'setup-code.txt'), 'utf8').trim();
for (let i = 0; i < 90; i++) { try { if ((await fetch(B + '/healthz')).ok) break; } catch {} await sleep(2000); }
ok((await call('POST', '/api/setup/claim', { code })).status === 200, 'setup code accepted');
const PW = 'ci-passphrase-' + Math.random().toString(36).slice(2, 10);
let st; for (let i = 0; i < 150; i++) { st = await call('GET', '/api/setup/immich/status'); if (st.body?.reachable) break; await sleep(4000); }
ok(st.body?.reachable === true, `real Immich answered (version ${st.body?.version})`);
ok(st.body?.initialized === false, 'it is a fresh Immich');
const r = await call('POST', '/api/setup/immich/provision', { mode: 'create', email: 'ci@example.test', password: PW, write: 'addremove', ml: 'off' });
ok(r.status === 200, `provisioned: ${r.status} ${r.status === 200 ? '' : r.text}`);
ok(r.body?.check?.ok === true, 'every real endpoint works with the key we made: ' + JSON.stringify((r.body?.check?.checks || []).filter(c => !c.ok)));
ok(!!r.body?.readKey?.id && !!r.body?.writeKey?.id, 'both keys exist');
ok((await call('POST', '/api/setup/immich/provision', { mode: 'create', email: 'ci@example.test', password: PW })).status === 409, 'a second create is refused');
const again = await call('POST', '/api/setup/immich/provision', { mode: 'signin', email: 'ci@example.test', password: PW, write: 'addremove' });
ok(again.status === 200 && again.body.removedOldKeys === 2, 'signing in again replaces our keys without duplicates');
ok((await call('POST', '/api/setup/admin', { email: 'ci@example.test', password: PW })).status === 200, 'the immichset admin account is made');
await call('PUT', '/api/setup/settings', { PUBLIC_URL: B });
ok((await call('POST', '/api/setup/finish', {})).status === 200, 'setup finished');
let h; for (let i = 0; i < 40; i++) { await sleep(500); h = await (await fetch(B + '/healthz')).json().catch(() => ({})); if (h.ok && !h.setup) break; }
ok(h.ok && !h.setup, 'the app took over');
