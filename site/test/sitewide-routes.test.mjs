import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSite } from '../routes.mjs';

/* the same harness as builder-routes.test.mjs, without Immich: nothing here uploads photos */
let srv, base, site, deploys = [];
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

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-w-'));
  const json = (res, code, obj, headers) => { res.writeHead(code, { 'content-type': 'application/json', ...(headers || {}) }); res.end(JSON.stringify(obj)); };
  const readJson = async (req, limit = 64 * 1024) => { let n = 0, s = ''; for await (const c of req) { n += c.length; s += c; } if (n > limit) throw new Error('body too large'); return s ? JSON.parse(s) : {}; };
  site = createSite({ db: new DatabaseSync(':memory:'), json, readJson, immich: async () => new Response('{}', { status: 503 }), canUpload: () => false,
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
});
after(() => srv.close());

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const save = (st, site, pages = st.pages) => call('PUT', '/api/admin/site/pages', { pages, site }, { 'x-pages-rev': String(st.pagesRev) });
const renamed = (st, name) => ({ ...structuredClone(st.site), name });

test('an unsaved site shows the header, footer, theme and wording made from its settings', async () => {
  const st = await getSite();
  assert.equal(st.siteSaved, false);
  assert.deepEqual(st.site.header.elements.map(e => e.type), ['logo', 'menu']);
  assert.deepEqual(st.site.footer.elements.map(e => e.type), ['text', 'social']);
  assert.equal(st.site.theme.page, st.state.settings.style.page);
  assert.equal(st.site.wording.notFoundHeading, 'Page not found');
});

test('the element types, band styles, theme and wording come with their forms', async () => {
  const r = (await call('GET', '/api/admin/site/blocks')).body;
  assert.deepEqual(r.elements.map(t => t.type), ['logo', 'siteName', 'menu', 'link', 'button', 'social', 'text', 'spacer']);
  assert.deepEqual(r.headerStyle.map(f => f.key), Object.keys(r.headerStyleDefaults));
  assert.deepEqual(r.footerStyle.map(f => f.key), Object.keys(r.footerStyleDefaults));
  assert.deepEqual(r.elementMotion.map(f => f.key), Object.keys(r.elementMotionDefaults));
  assert.equal(r.elementVisible.key, 'visible');
  assert.ok(r.theme.find(f => f.key === 'headingFont').options.length >= 10);
  assert.ok(r.wording.every(f => f.kind === 'text'));
});

test('the site is saved with the pages as a draft: the preview shows it, nothing is deployed', async () => {
  const st = await getSite(), before = deploys.length;
  const r = await save(st, renamed(st, 'Draft Studio'));
  assert.equal(r.status, 200);
  assert.equal(r.body.pagesRev, st.pagesRev + 1);
  assert.equal(typeof r.body.rev, 'number');
  const now = await getSite();
  assert.equal(now.siteSaved, true);
  assert.equal(now.site.name, 'Draft Studio');
  assert.equal(now.dirty, true);
  assert.match(await (await fetch(base + '/admin/site-preview/', { headers: H() })).text(), /<title>Draft Studio<\/title>/);
  assert.equal(deploys.length, before);
});

test('bad addresses and broken bands are refused with every reason; nothing is saved', async () => {
  const st = await getSite();
  const bad = structuredClone(st.site);
  bad.header.elements.push({ id: 'evil', type: 'menu', props: { items: [{ id: 'm1', kind: 'link', label: 'x', url: 'javascript:alert(1)' }] } });
  bad.footer.elements.push({ id: 'b1', type: 'button', props: { label: 'x', link: { kind: 'url', url: 'data:text/html,hi' } } });
  bad.theme.headingFont = 'Evil Font';
  const r = await save(st, bad);
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.errors, ['Header: Menu, items: menu links must start with https://, http://, mailto:, tel: or / for a page on this site',
    'Footer: Button, link: links must start with https://, http://, mailto: or tel:', `Theme, headingFont: choose one of: ${r.body.errors[2].split(': ').pop()}`]);
  assert.match(r.body.errors[2], /Roboto, Figtree/);
  assert.equal((await save(st, 'nope')).status, 400);
  assert.equal((await getSite()).pagesRev, st.pagesRev);
});

