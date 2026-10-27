import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeImmich, fakeResend } from './fake-services.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

let imm, rs, port, B, data, app, logs = '';
const ENV_KEYS = ['IMMICH-READ-KEY-SECRET', 're_FAKE-RESEND-SECRET'];

function boot(extra = {}, dir = data) {
  logs = '';
  app = spawn('node', [join(ROOT, 'server.mjs')], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, PORT: String(port), DATA_DIR: dir, WEB_DIR: join(ROOT, 'web'),
    HEALTH_MINUTES: '0', PREZIP: 'off', RESEND_API_URL: rs.url, ...extra } });
  app.stdout.on('data', d => logs += d); app.stderr.on('data', d => logs += d);
}
async function up(ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { try { const r = await fetch(B + '/healthz'); if (r.ok) return r.json(); } catch {} await sleep(100); } throw new Error('did not start\n' + logs); }
const stop = () => new Promise(r => { if (!app || app.exitCode !== null) return r(); app.once('exit', r); app.kill(); });

class Browser {
  constructor(ip = '203.0.113.9') { this.cookie = ''; this.ip = ip; }
  async call(method, path, body, { origin = B, json = true } = {}) {
    const headers = { 'x-forwarded-for': this.ip, ...(this.cookie ? { cookie: this.cookie } : {}) };
    if (origin) headers.origin = origin;
    if (json) headers['content-type'] = 'application/json';
    const r = await fetch(B + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const sc = r.headers.getSetCookie?.() || []; for (const c of sc) { const [kv] = c.split(';'); this.cookie = (this.cookie ? this.cookie + '; ' : '') + kv; }
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, body: j, text, headers: r.headers };
  }
}

before(async () => {
  imm = await fakeImmich(); rs = await fakeResend(); port = await freePort(); B = `http://127.0.0.1:${port}`;
  data = mkdtempSync(join(tmpdir(), 'fresh-'));
});
after(async () => { await stop(); imm?.close(); rs?.close(); });

