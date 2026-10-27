import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeImmich } from '../../setup/test/fake-services.mjs';
import { DEFAULT_DESIGN } from '../design.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const TOKEN = 'design-test-token';
let imm, app, port, B, logs = '';

const call = async (method, path, body, headers = {}) => {
  const r = await fetch(B + path, { method, redirect: 'manual', headers: { 'x-admin-token': TOKEN, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, body: j, text, headers: r.headers };
};

before(async () => {
  imm = await fakeImmich(); port = await freePort(); B = `http://127.0.0.1:${port}`;
  app = spawn('node', [join(ROOT, 'server.mjs')], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, PORT: String(port),
    DATA_DIR: mkdtempSync(join(tmpdir(), 'design-')), WEB_DIR: join(ROOT, 'web'), HEALTH_MINUTES: '0', PREZIP: 'off',
    IMMICH_URL: imm.url, IMMICH_API_KEY: imm.st.key, APP_SECRET: 'a'.repeat(32), ADMIN_TOKEN: TOKEN, PUBLIC_URL: B } });
  app.stdout.on('data', d => logs += d); app.stderr.on('data', d => logs += d);
  const t = Date.now();
  for (;;) { try { if ((await fetch(B + '/healthz')).ok) break; } catch {} if (Date.now() - t > 15000) throw new Error('did not start\n' + logs); await sleep(100); }
});
after(() => { app?.kill(); imm?.close(); });

test('the design routes need the admin', async () => {
  for (const [m, p] of [['GET', '/api/admin/design'], ['PUT', '/api/admin/design'], ['POST', '/api/admin/design/render'],
    ['POST', '/api/admin/design/import'], ['GET', '/api/admin/design/export']]) {
    const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'GET' ? undefined : '{}' });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
});

test('a fresh install has the default site design and the limits the admin builds its controls from', async () => {
  const r = await call('GET', '/api/admin/design');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.site, DEFAULT_DESIGN);
  assert.equal(r.body.ranges.gap.max, 40);
  assert.ok(r.body.fonts.some(f => f.id === 'montserrat'));
  assert.ok(r.body.enums.theme.includes('system'));
  assert.ok(r.body.coverLayouts.some(l => l.id === 'split'));
  assert.ok(r.body.colorPresets.length >= 9 && r.body.typePresets[0].id === 'classic');
  assert.ok(r.body.fonts.every(f => f.stack));
});

test('cover layout and title settings reach the gallery page; a bad layout is refused', async () => {
  let r = await call('POST', '/api/admin/galleries', { slug: 'layout-gallery', title: 'Layouts', albumId: '00000000-0000-4000-8000-0000000000a1' });
  const id = r.body.id;
  r = await call('PATCH', `/api/admin/galleries/${id}`, { design: { coverLayout: 'split', titleCase: 'none' } });
  assert.equal(r.status, 200);
  const html = await (await fetch(B + '/layout-gallery')).text();
  const css = (html.match(/<style id="ims-design">([\s\S]*?)<\/style>/) || [])[1];
  assert.match(css, /grid-template-columns:1fr 1fr/); assert.match(css, /text-transform:none/); assert.match(css, /--ims-cover-layout:split/);
  r = await call('PATCH', `/api/admin/galleries/${id}`, { design: { coverLayout: 'spiral' } });
  assert.equal(r.status, 400); assert.ok(r.body.errors.coverLayout);
  await call('DELETE', `/api/admin/galleries/${id}`);
});

test('saving the site design is strict, and sticks', async () => {
  let r = await call('PUT', '/api/admin/design', { design: { ...DEFAULT_DESIGN, gap: 999 } });
  assert.equal(r.status, 400); assert.match(r.body.error, /between/); assert.ok(r.body.errors.gap);
  r = await call('PUT', '/api/admin/design', { design: { ...DEFAULT_DESIGN, shadow: 1 } });
  assert.equal(r.status, 400);
  r = await call('PUT', '/api/admin/design', { design: { ...DEFAULT_DESIGN, customCss: '.a{background:url(x)}' } });
  assert.equal(r.status, 400); assert.match(r.body.error, /Custom CSS, line 1/);
  r = await call('PUT', '/api/admin/design', { design: { ...DEFAULT_DESIGN, theme: 'dark', gap: 6 } });
  assert.equal(r.status, 200); assert.equal(r.body.site.gap, 6);
  assert.equal((await call('GET', '/api/admin/design')).body.site.theme, 'dark');
});

