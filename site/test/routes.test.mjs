import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSite } from '../routes.mjs';
import { startFakeImmich } from './fake-immich.mjs';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const FAIL = { value: false };              /* flips the stand-in Immich to failing */
let srv, base, site, fake, dir, mails = [], deploys = [];

const cfFetch = async (url, init = {}) => {
  const ok = r => new Response(JSON.stringify({ success: true, errors: [], result: r }));
  if (url.endsWith('/upload-token')) return ok({ jwt: 'J' });
  if (url.endsWith('/check-missing')) return ok(JSON.parse(init.body).hashes);
  if (url.endsWith('/deployments')) { deploys.push(init.body); return ok({ id: `dep-${deploys.length}`, url: 'https://t.pages.dev' }); }
  if (url.endsWith('/rollback')) { deploys.push('rollback:' + url.split('/').at(-2)); return ok({}); }
  return ok(true);
};

before(async () => {
  fake = await startFakeImmich(0, { fail: FAIL });
  dir = mkdtempSync(join(tmpdir(), 'site-'));
  const db = new DatabaseSync(':memory:');
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const readJson = async req => { let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; };
  const immich = (p, init = {}) => { const { write, ...rest } = init; return fetch(fake.url + p, rest); };
  site = createSite({ db, json, readJson, immich, canUpload: () => true,
    adminOk: req => req.headers['x-admin-token'] === 'T',
    tellAdmin: async s => { mails.push(s); }, fetch: cfFetch,
    cfg: { dataDir: dir, uploadMaxMb: 50, cfAccountId: 'acc', cfPagesToken: 'tok', cfPagesProject: 'test', siteUrl: '',
           allowTestHooks: true } });
  srv = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/admin/site-preview/')) return site.preview(req, res, url.pathname);
    if (req.headers['x-admin-token'] !== 'T') { res.writeHead(401); return res.end(); }
    return site.admin(req, res, url.pathname, url);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); fake.srv.close(); });

