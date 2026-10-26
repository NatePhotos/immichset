import test from 'node:test';
import assert from 'node:assert/strict';
import { checkImmich, probeCaps, missingPermission, translateResend, checkResend, checkCloudflare, checkPublic, PERMISSION } from '../checks.mjs';

const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: k => headers[k.toLowerCase()] ?? null },
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const deny = p => res(403, { message: `Missing required permission: ${p}` });

/* a fake Immich; `denied` maps a path fragment to the permission it should refuse for */
function immich({ denied = {}, albums = [{ id: 'a1', assetCount: 3 }, { id: 'a2', assetCount: 1 }], keyOk = true, writeAll = false, readCanWrite = false, down = false } = {}) {
  const seen = [];
  const f = async (url, init = {}) => {
    const u = new URL(url), p = u.pathname + u.search; seen.push(`${init.method || 'GET'} ${p}`);
    if (down) throw new Error('refused');
    const key = init.headers?.['x-api-key'];
    if (u.pathname === '/api/server/ping') return res(200, { res: 'pong' });
    if (u.pathname === '/api/server/version') return res(200, { major: 3, minor: 2, patch: 0 });
    if (!keyOk && key === 'bad') return res(401, { message: 'Invalid API key' });
    for (const [frag, perm] of Object.entries(denied)) if (p.includes(frag)) return deny(perm);
    const isWrite = (init.method && init.method !== 'GET' && !/search|archive/.test(p));
    if (isWrite) return (key === 'write' && writeAll) || (key === 'read' && readCanWrite) ? res(400, { message: 'validation' }) : deny('asset.upload');
    if (u.pathname === '/api/albums') return res(200, albums);
    if (u.pathname === '/api/timeline/buckets') return res(200, [{ timeBucket: '2024-01-01' }]);
    if (u.pathname === '/api/timeline/bucket') return res(200, { id: ['asset1'] });
    return res(200, 'ok');
  };
  f.seen = seen; return f;
}

test('Immich unreachable: the advice is about localhost and container names', async () => {
  const r = await checkImmich({ url: 'http://localhost:2283', key: 'read', f: immich({ down: true }) });
  assert.equal(r.ok, false); assert.match(r.checks[0].fix, /localhost.*container/);
});

test('a key Immich does not know', async () => {
  const r = await checkImmich({ url: 'http://i', key: 'bad', f: immich({ keyOk: false }) });
  assert.equal(r.ok, false); assert.match(r.checks.at(-1).detail, /did not recognise/);
});

test('a missing permission is named, from Immich\'s own message', async () => {
  const r = await checkImmich({ url: 'http://i', key: 'read', f: immich({ denied: { '/api/timeline': 'timeline.read' } }) });
  const c = r.checks.find(x => x.id === 'timeline');
  assert.equal(c.ok, false); assert.equal(c.permission, 'timeline.read'); assert.match(c.fix, /tick timeline\.read/);
});

test('every step of the app is exercised against the smallest album with photos', async () => {
  const f = immich();
  const r = await checkImmich({ url: 'http://i/', key: 'read', f });
  assert.equal(r.ok, true);
  for (const id of ['reach', 'key', 'albums', 'timeline', 'shape', 'thumbnail', 'original', 'archive', 'search', 'readonly']) assert.ok(r.checks.find(c => c.id === id && c.ok), id);
  assert.ok(f.seen.some(s => s.includes('albumId=a2')), 'the smallest album with photos was used');
});

test('no albums yet is a gentle pass, not a failure', async () => {
  const r = await checkImmich({ url: 'http://i', key: 'read', f: immich({ albums: [] }) });
  assert.equal(r.ok, true); assert.ok(r.checks.find(c => c.id === 'photos').warn);
});

test('a read key that can change the library earns a warning', async () => {
  const r = await checkImmich({ url: 'http://i', key: 'read', f: immich({ readCanWrite: true }) });
  assert.equal(r.ok, true); assert.ok(r.checks.find(c => c.id === 'readonly').warn);
});

test('a write key reports what it can and cannot do', async () => {
  const full = await checkImmich({ url: 'http://i', key: 'read', writeKey: 'write', f: immich({ writeAll: true }) });
  assert.equal(full.checks.find(c => c.id === 'write').warn, false);
  const part = await checkImmich({ url: 'http://i', key: 'read', writeKey: 'write', f: immich() });
  const w = part.checks.find(c => c.id === 'write'); assert.equal(w.warn, true); assert.match(w.fix, /asset\.upload/);
});

test('probeCaps matches what the app has always reported', async () => {
  const caps = await probeCaps(async () => res(400, 'bad body'));
  assert.deepEqual(caps, { upload: true, albumCreate: true, albumAdd: true, albumRemove: true, trash: true, restore: true });
  const none = await probeCaps(async () => deny('x'));
  assert.deepEqual(Object.values(none), [false, false, false, false, false, false]);
  const other403 = await probeCaps(async () => res(403, 'forbidden for another reason'));
  assert.ok(Object.values(other403).every(Boolean), 'a 403 without a permission message is not "missing a permission"');
  const down = await probeCaps(async () => { throw new Error('x'); });
  assert.ok(Object.values(down).every(Boolean), 'unreachable never hides the buttons');
});

test('permission fallback map covers every endpoint the app uses', () => {
  assert.equal(missingPermission('Missing required permission: asset.view', 'x'), 'asset.view');
  assert.equal(missingPermission('', 'timeline'), 'asset.read');   /* Immich v3 guards the photo list with asset.read */
  for (const k of ['albums', 'timeline', 'thumbnail', 'original', 'archive', 'search', 'upload', 'albumCreate', 'albumAdd', 'albumRemove', 'trash', 'restore']) assert.ok(PERMISSION[k], k);
});

