import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSite } from '../routes.mjs';
import { startFakeImmich } from './fake-immich.mjs';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
let srv, base, site, fake, gid, deploys = [];

const cfFetch = async (url, init = {}) => {
  const ok = r => new Response(JSON.stringify({ success: true, errors: [], result: r }));
  if (url.endsWith('/upload-token')) return ok({ jwt: 'J' });
  if (url.endsWith('/check-missing')) return ok(JSON.parse(init.body).hashes);
  if (url.endsWith('/deployments')) { deploys.push(init.body); return ok({ id: `dep-${deploys.length}`, url: 'https://t.pages.dev' }); }
  if (url.endsWith('/rollback')) { deploys.push('rollback:' + url.split('/').at(-2)); return ok({}); }
  return ok(true);
};
const H = extra => ({ 'x-admin-token': 'T', ...extra });
const getSite = async () => (await fetch(base + '/api/admin/site', { headers: H() })).json();
async function call(method, path, body, headers = {}) {
  const r = await fetch(base + path, { method, headers: H({ 'content-type': 'application/json', ...headers }), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const putPages = (pages, pagesRev) => call('PUT', '/api/admin/site/pages', { pages }, { 'x-pages-rev': String(pagesRev) });
async function upload(gallery) {
  const f = new FormData();
  f.append('original', new File([JPEG], 'o.jpg')); f.append('grid', new File([JPEG], 'g.jpg')); f.append('full', new File([JPEG], 'f.jpg'));
  f.append('width', '2048'); f.append('height', '1365');
  return (await fetch(`${base}/api/admin/site/photos?gallery=${gallery}`, { method: 'POST', headers: H(), body: f })).json();
}
const newsPage = text => ({ id: 'pnews', title: 'News', slug: 'news', inMenu: true, seoTitle: '', seoDescription: '', galleryId: null,
  blocks: [{ id: 'bnews', type: 'heading', props: { text } }] });

before(async () => {
  fake = await startFakeImmich(0, { fail: { value: false } });
  const dir = mkdtempSync(join(tmpdir(), 'site-b-'));
  const json = (res, code, obj, headers) => { res.writeHead(code, { 'content-type': 'application/json', ...(headers || {}) }); res.end(JSON.stringify(obj)); };
  /* reads the whole body before refusing it, so the client always gets the answer */
  const readJson = async (req, limit = 64 * 1024) => { let n = 0, s = ''; for await (const c of req) { n += c.length; s += c; } if (n > limit) throw new Error('body too large'); return s ? JSON.parse(s) : {}; };
  const immich = (p, init = {}) => { const { write, ...rest } = init; return fetch(fake.url + p, rest); };
  site = createSite({ db: new DatabaseSync(':memory:'), json, readJson, immich, canUpload: () => true,
    adminOk: req => req.headers['x-admin-token'] === 'T', tellAdmin: async () => {}, fetch: cfFetch,
    cfg: { dataDir: dir, uploadMaxMb: 50, cfAccountId: 'acc', cfPagesToken: 'tok', cfPagesProject: 'test', siteUrl: '', allowTestHooks: true } });
  srv = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/admin/site-preview/')) return site.preview(req, res, url.pathname);
    if (req.headers['x-admin-token'] !== 'T') { res.writeHead(401); return res.end(); }
    return site.admin(req, res, url.pathname, url);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  gid = (await call('POST', '/api/admin/site/galleries', { title: 'Weddings' }, { 'x-site-rev': String((await getSite()).rev) })).body.gallery.id;
  await upload(gid);
});
after(() => { srv.close(); fake.srv.close(); });

test('an unsaved site shows the pages made from its settings', async () => {
  const st = await getSite();
  assert.deepEqual(st.pages.map(p => p.id), ['home', `g${gid}`, 'about', 'contact']);
  assert.equal(st.pagesSaved, false);
  assert.equal(st.pagesRev, 0);
});

test('block types come with their forms, and style and motion with theirs', async () => {
  const r = await call('GET', '/api/admin/site/blocks');
  assert.equal(r.status, 200);
  assert.equal(r.body.types.length, 13);
  for (const t of r.body.types) { assert.ok(Array.isArray(t.fields) && t.label && t.icon); assert.match(t.sketch, /^<svg/); }
  assert.deepEqual(r.body.style.map(f => f.key), Object.keys(r.body.styleDefaults));
  assert.deepEqual(r.body.motion.map(f => f.key), Object.keys(r.body.motionDefaults));
});

test('saving pages makes a draft: the preview shows it, nothing is deployed', async () => {
  const st = await getSite(), before = deploys.length;
  const r = await putPages([...st.pages, newsPage('Fresh news')], st.pagesRev);
  assert.equal(r.status, 200);
  assert.equal(r.body.pagesRev, st.pagesRev + 1);
  const now = await getSite();
  assert.equal(now.pagesSaved, true);
  assert.equal(now.dirty, true);
  const pv = await fetch(base + '/admin/site-preview/news/', { headers: H() });
  assert.match(await pv.text(), /Fresh news/);
  assert.equal(deploys.length, before);
});

test('a save from an older copy is refused; uploading a photo does not make the draft stale', async () => {
  const st = await getSite();
  await upload('pages');
  assert.equal((await putPages(st.pages, st.pagesRev)).status, 200);
  assert.deepEqual(await putPages(st.pages, st.pagesRev), { status: 409, body: { error: 'stale' } });
});

test('address clashes are refused with every reason', async () => {
  const st = await getSite();
  const bad = [...st.pages, { ...newsPage('x'), id: 'pimg', slug: 'img', blocks: [] }, { ...newsPage('y'), id: 'pwed', slug: 'weddings', blocks: [] }];
  const r = await putPages(bad, st.pagesRev);
  assert.equal(r.status, 400);
  assert.equal(r.body.errors.length, 3, '/img/ is the site’s own; /weddings/ is the gallery’s address, and its page already uses it');
  assert.match(r.body.error, /\/img\/ is used by the site itself/);
  assert.match(r.body.errors.join('\n'), /\/weddings\/ is a gallery’s address/);
});

test('too much at once is refused', async () => {
  const st = await getSite();
  const huge = [...st.pages, { ...newsPage('x'), id: 'pbig', slug: 'big', blocks: [{ id: 'bbig', type: 'rich-text', props: { html: 'x'.repeat(3 * 1024 * 1024) } }] }];
  assert.equal((await putPages(huge, st.pagesRev)).status, 413);
});

test('the live preview renders unsaved pages and saves nothing', async () => {
  const st = await getSite();
  const pages = st.pages.map(p => (p.id === 'pnews' ? newsPage('Unsaved words') : p));
  const r = await call('POST', '/api/admin/site/render', { pages, slug: 'news' });
  assert.equal(r.status, 200);
  assert.match(r.body.html, /Unsaved words/);
  assert.match(r.body.html, /data-b="bnews"/);
  assert.doesNotMatch(r.body.html, /<script src=/);
  assert.equal(r.body.rev, st.rev);
  assert.equal((await getSite()).pagesRev, st.pagesRev);
  const bad = await call('POST', '/api/admin/site/render', { pages: [], slug: '' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.errors.join('\n'), /one home page/);
});

test('publish carries the pages; discard goes back to them', async () => {
  const pub = await call('POST', '/api/admin/site/publish');
  assert.equal(pub.status, 200);
  const manifest = JSON.parse(deploys.at(-1).get('manifest'));
  assert.ok(manifest['/news/index.html']);
  const st = await getSite();
  await putPages(st.pages.map(p => (p.id === 'pnews' ? newsPage('Changed my mind') : p)), st.pagesRev);
  const d = await call('POST', '/api/admin/site/pages/discard');
  assert.equal(d.status, 200);
  assert.equal(d.body.pages.find(p => p.id === 'pnews').blocks[0].props.text, 'Fresh news');
  assert.equal((await getSite()).pagesRev, d.body.pagesRev);
});

test('restoring a version from before pages existed brings back the old fixed pages', async () => {
  const old = JSON.parse(site.store.snapshot());
  delete old.pages;
  const id = site.store.recordPublish({ status: 'ok', deploymentId: 'dep-old', rev: site.store.rev(), snapshot: JSON.stringify(old) });
  const r = await call('POST', '/api/admin/site/restore', { id });
  assert.equal(r.status, 200);
  const st = await getSite();
  assert.equal(st.pagesSaved, false);
  assert.deepEqual(st.pages.map(p => p.id), ['home', `g${gid}`, 'about', 'contact']);
});

test('a gallery deleted after pages were saved does not break the editor, the preview or the render', async () => {
  const g2 = (await call('POST', '/api/admin/site/galleries', { title: 'Temp' }, { 'x-site-rev': String((await getSite()).rev) })).body.gallery.id;
  await upload(g2);
  const st = await getSite();
  const page = { ...newsPage('x'), id: 'pdang', slug: 'dang', blocks: [{ id: 'bdang', type: 'photo-grid', props: { galleryId: g2 } }] };
  const saved = await putPages([...st.pages, page], st.pagesRev);
  assert.equal(saved.status, 200);
  assert.equal(typeof saved.body.rev, 'number');
  assert.equal((await call('DELETE', `/api/admin/site/galleries/${g2}`, undefined, { 'x-site-rev': String(saved.body.rev) })).status, 200);
  const now = await getSite();
  assert.ok(now.pages.some(p => p.id === 'pdang'));
  const r = await call('POST', '/api/admin/site/render', { pages: now.pages, slug: 'dang' });
  assert.equal(r.status, 200);
  assert.match(r.body.html, /data-b="bdang"/);
  assert.equal((await fetch(base + '/admin/site-preview/dang/', { headers: H() })).status, 200);
});

test('a body that is not an object is refused instead of hanging', async () => {
  const raw = (method, path, body) => fetch(base + path, { method, headers: H({ 'content-type': 'application/json' }), body });
  for (const [method, path] of [['PUT', '/api/admin/site/pages'], ['POST', '/api/admin/site/render'], ['POST', '/api/admin/site/pages/discard']]) {
    for (const body of ['null', '0', 'false', '[]']) {
      const r = await raw(method, path, body);
      assert.equal(r.status, 400, `${method} ${path} ${body}`);
      assert.ok((await r.json()).error);
    }
    assert.equal((await raw(method, path, '{nope')).status, 400);
  }
});
