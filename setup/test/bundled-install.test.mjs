import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeImmichFull, fakeResend } from './fake-services.mjs';
import { KEY_NAMES, READ_PERMISSIONS } from '../checks.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const PW = 'a long passphrase 9';

let rs, port, B, data, app, logs = '';
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
  async call(method, path, body, { origin = B, headers = {} } = {}) {
    const h = { 'x-forwarded-for': this.ip, 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers };
    if (origin) h.origin = origin;
    const r = await fetch(B + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const c of (r.headers.getSetCookie?.() || [])) { const [kv] = c.split(';'); this.cookie = (this.cookie ? this.cookie + '; ' : '') + kv; }
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, body: j, text };
  }
  async claim(dir) { return this.call('POST', '/api/setup/claim', { code: readFileSync(join(dir, 'setup-code.txt'), 'utf8').trim() }); }
}
const filesText = dir => readdirSync(dir).filter(f => !f.endsWith('.db-shm')).map(f => { try { return readFileSync(join(dir, f)).toString('latin1'); } catch { return ''; } }).join('\n');

before(async () => { rs = await fakeResend(); port = await freePort(); B = `http://127.0.0.1:${port}`; data = mkdtempSync(join(tmpdir(), 'bundled-')); });
after(async () => { await stop(); rs?.close(); });