test('Resend errors come out as plain advice', () => {
  assert.match(translateResend(401, { name: 'invalid_api_key', message: 'API key is invalid' }).fix, /resend\.com\/api-keys/);
  assert.match(translateResend(403, { name: 'validation_error', message: 'The studio.com domain is not verified.' }).fix, /resend\.com\/domains/);
  assert.match(translateResend(403, { message: 'You can only send testing emails to your own email address' }).fix, /Verify your domain/);
  assert.match(translateResend(422, { name: 'invalid_from_address', message: 'Invalid `from` field' }).fix, /Studio <hello@/);
  assert.match(translateResend(429, { name: 'rate_limit_exceeded', message: 'x' }).detail, /slow down/);
  assert.match(translateResend(429, { name: 'daily_quota_exceeded', message: 'x' }).fix || translateResend(429, { name: 'daily_quota_exceeded' }).detail, /./);
  assert.match(translateResend(500, { message: 'boom' }).detail, /500/);
});

test('Resend: a full-access key works but is flagged, a sending-only key is praised, a test mail is sent', async () => {
  const sent = [];
  const mk = scope => async (url, init = {}) => {
    if (url.endsWith('/domains')) return scope === 'full' ? res(200, { data: [] }) : res(401, { name: 'restricted_api_key', message: 'This API key is restricted to only send emails' });
    sent.push(JSON.parse(init.body)); return res(200, { id: 'e1' });
  };
  const full = await checkResend({ apiKey: 'k', from: 'S <a@b.co>', to: 'me@x.co', f: mk('full') });
  assert.equal(full.ok, true); assert.ok(full.checks.find(c => c.id === 'scope').warn);
  const only = await checkResend({ apiKey: 'k', from: 'S <a@b.co>', to: 'me@x.co', f: mk('send') });
  assert.equal(only.checks.find(c => c.id === 'scope').ok, true); assert.ok(!only.checks.find(c => c.id === 'scope').warn);
  assert.equal(sent.length, 2); assert.deepEqual(sent[0].to, ['me@x.co']);
});

test('Resend: a bad key stops early, an unverified domain explains itself', async () => {
  const bad = await checkResend({ apiKey: 'k', from: 'a@b.co', to: 'x@y.co', f: async () => res(401, { name: 'invalid_api_key', message: 'invalid' }) });
  assert.equal(bad.ok, false); assert.equal(bad.checks.length, 1);
  const f = async url => url.endsWith('/domains') ? res(401, { name: 'restricted_api_key' }) : res(403, { name: 'validation_error', message: 'The studio.com domain is not verified.' });
  const r = await checkResend({ apiKey: 'k', from: 'a@studio.com', to: 'x@y.co', f });
  assert.equal(r.ok, false); assert.match(r.checks.at(-1).fix, /Verified/);
});

test('Cloudflare: token, then project or record, each with the next step', async () => {
  const f = routes => async url => { const p = new URL(url).pathname + new URL(url).search; for (const [k, v] of Object.entries(routes)) if (p.includes(k)) return v; return res(404, {}); };
  const ok = res(200, { success: true });
  assert.equal((await checkCloudflare({ kind: 'pages', token: 't', accountId: 'a', project: 'p', f: f({ 'tokens/verify': ok, '/pages/projects/p': res(200, {}) }) })).ok, true);
  assert.match((await checkCloudflare({ kind: 'pages', token: 't', accountId: 'a', project: 'p', f: f({ 'tokens/verify': ok, '/pages/projects/p': res(404, {}) }) })).checks.at(-1).fix, /Create the project/);
  assert.match((await checkCloudflare({ kind: 'pages', token: 't', accountId: 'a', project: 'p', f: f({ 'tokens/verify': ok, '/pages/projects/p': res(403, {}) }) })).checks.at(-1).fix, /Pages › Edit/);
  assert.equal((await checkCloudflare({ kind: 'dns', token: 't', domain: 'd.co', host: 'g', f: f({ 'tokens/verify': ok, '/zones?name': res(200, { result: [{ id: 'z' }] }), '/dns_records': res(200, { result: [] }) }) })).ok, false);
  assert.equal((await checkCloudflare({ kind: 'dns', token: 'bad', f: f({ 'tokens/verify': res(401, { success: false }) }) })).ok, false);
});

test('public address: https warning, instance match, and a calm answer when it cannot be reached from inside', async () => {
  const hit = async () => res(200, {}, { 'x-immichset-instance': 'abc' });
  assert.equal((await checkPublic({ url: 'https://g.test', instance: 'abc', f: hit })).checks.find(c => c.id === 'reach').ok, true);
  assert.ok((await checkPublic({ url: 'http://g.test', instance: 'abc', f: hit })).checks.find(c => c.id === 'https').warn);
  assert.equal((await checkPublic({ url: 'http://192.168.1.5:3000', instance: 'abc', f: hit })).checks.find(c => c.id === 'https'), undefined);
  assert.ok((await checkPublic({ url: 'https://g.test', instance: 'abc', f: async () => res(200, {}, {}) })).checks.find(c => c.id === 'reach').warn);
  const off = await checkPublic({ url: 'https://g.test', instance: 'abc', f: async () => { throw new Error('x'); } });
  assert.equal(off.ok, true); assert.ok(off.checks.find(c => c.id === 'reach').warn);
  assert.equal((await checkPublic({ url: 'nonsense', instance: 'abc', f: hit })).ok, false);
});
