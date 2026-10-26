import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { immichStatus, provisionImmich, ourKeys, ProvisionError } from '../provision.mjs';
import { READ_PERMISSIONS, WRITE_PERMISSIONS, KEY_NAMES, PERMISSION, writePermissionsFor, checkImmich } from '../checks.mjs';
import { fakeImmichFull } from './fake-services.mjs';

const FIX = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'immich-permissions.json'), 'utf8'));
const run = (imm, o = {}) => provisionImmich({ url: imm.url, mode: 'create', email: 'me@studio.test', password: 'a long passphrase 1', name: 'me', ...o });

test('every permission this app asks for exists in Immich', () => {
  for (const p of [...READ_PERMISSIONS, ...Object.values(WRITE_PERMISSIONS).flat(), ...Object.values(PERMISSION)]) assert.ok(FIX.permissions.includes(p), p);
});

test('write levels grant exactly what they say', () => {
  assert.deepEqual(writePermissionsFor('none'), []);
  assert.deepEqual(writePermissionsFor('add'), ['asset.upload', 'album.create', 'albumAsset.create']);
  assert.ok(writePermissionsFor('addremove').includes('albumAsset.delete') && !writePermissionsFor('addremove').includes('asset.delete'));
  assert.ok(writePermissionsFor('all').includes('asset.delete'));
});

test('status: down, up and fresh, up and set up', async () => {
  assert.deepEqual(await immichStatus({ url: 'http://127.0.0.1:1' }), { reachable: false });
  const fresh = await fakeImmichFull(); const s1 = await immichStatus({ url: fresh.url });
  assert.deepEqual([s1.reachable, s1.initialized, s1.version], [true, false, '3.3.5']);
  const old = await fakeImmichFull({ initialized: true }); assert.equal((await immichStatus({ url: old.url })).initialized, true);
  fresh.close(); old.close();
});

test('a fresh Immich gets an account and two keys with exactly the right permissions, and they work', async () => {
  const imm = await fakeImmichFull(); const saved = [];
  const r = await run(imm, { write: 'addremove', save: async (kind, k) => saved.push([kind, k.id]) });
  assert.equal(r.createdAccount, true);
  assert.deepEqual(imm.st.keys.map(k => k.name), [KEY_NAMES.read, KEY_NAMES.write]);
  assert.deepEqual(imm.st.keys[0].permissions, READ_PERMISSIONS);
  assert.deepEqual(saved.map(s => s[0]), ['read', 'write'], 'each key is saved the moment it exists');
  assert.equal(imm.st.sessions.size, 0, 'signed out afterwards');
  const check = await checkImmich({ url: imm.url, key: r.readKey.secret, writeKey: r.writeKey.secret });
  assert.equal(check.ok, true, JSON.stringify(check.checks.filter(c => !c.ok)));
  assert.ok(check.checks.find(c => c.id === 'readonly').ok && !check.checks.find(c => c.id === 'readonly').warn, 'the read key really is read-only');
  imm.close();
});

test('no write key unless asked for', async () => {
  const imm = await fakeImmichFull(); const r = await run(imm);
  assert.equal(r.writeKey, null); assert.equal(imm.st.keys.length, 1); imm.close();
});

test('an Immich that is already set up: create is refused kindly, sign-in works', async () => {
  const imm = await fakeImmichFull({ initialized: true });
  await assert.rejects(run(imm), e => e instanceof ProvisionError && e.state === 'initialized' && e.status === 409);
  assert.equal(imm.st.calls.signUp, 0, 'it never tries to sign up over an existing account');
  const r = await run(imm, { mode: 'signin', email: 'owner@studio.test', password: 'pw-owner-1234' });
  assert.equal(r.createdAccount, false); assert.equal(imm.st.keys.length, 1);
  imm.close();
});