test('a bundled install: Immich still starting, then the account and both keys are made for the owner', async () => {
  const imm = await fakeImmichFull({ startDelayMs: 1500 });
  boot({ IMMICHSET_BUNDLED_IMMICH: imm.url, IMMICHSET_BUNDLED_ML: 'off' });
  await up();
  const b = new Browser(); assert.equal((await b.claim(data)).status, 200);

  let s = await b.call('GET', '/api/setup/state');
  assert.equal(s.body.bundled.url, imm.url); assert.equal(s.body.bundled.ml, false);
  let st = await b.call('GET', '/api/setup/immich/status'); assert.equal(st.body.reachable, false, 'still starting');
  const early = await b.call('POST', '/api/setup/immich/provision', { mode: 'create', email: 'me@studio.test', password: PW });
  assert.equal(early.status, 503); assert.equal(early.body.state, 'starting'); assert.equal(imm.st.keys.length, 0, 'nothing was made');
  for (let i = 0; i < 40; i++) { st = await b.call('GET', '/api/setup/immich/status'); if (st.body.reachable) break; await sleep(250); }
  assert.deepEqual([st.body.reachable, st.body.initialized, st.body.bundled], [true, false, true]);

  const r = await b.call('POST', '/api/setup/immich/provision', { mode: 'create', email: 'me@studio.test', password: PW, write: 'addremove', ml: 'off' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.createdAccount, true); assert.equal(r.body.check.ok, true, JSON.stringify(r.body.check.checks.filter(c => !c.ok)));
  assert.equal(r.body.ml, 'off'); assert.equal(imm.st.config.machineLearning.enabled, false);
  assert.deepEqual(imm.st.keys.map(k => k.name), [KEY_NAMES.read, KEY_NAMES.write]);
  assert.deepEqual(imm.st.keys[0].permissions, READ_PERMISSIONS);
  assert.ok(!JSON.stringify(r.body).includes(imm.st.keys[0].secret), 'the key is never sent back to the browser');

  const file = JSON.parse(readFileSync(join(data, 'immichset.json'), 'utf8'));
  assert.equal(file.settings.IMMICH_URL, imm.url); assert.equal(file.settings.IMMICH_API_KEY, imm.st.keys[0].secret); assert.equal(file.settings.IMMICH_WRITE_KEY, imm.st.keys[1].secret);
  assert.ok(file.meta.immichProvision.readKeyId);
  assert.ok(!filesText(data).includes(PW) && !logs.includes(PW), 'the password is stored and logged nowhere');

  s = await b.call('GET', '/api/setup/state'); assert.equal(s.body.settings.IMMICH_API_KEY.set, true); assert.ok(!('value' in s.body.settings.IMMICH_API_KEY));
  assert.equal((await b.call('PUT', '/api/setup/settings', { TZ: 'Mars/Olympus' })).status, 400, 'a made-up time zone is refused');
  await b.call('PUT', '/api/setup/settings', { PUBLIC_URL: B, MAIL_FROM: 'S <a@studio.test>', RESEND_API_KEY: rs.st.key, TZ: 'America/Chicago' });
  assert.equal((await b.call('POST', '/api/setup/admin', { email: 'me@studio.test', password: PW })).status, 200);
  assert.equal((await b.call('POST', '/api/setup/finish', {})).status, 200);
  let h; for (let i = 0; i < 60; i++) { await sleep(200); try { h = await (await fetch(B + '/healthz')).json(); if (!h.setup) break; } catch {} }
  assert.equal(h.setup, undefined, 'the real app took over');
  assert.equal(JSON.parse(readFileSync(join(data, 'immichset.json'), 'utf8')).settings.TZ, 'America/Chicago', 'the time zone from the browser was saved');
  imm.close();
});

test('running it again: create is refused, sign in replaces our keys without duplicating, and others\' keys stay', async () => {
  await stop(); const imm = await fakeImmichFull({ admin: { email: 'owner@studio.test', password: 'pw-owner-1234' } });
  imm.st.keys.push({ id: 'theirs', name: 'My phone', permissions: ['asset.read'], secret: 'sec_theirs' });
  const dir = mkdtempSync(join(tmpdir(), 'bundled2-')); boot({}, dir); await up();
  const b = new Browser('198.51.100.20'); await b.claim(dir);
  let r = await b.call('POST', '/api/setup/immich/provision', { mode: 'create', url: imm.url, email: 'owner@studio.test', password: PW });
  assert.equal(r.status, 409); assert.equal(r.body.state, 'initialized');
  r = await b.call('POST', '/api/setup/immich/provision', { mode: 'signin', url: imm.url, email: 'owner@studio.test', password: 'pw-owner-1234', write: 'add' });
  assert.equal(r.status, 200, r.text); assert.equal(r.body.createdAccount, false);
  r = await b.call('POST', '/api/setup/immich/provision', { mode: 'signin', url: imm.url, email: 'owner@studio.test', password: 'pw-owner-1234', write: 'add' });
  assert.equal(r.status, 200); assert.equal(r.body.removedOldKeys, 2);
  assert.deepEqual(imm.st.keys.map(k => k.name).sort(), [KEY_NAMES.read, KEY_NAMES.write, 'My phone'].sort());
  r = await b.call('POST', '/api/setup/immich/provision', { mode: 'signin', url: imm.url, email: 'owner@studio.test', password: 'pw-owner-1234', write: 'none' });
  assert.equal(r.body.writeKey, null);
  assert.equal(JSON.parse(readFileSync(join(dir, 'immichset.json'), 'utf8')).settings.IMMICH_WRITE_KEY, undefined, 'a write key we made is dropped when no longer wanted');
  imm.close();
});

test('wrong passwords are throttled after ten, and the right one is refused while locked', async () => {
  await stop(); const imm = await fakeImmichFull({ admin: { email: 'owner@studio.test', password: 'pw-owner-1234' } });
  const dir = mkdtempSync(join(tmpdir(), 'bundled3-')); boot({}, dir); await up();
  const b = new Browser('198.51.100.30'); await b.claim(dir);
  for (let i = 0; i < 10; i++) assert.equal((await b.call('POST', '/api/setup/immich/provision', { mode: 'signin', url: imm.url, email: 'owner@studio.test', password: 'nope' + i })).status, 401);
  assert.equal((await b.call('POST', '/api/setup/immich/provision', { mode: 'signin', url: imm.url, email: 'owner@studio.test', password: 'pw-owner-1234' })).status, 429);
  assert.equal(imm.st.keys.length, 0);
  imm.close();
});

test('two clicks at once make one set of keys', async () => {
  await stop(); const imm = await fakeImmichFull({ slowLoginMs: 600 });
  const dir = mkdtempSync(join(tmpdir(), 'bundled4-')); boot({}, dir); await up();
  const b = new Browser('198.51.100.40'); await b.claim(dir);
  const body = { mode: 'create', url: imm.url, email: 'me@studio.test', password: PW };
  const [a, c] = await Promise.all([b.call('POST', '/api/setup/immich/provision', body), (async () => { await sleep(100); return b.call('POST', '/api/setup/immich/provision', body); })()]);
  assert.deepEqual([a.status, c.status].sort(), [200, 423]);
  assert.equal(imm.st.keys.length, 1);
  imm.close();
});

test('the doors stay shut: no claim, another site, and a request that came through Cloudflare', async () => {
  await stop(); const imm = await fakeImmichFull();
  const dir = mkdtempSync(join(tmpdir(), 'bundled5-')); boot({}, dir); await up();
  const stranger = new Browser('198.51.100.50');
  assert.equal((await stranger.call('POST', '/api/setup/immich/provision', { mode: 'create', url: imm.url, email: 'x@studio.test', password: PW })).status, 401);
  assert.equal((await stranger.call('GET', '/api/setup/immich/status')).status, 401);
  const b = new Browser('198.51.100.51'); await b.claim(dir);
  assert.equal((await b.call('POST', '/api/setup/immich/provision', { mode: 'create', url: imm.url, email: 'x@studio.test', password: PW }, { origin: 'http://evil.test' })).status, 403);
  const viaCf = await fetch(B + '/setup', { headers: { 'cf-connecting-ip': '203.0.113.77' } });
  assert.equal(viaCf.status, 403); assert.match(await viaCf.text(), /home/i);
  assert.equal((await fetch(B + '/api/setup/state', { headers: { 'cf-connecting-ip': '203.0.113.77' } })).status, 403);
  assert.equal(imm.st.keys.length, 0);
  await stop(); boot({ SETUP_FROM_INTERNET: 'on' }, dir); await up();
  assert.equal((await fetch(B + '/setup', { headers: { 'cf-connecting-ip': '203.0.113.77' } })).status, 200, 'unless the owner says otherwise');
  imm.close();
});

test('a key set in the compose file cannot be replaced by the page', async () => {
  await stop(); const imm = await fakeImmichFull();
  const dir = mkdtempSync(join(tmpdir(), 'bundled6-')); boot({ IMMICH_API_KEY: 'from-compose' }, dir); await up();
  const b = new Browser('198.51.100.60'); await b.claim(dir);
  const r = await b.call('POST', '/api/setup/immich/provision', { mode: 'create', url: imm.url, email: 'x@studio.test', password: PW });
  assert.equal(r.status, 409); assert.equal(r.body.state, 'locked'); assert.equal(imm.st.keys.length, 0);
  imm.close();
});

test('the address the admin is opened at can save settings, and another site cannot', async () => {
  await stop();
  const imm = await fakeImmichFull({ initialized: true });
  const dir = mkdtempSync(join(tmpdir(), 'bundled7-'));
  boot({ IMMICH_URL: imm.url, IMMICH_API_KEY: 'k', APP_SECRET: 'a'.repeat(32), ADMIN_TOKEN: 'tok-tok-tok', PUBLIC_URL: 'https://galleries.example.com', CLIENT_IP_HEADER: 'cf-connecting-ip' }, dir); await up();
  const h = await (await fetch(B + '/healthz')).json(); assert.equal(h.https, false);
  const h2 = await (await fetch(B + '/healthz', { headers: { 'x-forwarded-proto': 'https' } })).json(); assert.equal(h2.https, true);
  assert.equal((await fetch(B + '/api/admin/connections', { method: 'PUT', headers: { 'content-type': 'application/json', origin: B, 'x-admin-token': 'tok-tok-tok' }, body: '{}' })).status, 403, 'token alone still cannot (sessions only)');
  imm.close();
});