const H = extra => ({ 'x-admin-token': 'T', ...extra });
const rev = async () => (await (await fetch(base + '/api/admin/site', { headers: H() })).json()).rev;
async function send(method, path, body) {
  const r = await fetch(base + path, { method, headers: H({ 'content-type': 'application/json', 'x-site-rev': String(await rev()) }), body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function upload(gallery) {
  const f = new FormData();
  f.append('original', new File([JPEG], 'Original.JPG'));
  f.append('grid', new File([JPEG], 'g.jpg')); f.append('full', new File([JPEG], 'f.jpg'));
  f.append('width', '2048'); f.append('height', '1365');
  const r = await fetch(`${base}/api/admin/site/photos?gallery=${gallery}`, { method: 'POST', headers: H(), body: f });
  return { status: r.status, body: await r.json() };
}

/* the upload answers at once; Immich is filled in behind it */
async function waitForImmich(id, want, minTries = 0) {
  for (let i = 0; i < 100; i++) {
    const p = site.store.photo(id);
    if (p && p.immichStatus === want && p.immichTries >= minTries) return p;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.fail(`photo ${id} never became ${want}`);
}

test('a stale revision gets 409', async () => {
  const r = await fetch(base + '/api/admin/site/galleries', { method: 'POST', headers: H({ 'content-type': 'application/json', 'x-site-rev': '999' }), body: '{"title":"X"}' });
  assert.equal(r.status, 409);
});

test('upload stores both copies, sends the original to Immich into a new album', async () => {
  const g = (await send('POST', '/api/admin/site/galleries', { title: 'Autumn Wedding' })).body.gallery;
  const r = await upload(g.id);
  assert.equal(r.status, 201);
  assert.equal(r.body.photo.immichStatus, 'pending');
  await waitForImmich(r.body.photo.id, 'ok');
  const k = r.body.photo.fileKey;
  assert.ok(existsSync(join(dir, 'site', 'img', `${k}-grid.jpg`)) && existsSync(join(dir, 'site', 'img', `${k}-full.jpg`)));
  assert.deepEqual(readdirSync(join(dir, 'site', 'originals')), []);   /* removed once Immich has it */
  assert.deepEqual(fake.seen.albums.map(a => a.albumName), ['Website – Autumn Wedding']);
});

test('Immich down: photo is still added as pending, retry fixes it', async () => {
  const g = (await send('POST', '/api/admin/site/galleries', { title: 'Retry' })).body.gallery;
  FAIL.value = true;
  const r = await upload(g.id);
  assert.equal(r.status, 201);
  assert.equal(r.body.photo.immichStatus, 'pending');
  await waitForImmich(r.body.photo.id, 'pending', 1);
  assert.equal(readdirSync(join(dir, 'site', 'originals')).length, 1);   /* kept for the retry */
  FAIL.value = false;
  const again = await fetch(`${base}/api/admin/site/photos/${r.body.photo.id}/retry`, { method: 'POST', headers: H() });
  assert.equal((await again.json()).photo.immichStatus, 'ok');
});

test('rejects web copies that are not JPEG', async () => {
  const g = (await send('POST', '/api/admin/site/galleries', { title: 'Bad' })).body.gallery;
  const f = new FormData();
  f.append('original', new File([JPEG], 'a.jpg')); f.append('grid', new File([Buffer.from('nope')], 'g.jpg'));
  f.append('full', new File([JPEG], 'f.jpg')); f.append('width', '10'); f.append('height', '10');
  const r = await fetch(`${base}/api/admin/site/photos?gallery=${g.id}`, { method: 'POST', headers: H(), body: f });
  assert.equal(r.status, 415);
});

test('preview serves the built site and its images, only when signed in', async () => {
  const anon = await fetch(base + '/admin/site-preview/', { redirect: 'manual' });
  assert.equal(anon.status, 302);
  const home = await fetch(base + '/admin/site-preview/', { headers: H() });
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Autumn Wedding/);
  const src = html.match(/src="(\/admin\/site-preview\/img\/[^"]+)"/)[1];
  const img = await fetch(base + src, { headers: H() });
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  const missing = await fetch(base + '/admin/site-preview/nope/', { headers: H() });
  assert.equal(missing.status, 404);
});

test('publish deploys, records a version and clears the unpublished flag', async () => {
  let st = (await (await fetch(base + '/api/admin/site', { headers: H() })).json());
  assert.equal(st.dirty, true);
  const r = await send('POST', '/api/admin/site/publish');
  assert.equal(r.status, 200);
  st = await (await fetch(base + '/api/admin/site', { headers: H() })).json();
  assert.equal(st.dirty, false);
  assert.equal(st.publishes[0].status, 'ok');
  assert.equal(st.liveDeploymentId, st.publishes[0].deploymentId);
  const manifest = JSON.parse(deploys.at(-1).get('manifest'));
  assert.ok(manifest['/index.html'] && manifest['/Autumn-Wedding/index.html']);
});

test('restore rolls Cloudflare back and puts the old state back', async () => {
  const first = (await (await fetch(base + '/api/admin/site', { headers: H() })).json()).publishes[0];
  await send('POST', '/api/admin/site/galleries', { title: 'Added Later' });
  const r = await send('POST', '/api/admin/site/restore', { id: first.id });
  assert.equal(r.status, 200);
  assert.equal(deploys.at(-1), `rollback:${first.deploymentId}`);
  const st = await (await fetch(base + '/api/admin/site', { headers: H() })).json();
  assert.ok(!st.state.galleries.some(g => g.title === 'Added Later'));
  assert.equal(st.dirty, false);
  assert.equal(st.liveDeploymentId, first.deploymentId);
});

test('a failed publish emails, keeps the site, and says why', async () => {
  const before = mails.length;
  site.store.setMeta('_test_fail_deploy', '1');   /* honoured only when cfg.allowTestHooks is set */
  const r = await send('POST', '/api/admin/site/publish');
  assert.equal(r.status, 502);
  assert.match(r.body.error, /test failure/);
  assert.equal(mails.length, before + 1);
});

test('retrying a photo that is already in Immich changes nothing', async () => {
  const g = (await send('POST', '/api/admin/site/galleries', { title: 'Twice' })).body.gallery;
  const up = await upload(g.id);
  await waitForImmich(up.body.photo.id, 'ok');
  const assets = fake.seen.assets;
  const r = await fetch(`${base}/api/admin/site/photos/${up.body.photo.id}/retry`, { method: 'POST', headers: H() });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).photo.immichStatus, 'ok');
  assert.equal(fake.seen.assets, assets);
});