test('the live preview renders an unsaved site and saves nothing; the editor marks the bands', async () => {
  const st = await getSite();
  const site = renamed(st, 'Preview Only');
  site.wording.notFoundHeading = 'Lost?';
  const r = await call('POST', '/api/admin/site/render', { pages: st.pages, slug: '', site });
  assert.equal(r.status, 200);
  assert.match(r.body.html, /<title>Preview Only<\/title>/);
  assert.match(r.body.html, /data-band="header"/);
  assert.match((await call('POST', '/api/admin/site/render', { pages: st.pages, slug: 'no-such-page', site })).body.html, /<h2>Lost\?<\/h2>/);
  assert.equal((await getSite()).site.name, 'Draft Studio');
  const bad = await call('POST', '/api/admin/site/render', { pages: st.pages, slug: '', site: { ...site, theme: { ...site.theme, ink: 'nope' } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.errors[0], /Theme, ink/);
  assert.equal((await call('POST', '/api/admin/site/render', { pages: st.pages, slug: '' })).status, 200, 'an editor that sends pages only still previews');
});

test('an editor that sends pages only leaves the saved site alone', async () => {
  const st = await getSite();
  assert.equal((await putPages(st.pages, st.pagesRev)).status, 200);
  assert.equal((await getSite()).site.name, 'Draft Studio');
});

test('publish carries the site; discard goes back to it', async () => {
  assert.equal((await call('POST', '/api/admin/site/publish')).status, 200);
  const st = await getSite();
  await save(st, renamed(st, 'Changed my mind'));
  const d = await call('POST', '/api/admin/site/pages/discard');
  assert.equal(d.status, 200);
  assert.equal(d.body.site.name, 'Draft Studio');
  assert.equal(d.body.siteSaved, true);
  assert.equal((await getSite()).pagesRev, d.body.pagesRev);
});

test('restoring a version from before the site could be edited brings back the one made from its settings', async () => {
  const old = JSON.parse(site.store.snapshot());
  delete old.site;
  const id = site.store.recordPublish({ status: 'ok', deploymentId: 'dep-old', rev: site.store.rev(), snapshot: JSON.stringify(old) });
  assert.equal((await call('POST', '/api/admin/site/restore', { id })).status, 200);
  const st = await getSite();
  assert.equal(st.siteSaved, false);
  assert.equal(st.site.name, st.state.settings.siteName);
});

test('the logo upload still works and says which file it kept; the header shows it', async () => {
  const up = await fetch(base + '/api/admin/site/logo?name=a.png', { method: 'POST', headers: H(), body: PNG });
  assert.equal(up.status, 200);
  const j = await up.json();
  assert.equal(j.logo, 'logo.png');
  assert.equal(typeof j.rev, 'number');
  const st = await getSite();
  assert.equal(st.state.settings.style.logo, 'logo.png');
  assert.match(await (await fetch(base + '/admin/site-preview/', { headers: H() })).text(), /<a class="logo" href="\/admin\/site-preview\/"><img src="\/admin\/site-preview\/logo\.png"/);
  assert.equal((await fetch(base + '/admin/site-preview/logo.png', { headers: H() })).headers.get('cache-control'), 'no-store', 'a replaced logo shows at once');
  const del = await (await fetch(base + '/api/admin/site/logo', { method: 'DELETE', headers: H() })).json();
  assert.equal(del.logo, null);
});

test('hostile payloads answer 400, a missing site stays missing, null is refused', async () => {
  const st = await getSite();
  for (const hostile of [{ header: null }, { header: { elements: 5 }, footer: [], theme: 'x', wording: 7 }, []]) {
    const r = await save(st, hostile);
    assert.equal(r.status, 400, JSON.stringify(hostile));
    assert.equal((await call('POST', '/api/admin/site/render', { pages: st.pages, slug: '', site: hostile })).status, 400);
  }
  assert.equal((await call('PUT', '/api/admin/site/pages', { pages: st.pages, site: null }, { 'x-pages-rev': String(st.pagesRev) })).status, 400);
  assert.equal((await getSite()).pagesRev, st.pagesRev);
});