let gid;
test('a gallery keeps only its overrides, and can go back to following the site', async () => {
  let r = await call('POST', '/api/admin/galleries', { slug: 'sample-gallery', title: 'Sample Gallery', albumId: '00000000-0000-4000-8000-0000000000a1' });
  assert.equal(r.status, 201, r.text); gid = r.body.id;
  assert.equal(r.body.design, null);
  r = await call('PATCH', `/api/admin/galleries/${gid}`, { design: { gap: 20, background: '#222222' } });
  assert.equal(r.status, 200); assert.deepEqual(r.body.design, { gap: 20, background: '#222222' });
  r = await call('PATCH', `/api/admin/galleries/${gid}`, { design: { gap: 999 } });
  assert.equal(r.status, 400); assert.ok(r.body.errors.gap);
  r = await call('PATCH', `/api/admin/galleries/${gid}`, { design: { colour: 'red' } });
  assert.equal(r.status, 400);
  assert.deepEqual((await call('GET', `/api/admin/galleries/${gid}`)).body.design, { gap: 20, background: '#222222' }, 'a rejected save changes nothing');
  r = await call('PATCH', `/api/admin/galleries/${gid}`, { title: 'Renamed' });
  assert.deepEqual(r.body.design, { gap: 20, background: '#222222' }, 'saving something else leaves the design alone');
  r = await call('PATCH', `/api/admin/galleries/${gid}`, { design: null });
  assert.equal(r.body.design, null);
});