test('a brand-new install starts in setup and shows nothing else', async () => {
  boot({});
  const h = await up();
  assert.equal(h.setup, true);
  const r = await fetch(B + '/', { redirect: 'manual' }); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/setup');
  assert.equal((await fetch(B + '/api/admin/me')).status, 503);
  assert.equal((await fetch(B + '/some-gallery')).status, 503);
  const page = await fetch(B + '/setup'); assert.equal(page.status, 200); assert.match(await page.text(), /Set up your gallery server/);
  assert.match(logs, /Setup code:\s+[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
  assert.equal(statSync(join(data, 'setup-code.txt')).mode & 0o777, 0o600);
});

const b = new Browser();
let code;

test('the setup API refuses a stranger: no code, wrong code (and it locks), no origin', async () => {
  code = readFileSync(join(data, 'setup-code.txt'), 'utf8').trim();
  assert.equal((await b.call('GET', '/api/setup/state')).status, 401);
  assert.equal((await b.call('POST', '/api/setup/claim', { code }, { origin: null })).status, 403, 'a request with no Origin');
  assert.equal((await b.call('POST', '/api/setup/claim', { code }, { origin: 'http://evil.test' })).status, 403, 'a request from another site');
  assert.equal((await b.call('POST', '/api/setup/claim', { code }, { json: false })).status, 415, 'not JSON');
  const thief = new Browser('198.51.100.7');
  for (let i = 0; i < 10; i++) assert.equal((await thief.call('POST', '/api/setup/claim', { code: 'AAAA-AAAA-AAA' + i })).status, 401);
  assert.equal((await thief.call('POST', '/api/setup/claim', { code: 'AAAA-AAAA-AAAA' })).status, 429);
  assert.equal((await thief.call('POST', '/api/setup/claim', { code })).status, 429, 'even the right code from a locked-out address');
});

test('the right code unlocks the page, and no secret is ever sent back', async () => {
  assert.equal((await b.call('POST', '/api/setup/claim', { code: code.toLowerCase().replace(/-/g, ' ') })).status, 200);
  const s = await b.call('GET', '/api/setup/state');
  assert.equal(s.status, 200); assert.equal(s.body.adminExists, false); assert.equal(s.body.settings.IMMICH_API_KEY.set, false);
  assert.ok(s.body.suggestedPublicUrl.startsWith('http://127.0.0.1'));
  assert.ok(!('value' in s.body.settings.IMMICH_API_KEY));
});

test('Immich: a missing permission is named, then the connection passes', async () => {
  imm.st.deny = { path: '/api/timeline', perm: 'timeline.read' };
  let r = await b.call('POST', '/api/setup/test/immich', { url: imm.url, key: imm.st.key });
  assert.equal(r.body.ok, false);
  const c = r.body.checks.find(x => x.id === 'timeline'); assert.equal(c.permission, 'timeline.read'); assert.match(c.fix, /tick timeline\.read/);
  imm.st.deny = null;
  r = await b.call('POST', '/api/setup/test/immich', { url: imm.url, key: imm.st.key });
  assert.equal(r.body.ok, true, JSON.stringify(r.body.checks.filter(x => !x.ok)));
  assert.ok(r.body.checks.find(x => x.id === 'readonly').ok);
  assert.equal((await b.call('POST', '/api/setup/test/immich', { url: 'http://127.0.0.1:1', key: 'x' })).body.ok, false);
});

test('settings: validated, wizard-only, and a blank secret keeps the saved one', async () => {
  let r = await b.call('PUT', '/api/setup/settings', { IMMICH_URL: 'not a url' }); assert.equal(r.status, 400);
  r = await b.call('PUT', '/api/setup/settings', { PORT: '1' }); assert.equal(r.status, 400, 'a setting that is not part of setup');
  r = await b.call('PUT', '/api/setup/settings', { IMMICH_URL: imm.url + '/', IMMICH_API_KEY: imm.st.key });
  assert.equal(r.status, 200); assert.equal(r.body.settings.IMMICH_URL.value, imm.url); assert.equal(r.body.settings.IMMICH_API_KEY.set, true);
  r = await b.call('PUT', '/api/setup/settings', { IMMICH_API_KEY: '' }); assert.equal(r.body.settings.IMMICH_API_KEY.set, true);
  const t = await b.call('POST', '/api/setup/test/immich', {});            /* nothing typed: uses what was saved */
  assert.equal(t.body.ok, true);
});

test('email: an unverified domain explains itself; then a real test mail goes out and is remembered', async () => {
  rs.st.mode = 'unverified';
  let r = await b.call('POST', '/api/setup/test/email', { apiKey: rs.st.key, from: 'Studio <hi@studio.test>', to: 'me@example.com' });
  assert.equal(r.body.ok, false); assert.match(r.body.checks.at(-1).fix, /resend\.com\/domains/);
  rs.st.mode = 'ok';
  r = await b.call('POST', '/api/setup/test/email', { apiKey: rs.st.key, from: 'Studio <hi@studio.test>', to: 'me@example.com' });
  assert.equal(r.body.ok, true); assert.equal(rs.st.mails.length, 1); assert.deepEqual(rs.st.mails[0].to, ['me@example.com']);
  r = await b.call('PUT', '/api/setup/settings', { RESEND_API_KEY: rs.st.key, MAIL_FROM: 'Studio <hi@studio.test>', BRAND_NAME: 'Studio', BRAND_ADDRESS: '1 Main St', PUBLIC_URL: B });
  assert.equal(r.status, 200); assert.equal(r.body.emailVerified, true);
});

test('the admin account: weak passwords are refused, a good one is created once', async () => {
  for (const [email, pw] of [['me@example.com', 'short'], ['nope', 'a-long-enough-password'], ['me@example.com', 'me@example.com']]) assert.equal((await b.call('POST', '/api/setup/admin', { email, password: pw })).status, 400);
  assert.equal((await b.call('POST', '/api/setup/finish', {})).status, 400, 'cannot finish without an account');
  const r = await b.call('POST', '/api/setup/admin', { email: 'Me@Example.com', password: 'correct horse battery' });
  assert.equal(r.status, 200); assert.equal(r.body.adminExists, true);
  assert.equal((await b.call('POST', '/api/setup/admin', { email: 'x@example.com', password: 'correct horse battery' })).status, 409);
});

test('finishing hands over to the real app on the same port, and setup disappears for good', async () => {
  const r = await b.call('POST', '/api/setup/finish', {}); assert.equal(r.status, 200);
  let h; for (let i = 0; i < 60; i++) { await sleep(200); try { h = await (await fetch(B + '/healthz')).json(); if (!h.setup) break; } catch {} }
  assert.equal(h.setup, undefined, 'the app took over\n' + logs);
  assert.equal(app.exitCode, null, 'in the same process, with no restart');
  for (const p of ['/setup', '/setup.html', '/api/setup/state']) assert.equal((await fetch(B + p)).status, 404, p);
  assert.equal((await b.call('POST', '/api/setup/claim', { code })).status, 404);
  assert.ok(!existsSync(join(data, 'setup-code.txt')), 'the code file is removed');
  assert.match(logs, /config: .*file/);
});

test('the new admin can sign in with the emailed code', async () => {
  const a = new Browser();
  let r = await a.call('POST', '/api/admin/login', { email: 'me@example.com', password: 'wrong password' }); assert.equal(r.status, 401);
  const before = rs.st.mails.length;
  r = await a.call('POST', '/api/admin/login', { email: 'me@example.com', password: 'correct horse battery' });
  assert.equal(r.body.step, 'code', 'two-step sign-in is on because email was proven to work');
  const mail = rs.st.mails[before]; const code6 = /^(\d{6}) is your sign-in code/.exec(mail.subject)[1];
  r = await a.call('POST', '/api/admin/login', { challenge: r.body.challenge, code: code6 }); assert.equal(r.status, 200);
  const me = await a.call('GET', '/api/admin/me'); assert.equal(me.status, 200);
  /* nothing a browser can fetch contains a key */
  for (const p of ['/api/admin/me', '/api/admin/mail-status', '/api/admin/galleries', '/api/admin/overview']) {
    const t = (await a.call('GET', p)).text; for (const k of ENV_KEYS) assert.ok(!t.includes(k), `${p} leaked a key`);
  }
});

test('Connections: readable without secrets, changes need the browser sign-in and apply at once', async () => {
  const a = new Browser(); const before = rs.st.mails.length;
  let r = await a.call('POST', '/api/admin/login', { email: 'me@example.com', password: 'correct horse battery' });
  const code6 = /^(\d{6})/.exec(rs.st.mails[before].subject)[1];
  await a.call('POST', '/api/admin/login', { challenge: r.body.challenge, code: code6 });
  const token = JSON.parse(readFileSync(join(data, 'immichset.json'), 'utf8')).settings.ADMIN_TOKEN;

  r = await a.call('GET', '/api/admin/connections');
  assert.equal(r.status, 200);
  for (const k of ENV_KEYS) assert.ok(!r.text.includes(k), 'a key leaked');
  assert.ok(!r.text.includes(token), 'the admin token leaked');
  assert.equal(r.body.settings.IMMICH_URL.source, 'file'); assert.equal(r.body.settings.IMMICH_API_KEY.set, true);
  assert.ok(!r.body.meta.some(m => ['APP_SECRET', 'ADMIN_TOKEN', 'PORT', 'DATA_DIR'].includes(m.env)), 'internal settings are not offered');

  /* the API token can read and test, but not change where things point */
  const asToken = (m, p, body) => fetch(B + p, { method: m, headers: { 'x-admin-token': token, 'content-type': 'application/json', origin: B }, body: body && JSON.stringify(body) });
  assert.equal((await asToken('PUT', '/api/admin/connections', { BRAND_NAME: 'Hacked' })).status, 403);
  assert.equal((await asToken('GET', '/api/admin/connections/export')).status, 403);
  assert.equal((await asToken('GET', '/api/admin/connections')).status, 200);

  r = await a.call('PUT', '/api/admin/connections', { BRAND_NAME: 'Studio Two', MAIL_FROM: 'not an address' }); assert.equal(r.status, 400);
  r = await a.call('PUT', '/api/admin/connections', { APP_SECRET: 'x' }); assert.equal(r.status, 400, 'the app secret cannot be set from the panel');
  r = await a.call('PUT', '/api/admin/connections', { BRAND_NAME: 'Studio Two', ZIP_MAX_GB: '5' }, { origin: 'http://evil.test' }); assert.equal(r.status, 403, 'another site cannot ask');
  r = await a.call('PUT', '/api/admin/connections', { BRAND_NAME: 'Studio Two', ZIP_MAX_GB: '5', IMMICH_API_KEY: '' });
  assert.equal(r.status, 200); assert.deepEqual(r.body.restartNeeded, ['ZIP_MAX_GB'], 'only what cannot change live asks for a restart');
  assert.equal(r.body.settings.BRAND_NAME.value, 'Studio Two'); assert.equal(r.body.settings.IMMICH_API_KEY.set, true, 'a blank key keeps the saved one');
  assert.equal(JSON.parse(readFileSync(join(data, 'immichset.json'), 'utf8')).settings.BRAND_NAME, 'Studio Two');

  r = await a.call('POST', '/api/admin/connections/test/immich', {}); assert.equal(r.body.ok, true, 'tests use the saved key when none is typed');
  r = await a.call('POST', '/api/admin/connections/test/email', { to: 'me@example.com' }); assert.equal(r.body.ok, true);
  r = await a.call('GET', '/api/admin/connections/export'); assert.equal(r.status, 200); assert.ok(r.text.includes('"settings"'));
});

test('the settings file is private, holds no password, and no key is in the database or a backup', async () => {
  const f = join(data, 'immichset.json');
  assert.equal(statSync(f).mode & 0o777, 0o600);
  const txt = readFileSync(f, 'utf8'); assert.ok(!txt.includes('correct horse')); assert.ok(txt.includes('APP_SECRET'));
  assert.ok(JSON.parse(txt).meta.setupCompletedAt);
  for (const file of readdirSync(data).filter(n => /\.db(-wal)?$/.test(n))) {
    const bytes = readFileSync(join(data, file)).toString('latin1');
    for (const k of ENV_KEYS) assert.ok(!bytes.includes(k), `${file} contains a key`);
    assert.ok(!bytes.includes('correct horse'), 'the password is stored only as a hash');
  }
});

test('a restart on the same data folder goes straight to the real app', async () => {
  await stop(); boot({}); const h = await up();
  assert.equal(h.setup, undefined); assert.ok(!existsSync(join(data, 'setup-code.txt')));
});

test('an install driven by env vars never sees setup and writes no settings file', async () => {
  await stop();
  const d2 = mkdtempSync(join(tmpdir(), 'envboot-'));
  boot({ IMMICH_URL: imm.url, IMMICH_API_KEY: imm.st.key, APP_SECRET: 'a'.repeat(32), ADMIN_TOKEN: 'tok-tok-tok' }, d2);
  const h = await up(); assert.equal(h.setup, undefined);
  assert.ok(!existsSync(join(d2, 'immichset.json')) && !existsSync(join(d2, 'setup-code.txt')));
  assert.equal((await fetch(B + '/setup')).status, 404);
  assert.match(logs, /config: .*env/);
});

test('a saved value wins over the compose file, key by key', async () => {
  await stop();
  boot({ IMMICH_URL: 'http://wrong.invalid:1', IMMICH_API_KEY: 'x', APP_SECRET: 'a'.repeat(32), ADMIN_TOKEN: 'tok-tok-tok' }, data);
  await up();
  assert.match(logs, /immich: file/);
});