test('two uploads at once to a new gallery make one Immich album', async () => {
  const g = (await send('POST', '/api/admin/site/galleries', { title: 'Twins' })).body.gallery;
  const rs = await Promise.all([upload(g.id), upload(g.id)]);
  assert.deepEqual(rs.map(r => r.status), [201, 201]);
  for (const r of rs) await waitForImmich(r.body.photo.id, 'ok');
  assert.equal(fake.seen.albums.filter(a => a.albumName === 'Website – Twins').length, 1);
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const logo = (name, body) => fetch(`${base}/api/admin/site/logo?name=${name}`, { method: 'POST', headers: H(), body });

test('logos: PNG and plain SVG accepted, anything scriptable refused', async () => {
  assert.equal((await logo('a.png', PNG)).status, 200);
  assert.equal((await logo('a.svg', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>')).status, 200);
  const svgImg = await fetch(base + '/api/admin/site/img/logo.svg', { headers: H() });
  assert.equal(svgImg.headers.get('content-type'), 'image/svg+xml');
  assert.match(svgImg.headers.get('content-security-policy'), /sandbox/);
  assert.equal(svgImg.headers.get('x-content-type-options'), 'nosniff');
  for (const bad of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><p/></foreignObject></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="&#106;avascript:alert(1)"><rect/></a></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.com/x.svg#a"/></svg>',
  ]) assert.equal((await logo('b.svg', bad)).status, 415, bad);
  await fetch(base + '/api/admin/site/logo', { method: 'DELETE', headers: H() });
});

test('stored images are served; other names are not', async () => {
  const g = (await send('POST', '/api/admin/site/galleries', { title: 'Imgs' })).body.gallery;
  const k = (await upload(g.id)).body.photo.fileKey;
  const ok = await fetch(`${base}/api/admin/site/img/${k}-grid.jpg`, { headers: H() });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  for (const n of ['../server.mjs', 'x.jpg', '%2e%2e%2fserver.mjs'])
    assert.equal((await fetch(`${base}/api/admin/site/img/${n}`, { headers: H() })).status, 404, n);
});

test('backup copies the web copies and the logo', async () => {
  await logo('a.png', PNG);
  const out = mkdtempSync(join(tmpdir(), 'bk-'));
  const r = site.backup(out);
  assert.ok(r.photos >= 1);
  assert.ok(readdirSync(join(out, 'site', 'img')).length >= 2);
  assert.ok(existsSync(join(out, 'site', 'logo.png')));
  await fetch(base + '/api/admin/site/logo', { method: 'DELETE', headers: H() });
});

test('restoring a version that does not exist is a 400', async () => {
  const r = await send('POST', '/api/admin/site/restore', { id: 99999 });
  assert.equal(r.status, 400);
});

test('summary reports unpublished edits, photos waiting for Immich and the last site check', async () => {
  const s = site.summary();
  assert.deepEqual(Object.keys(s).sort(), ['check', 'dirty', 'pendingImmich']);
  assert.equal(typeof s.dirty, 'boolean');
  assert.equal(s.pendingImmich, site.store.pendingImmich().length);
  assert.equal(s.check, null);
});