test('render previews without saving: site scope replaces, gallery scope overrides the saved site design', async () => {
  let r = await call('POST', '/api/admin/design/render', { scope: 'site', design: { gap: 4, theme: 'light' } });
  assert.equal(r.status, 200); assert.match(r.body.css, /--gap:4px/); assert.match(r.body.css, /--page-bg:#ffffff/);
  r = await call('POST', '/api/admin/design/render', { scope: 'gallery', design: { gap: 4 } });
  assert.match(r.body.css, /--gap:4px/); assert.match(r.body.css, /--page-bg:#111111/, 'inherits the dark site design');
  assert.equal((await call('GET', '/api/admin/design')).body.site.gap, 6, 'nothing was saved');
  r = await call('POST', '/api/admin/design/render', { scope: 'site', design: { font: 'lora' } });
  assert.match(r.body.fontHref, /family=Lora/);
});

test('render keeps previewing when only the custom CSS is wrong, and says where', async () => {
  const r = await call('POST', '/api/admin/design/render', { scope: 'site', design: { gap: 3, customCss: '.a{background:url(x)}' } });
  assert.equal(r.status, 200);
  assert.match(r.body.errors.customCss, /line 1/);
  assert.match(r.body.css, /--gap:3px/);
  assert.doesNotMatch(r.body.css, /url/);
  const bad = await call('POST', '/api/admin/design/render', { scope: 'site', design: { gap: 3, theme: 'neon' } });
  assert.equal(bad.body.css, ''); assert.ok(bad.body.errors.theme);
});

test('export and import round-trip through the design file', async () => {
  const ex = await fetch(B + '/api/admin/design/export', { headers: { 'x-admin-token': TOKEN } });
  assert.equal(ex.status, 200);
  assert.match(ex.headers.get('content-disposition'), /immichset-design\.json/);
  const text = await ex.text();
  assert.equal(JSON.parse(text).design.gap, 6);
  let r = await call('POST', '/api/admin/design/import', { text });
  assert.equal(r.status, 200); assert.equal(r.body.design.gap, 6);
  r = await call('POST', '/api/admin/design/import', { text: '{"format":"other"}' });
  assert.equal(r.status, 400); assert.match(r.body.error, /not an immichset/);
  assert.equal((await call('GET', '/api/admin/design/export?gallery=99999')).status, 404);
  const g = await fetch(B + `/api/admin/design/export?gallery=${gid}`, { headers: { 'x-admin-token': TOKEN } });
  assert.equal(JSON.parse(await g.text()).design.theme, 'dark', 'a gallery exports its effective design');
});

const page = (slug) => fetch(B + '/' + slug).then(async r => ({ status: r.status, html: await r.text(), headers: r.headers }));
const styleOf = (html) => (html.match(/<style id="ims-design">([\s\S]*?)<\/style>/) || [])[1];

test('a gallery page carries the design it inherits, and nothing a visitor could use to break out', async () => {
  const { status, html } = await page('sample-gallery');
  assert.equal(status, 200);
  const css = styleOf(html);
  assert.match(css, /--gap:6px/); assert.match(css, /--page-bg:#111111/);
  assert.doesNotMatch(css, /</);
  assert.equal(html.split('id="ims-design"').length, 2, 'exactly one design block');
});

test('an all-default design leaves a new gallery page exactly as it was, and does not touch existing ones', async () => {
  assert.equal((await call('PUT', '/api/admin/design', { design: DEFAULT_DESIGN })).status, 200);
  const kept = (await page('sample-gallery')).html;
  assert.match(styleOf(kept), /--gap:6px/, 'the existing gallery keeps the dark look it had');
  await call('POST', '/api/admin/galleries', { slug: 'plain-gallery', title: 'Plain', albumId: '00000000-0000-4000-8000-0000000000a1' });
  const { html } = await page('plain-gallery');
  assert.equal(styleOf(html), undefined);
  assert.match(html, /family=Montserrat:wght@300;400;500;600;700&display=swap/);
  assert.match(html, /<!--ims:font-->/);
});

test('a gallery override reaches its own page only, and a system font drops the Google link', async () => {
  await call('POST', '/api/admin/galleries', { slug: 'other-gallery', title: 'Other', albumId: '00000000-0000-4000-8000-0000000000a1' });
  let r = await call('PATCH', `/api/admin/galleries/${gid}`, { design: { font: 'system-sans', radius: 8 } });
  assert.equal(r.status, 200);
  const mine = (await page('sample-gallery')).html, other = (await page('other-gallery')).html;
  assert.doesNotMatch(mine, /<link[^>]+googleapis/); assert.match(styleOf(mine), /--radius:8px/);
  assert.equal(styleOf(other), undefined); assert.match(other, /<link[^>]+googleapis/);
});

test('custom CSS is scoped, and cannot close the style block', async () => {
  const r = await call('PATCH', `/api/admin/galleries/${gid}`, { design: { customCss: '.cell{opacity:.5}' } });
  assert.equal(r.status, 200);
  const { html } = await page('sample-gallery');
  assert.ok(styleOf(html).endsWith(':where(#app,#lb) .cell{opacity:.5}'));
  const evil = await call('PATCH', `/api/admin/galleries/${gid}`, { design: { customCss: '</style><script>alert(1)</script>' } });
  assert.equal(evil.status, 400);
  assert.doesNotMatch((await page('sample-gallery')).html, /alert\(1\)/);
});

test('a draft or unpublished gallery still gets its design on the bare page', async () => {
  await call('PATCH', `/api/admin/galleries/${gid}`, { published: false });
  const { status, html } = await page('sample-gallery');
  assert.equal(status, 200);
  assert.match(styleOf(html), /\.cell\{opacity:\.5\}/);
  assert.doesNotMatch(html, /og:title/, 'no preview card for an unpublished gallery');
  await call('PATCH', `/api/admin/galleries/${gid}`, { published: true });
});

test('the device preview is for the admin only', async () => {
  const anon = await fetch(B + `/admin/design-preview/${gid}`, { redirect: 'manual' });
  assert.equal(anon.status, 302); assert.equal(anon.headers.get('location'), '/admin');
  assert.equal((await fetch(B + `/api/admin/design-preview/${gid}`)).status, 401);
  const ok = await fetch(B + `/admin/design-preview/${gid}`, { headers: { 'x-admin-token': TOKEN } });
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('x-robots-tag'), 'noindex');
  const html = await ok.text();
  assert.match(html, new RegExp(`<meta name="ims-preview" content="${gid}">`));
  assert.match(styleOf(html), /\.cell\{opacity:\.5\}/, 'starts from the saved design');
  assert.equal((await fetch(B + '/admin/design-preview/site', { headers: { 'x-admin-token': TOKEN } })).status, 200);
  assert.equal((await fetch(B + '/admin/design-preview/99999', { headers: { 'x-admin-token': TOKEN } })).status, 404);
});

test('preview data has the public shape but no gate, no originals, and its own cover address', async () => {
  const d = await call('GET', `/api/admin/design-preview/${gid}`);
  assert.equal(d.status, 200);
  assert.equal(d.body.gate, null); assert.equal(d.body.allowDownload, false);
  assert.ok(d.body.cover.startsWith(`/api/admin/design-preview/${gid}/cover`));
  assert.equal(d.body.title, 'Renamed');
  const id = '00000000-0000-4000-8000-0000000000b1';
  assert.equal((await call('GET', `/api/admin/design-preview/${gid}/img/${id}?size=original`)).status, 403);
  assert.equal((await call('GET', `/api/admin/design-preview/${gid}/img/${id}?size=web`)).status, 403);
  assert.equal((await call('GET', `/api/admin/design-preview/${gid}/zip`)).status, 404);
  assert.equal((await call('GET', `/api/admin/design-preview/${gid}/favourites`)).status, 200);
  const site = await call('GET', '/api/admin/design-preview/site');
  assert.equal(site.status, 200);
});

test('a new default look is for galleries made from now on: existing galleries keep exactly their look', async () => {
  const mk = async (slug, design) => {
    const r = await call('POST', '/api/admin/galleries', { slug, title: slug, albumId: '00000000-0000-4000-8000-0000000000a1' });
    if (design) await call('PATCH', `/api/admin/galleries/${r.body.id}`, { design });
    return r.body.id;
  };
  const effective = async (id) => JSON.parse((await call('GET', `/api/admin/design/export?gallery=${id}`)).text).design;
  await call('PUT', '/api/admin/design', { design: DEFAULT_DESIGN });
  const follower = await mk('pin-follower'), own = await mk('pin-own', { radius: 7, gap: 3 });
  const before = { follower: await effective(follower), own: await effective(own) };

  const next = { ...DEFAULT_DESIGN, theme: 'dark', gap: 4, header: 'centered', favourites: 'off' };
  assert.equal((await call('PUT', '/api/admin/design', { design: next })).status, 200);

  assert.deepEqual(await effective(follower), before.follower, 'a gallery that followed the default is unchanged');
  assert.deepEqual(await effective(own), before.own, 'a gallery with its own settings is unchanged');
  assert.deepEqual((await call('GET', `/api/admin/galleries/${follower}`)).body.design, { theme: 'light', gap: 10, header: 'bar', favourites: 'on' }, 'written down only where it differs from the new default');

  const fresh = await mk('pin-new');
  assert.deepEqual(await effective(fresh), next, 'a gallery made afterwards starts from the new default');
  assert.equal((await call('GET', `/api/admin/galleries/${fresh}`)).body.design, null);

  const page = await (await fetch(B + '/pin-follower')).text();
  assert.doesNotMatch(page, /--ims-header:centered/, 'the existing gallery page still has the old look');

  /* and resetting the default to the original does not disturb them either */
  assert.equal((await call('PUT', '/api/admin/design', { design: DEFAULT_DESIGN })).status, 200);
  assert.deepEqual(await effective(follower), before.follower);
  assert.deepEqual(await effective(own), before.own);
  assert.deepEqual(await effective(fresh), next, 'even the one made after: it was frozen at the look it had');
});

test('downloads: a client who took every photo is marked as having taken all of them', async () => {
  const r = await call('POST', '/api/admin/galleries', { slug: 'dl-all', title: 'All', albumId: '00000000-0000-4000-8000-0000000000a1', requireEmail: true });
  const id = r.body.id, photo = '00000000-0000-4000-8000-0000000000b1';
  const guest = async (email) => {
    const cj = {};
    const reg = await fetch(B + '/api/g/dl-all/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email.split('@')[0] }) });
    return (reg.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  };
  const took = await guest('took-all@example.com'), looked = await guest('only-looked@example.com');
  assert.ok(took && looked, 'both registered');
  const dl = await fetch(B + `/api/g/dl-all/img/${photo}?size=original`, { headers: { cookie: took } });
  assert.equal(dl.status, 200);
  const d = await call('GET', `/api/admin/galleries/${id}/downloads`);
  assert.equal(d.status, 200);
  assert.equal(d.body.total, 1, 'the gallery has one photo in this test');
  const person = d.body.people.find(p => p.email === 'took-all@example.com');
  assert.deepEqual(person.ids, [photo]);
  assert.equal(person.all, true, 'every photo in the gallery was downloaded');
  assert.equal(d.body.people.some(p => p.email === 'only-looked@example.com'), false, 'someone who downloaded nothing is not listed');
});

test('the editor works on a draft: clients see it only after it is published', async () => {
  const r = await call('POST', '/api/admin/galleries', { slug: 'draft-gallery', title: 'Draft', albumId: '00000000-0000-4000-8000-0000000000a1' });
  const id = r.body.id;
  const clientCss = async () => styleOf((await page('draft-gallery')).html);
  const previewCss = async () => styleOf(await (await fetch(B + `/admin/design-preview/${id}`, { headers: { 'x-admin-token': TOKEN } })).text());
  const dto = async () => (await call('GET', `/api/admin/galleries/${id}`)).body;
  assert.equal((await dto()).designPending, false);

  let p = await call('PATCH', `/api/admin/galleries/${id}`, { designDraft: { radius: 9, gap: 2 } });
  assert.equal(p.status, 200);
  assert.deepEqual(p.body.designDraft, { radius: 9, gap: 2 }); assert.equal(p.body.design, null); assert.equal(p.body.designPending, true);
  assert.equal(await clientCss(), undefined, 'a client still sees the published look');
  assert.match(await previewCss(), /--radius:9px/, 'the editor preview shows the draft');
  assert.equal(JSON.parse((await call('GET', `/api/admin/design/export?gallery=${id}`)).text).design.radius, 9, 'export is of what is being edited');

  p = await call('POST', `/api/admin/galleries/${id}/design/publish`);
  assert.equal(p.status, 200); assert.deepEqual(p.body.design, { radius: 9, gap: 2 }); assert.equal(p.body.designPending, false); assert.equal(p.body.designDraft, null);
  assert.match(await clientCss(), /--radius:9px/, 'now clients see it');

  /* a draft that matches the published look is no draft at all */
  p = await call('PATCH', `/api/admin/galleries/${id}`, { designDraft: { gap: 2, radius: 9 } });
  assert.equal(p.body.designPending, false);
  /* a change, then thrown away */
  p = await call('PATCH', `/api/admin/galleries/${id}`, { designDraft: { radius: 20 } });
  assert.equal(p.body.designPending, true);
  assert.match(await previewCss(), /--radius:20px/); assert.match(await clientCss(), /--radius:9px/);
  p = await call('POST', `/api/admin/galleries/${id}/design/discard`);
  assert.equal(p.body.designPending, false); assert.deepEqual(p.body.design, { radius: 9, gap: 2 });
  assert.match(await previewCss(), /--radius:9px/, 'the preview is back on the published look');

  /* clearing everything is a draft too, until it is published */
  p = await call('PATCH', `/api/admin/galleries/${id}`, { designDraft: {} });
  assert.equal(p.body.designPending, true); assert.deepEqual(p.body.designDraft, {});
  assert.match(await clientCss(), /--radius:9px/);
  p = await call('POST', `/api/admin/galleries/${id}/design/publish`);
  assert.equal(p.body.design, null); assert.equal(await clientCss(), undefined);

  assert.equal((await call('PATCH', `/api/admin/galleries/${id}`, { designDraft: { radius: 999 } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/galleries/${id}`, { designDraft: { colour: 'red' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/galleries/99999/design/publish')).status, 404);
  assert.equal((await fetch(B + `/api/admin/galleries/${id}/design/publish`, { method: 'POST' })).status, 401);
});

test('saving a new default keeps work in progress looking the same too', async () => {
  const r = await call('POST', '/api/admin/galleries', { slug: 'draft-pin', title: 'Pin', albumId: '00000000-0000-4000-8000-0000000000a1' });
  const id = r.body.id;
  await call('PUT', '/api/admin/design', { design: DEFAULT_DESIGN });
  await call('PATCH', `/api/admin/galleries/${id}`, { designDraft: { radius: 12 } });
  const draftLook = async () => JSON.parse((await call('GET', `/api/admin/design/export?gallery=${id}`)).text).design;
  const before = await draftLook();
  await call('PUT', '/api/admin/design', { design: { ...DEFAULT_DESIGN, theme: 'dark', gap: 5 } });
  assert.deepEqual(await draftLook(), before, 'the draft is unchanged');
  const g = (await call('GET', `/api/admin/galleries/${id}`)).body;
  assert.equal(g.designPending, true, 'and it is still waiting to be published');
  await call('PUT', '/api/admin/design', { design: DEFAULT_DESIGN });
});