test('a wrong password is its own state', async () => {
  const imm = await fakeImmichFull({ initialized: true });
  await assert.rejects(run(imm, { mode: 'signin', email: 'owner@studio.test', password: 'wrong' }), e => e.state === 'bad_login' && e.status === 401);
  assert.equal(imm.st.keys.length, 0); imm.close();
});

test('Immich still starting is reported as starting, not as a failure', async () => {
  const imm = await fakeImmichFull({ startDelayMs: 60_000 });
  await assert.rejects(run(imm), e => e.state === 'starting' && e.status === 503);
  imm.close();
});

test('running it again replaces our keys and never duplicates them, and leaves other people\'s alone', async () => {
  const imm = await fakeImmichFull({ initialized: true });
  imm.st.keys.push({ id: 'theirs', name: 'My phone backup', permissions: ['asset.read'], secret: 'sec_theirs' });
  const a = await run(imm, { mode: 'signin', email: 'owner@studio.test', password: 'pw-owner-1234', write: 'add' });
  const b = await run(imm, { mode: 'signin', email: 'owner@studio.test', password: 'pw-owner-1234', write: 'add', previousKeyIds: [a.readKey.id, a.writeKey.id] });
  const names = imm.st.keys.map(k => k.name).sort();
  assert.deepEqual(names, [KEY_NAMES.read, KEY_NAMES.write, 'My phone backup'].sort());
  assert.equal(b.removedOldKeys, 2);
  assert.ok(imm.st.keys.some(k => k.id === 'theirs'));
  assert.deepEqual(ourKeys(imm.st.keys).map(k => k.name).sort(), [KEY_NAMES.read, KEY_NAMES.write].sort());
  imm.close();
});

test('if the write key fails the read key is already saved, and a rerun leaves no duplicates', async () => {
  const imm = await fakeImmichFull({ failOn: { path: /api-keys$/, status: 500, times: 0 } });
  const saved = [];
  let call = 0;
  const flaky = (url, init) => { if (init?.method === 'POST' && /\/api\/api-keys$/.test(String(url)) && ++call === 2) return Promise.resolve(new Response('{"message":"boom"}', { status: 500 })); return fetch(url, init); };
  await assert.rejects(run(imm, { write: 'add', f: flaky, save: async (k, v) => saved.push(k) }), e => e.state === 'immich_error');
  assert.deepEqual(saved, ['read']);
  const again = await run(imm, { mode: 'signin', write: 'add', previousKeyIds: [imm.st.keys[0].id] });
  assert.equal(imm.st.keys.filter(k => k.name === KEY_NAMES.read).length, 1);
  assert.equal(imm.st.keys.length, 2); assert.ok(again.writeKey);
  imm.close();
});

test('machine learning is switched off only when asked, and a library is added once', async () => {
  const imm = await fakeImmichFull();
  const r = await run(imm, { ml: 'off', importPath: '/mnt/import' });
  assert.equal(r.ml, 'off'); assert.equal(imm.st.config.machineLearning.enabled, false);
  assert.equal(imm.st.libraries.length, 1); assert.deepEqual(imm.st.libraries[0].importPaths, ['/mnt/import']);
  const again = await run(imm, { mode: 'signin', ml: 'off', importPath: '/mnt/import' });
  assert.equal(imm.st.libraries.length, 1, 'no second library'); assert.equal(again.library.existing, true);
  const keep = await fakeImmichFull(); await run(keep, { ml: 'keep' }); assert.equal(keep.st.config.machineLearning.enabled, true);
  imm.close(); keep.close();
});

test('a key with too few permissions is caught by the real checks', async () => {
  const imm = await fakeImmichFull({ initialized: true });
  imm.st.keys.push({ id: 'weak', name: 'weak', permissions: ['album.read'], secret: 'sec_weak' });
  const r = await checkImmich({ url: imm.url, key: 'sec_weak' });
  assert.equal(r.ok, false); assert.ok(r.checks.some(c => !c.ok && c.permission === 'asset.read'));
  imm.close();
});
