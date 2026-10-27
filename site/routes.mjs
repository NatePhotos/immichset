/* The admin side of the website: API, preview, sending originals to Immich, publishing,
   backup and background jobs. server.mjs hands over its helpers and routes to this. */
import { mkdirSync, existsSync, readdirSync, unlinkSync, copyFileSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createStore, StaleError, InputError, FONTS, DEFAULT_STYLE } from './store.mjs';
import { build } from './build.mjs';
import { migratePages, resolvePages, cleanPages } from './pages.mjs';
import { listBlockTypes, STYLE_SCHEMA, MOTION_SCHEMA, STYLE_DEFAULTS, MOTION_DEFAULTS } from './blocks/registry.mjs';
import { createPublisher } from './publish.mjs';
import { createWatcher } from './watch.mjs';
import { pagesHash } from './blake3.mjs';

const ORIGINAL_OK = /\.(jpe?g|png|heic|heif|webp|tiff?|dng)$/i;
const IMG_NAME = /^([0-9a-f]{18})-(grid|full)\.jpg$/;
const LOGO_NAME = /^logo\.(png|svg)$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
                '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const isJpeg = b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = b => b.length > 8 && b.readUInt32BE(0) === 0x89504e47;
const SVG_BAD = [/<script/i, /foreignObject/i, /<use[\s>\/]/i, /xlink:/i, /href\s*=/i, /src\s*=/i, /style/i,
  /\bon\w+\s*=/i, /javascript:/i, /&#/, /<!ENTITY/i, /<!DOCTYPE/i, /<[a-z0-9_-]+:[a-z]/i];
const isSafeSvg = b => { const t = b.toString('utf8');
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(t) && !SVG_BAD.some(re => re.test(t)); };
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const FRESH_MS = 10 * 60_000;
const PAGES_MAX = 2 * 1024 * 1024;     /* a whole site's pages in one save; larger is refused before parsing finishes */

export function createSite({ db, cfg, json, readJson, adminOk, immich, canUpload, tellAdmin, fetch: f = globalThis.fetch }) {
  const dir = join(cfg.dataDir, 'site');
  for (const d of ['img', 'originals']) mkdirSync(join(dir, d), { recursive: true });
  const store = createStore(db);
  const publisher = createPublisher({ accountId: cfg.cfAccountId, token: cfg.cfPagesToken, project: cfg.cfPagesProject, fetch: f });

  /* versions belong to one Pages project; switching project (test -> live) starts a new history */
  if (cfg.cfPagesProject && store.meta('project') !== cfg.cfPagesProject) {
    store.clearPublishes();
    store.setMeta('publishedRev', null);
    store.setMeta('project', cfg.cfPagesProject);
  }

  /* ---- Immich ---- */
  const albumFlight = new Map();
  function ensureAlbum(photo) {
    const key = photo.galleryId == null ? 'pages' : photo.galleryId;
    if (!albumFlight.has(key)) albumFlight.set(key, makeAlbum(photo).finally(() => albumFlight.delete(key)));
    return albumFlight.get(key);
  }
  async function makeAlbum(photo) {
    const g = photo.galleryId == null ? null : store.gallery(photo.galleryId);
    let id = g ? g.immichAlbumId : store.meta('pagesAlbumId');
    if (id) return id;
    const r = await immich('/api/albums', { write: true, method: 'POST', signal: AbortSignal.timeout(120_000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ albumName: `Website – ${g ? g.title : 'Pages'}` }) });
    if (!r.ok) throw new Error(`Immich album ${r.status}`);
    id = (await r.json()).id;
    if (g) store.setImmichAlbum(g.id, id); else store.setMeta('pagesAlbumId', id);
    return id;
  }
  const sendFlight = new Map();      /* one send per photo, however many callers ask */
  function sendToImmich(photo) {
    if (!sendFlight.has(photo.id)) sendFlight.set(photo.id, doSend(photo).finally(() => sendFlight.delete(photo.id)));
    return sendFlight.get(photo.id);
  }
  async function doSend(photo) {
    const cur = store.photo(photo.id);
    if (!cur) return null;
    if (cur.immichStatus === 'ok') return null;       /* already there: nothing to do */
    if (!canUpload()) throw new Error('no Immich write key');
    const file = readdirSync(join(dir, 'originals')).find(n => n.startsWith(photo.fileKey + '.'));
    if (!file) throw new Error('original file missing');
    const buf = await readFile(join(dir, 'originals', file));
    const when = new Date(photo.createdAt).toISOString();
    const form = new FormData();
    form.append('fileCreatedAt', when);
    form.append('fileModifiedAt', when);
    form.append('filename', photo.originalName || file);
    form.append('assetData', new Blob([buf]), photo.originalName || file);
    const r = await immich('/api/assets', { write: true, method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`Immich upload ${r.status}`);
    const asset = await r.json();
    const album = await ensureAlbum(photo);
    const r2 = await immich(`/api/albums/${album}/assets`, { write: true, method: 'PUT', signal: AbortSignal.timeout(120_000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [asset.id] }) });
    if (!r2.ok) throw new Error(`Immich album add ${r2.status}`);
    unlinkSync(join(dir, 'originals', file));
    return asset.id;
  }
  const watcher = createWatcher({ store, tellAdmin, sendToImmich, siteUrl: cfg.siteUrl, fetch: f });

  /* ---- publish ---- */
  const hashCache = new Map();          /* image files never change under the same name */
  const hashOf = (buf, path) => {
    if (!path.startsWith('img/')) return pagesHash(buf, path);
    if (!hashCache.has(path)) hashCache.set(path, pagesHash(buf, path));
    return hashCache.get(path);
  };
  const fresh = f => { try { return Date.now() - statSync(f).mtimeMs < FRESH_MS; } catch { return true; } };
  function prune() {
    const keep = store.referencedFileKeys();
    for (const n of readdirSync(join(dir, 'img'))) {
      const m = IMG_NAME.exec(n);
      if (m && !keep.has(m[1]) && !fresh(join(dir, 'img', n))) { try { unlinkSync(join(dir, 'img', n)); hashCache.delete(`img/${n}`); } catch {} }
    }
    const waiting = new Set([...store.getState().pagePhotos, ...store.getState().galleries.flatMap(g => g.photos)]
      .filter(p => p.immichStatus !== 'ok').map(p => p.fileKey));
    for (const n of readdirSync(join(dir, 'originals'))) {
      if (!waiting.has(n.split('.')[0]) && !fresh(join(dir, 'originals', n))) { try { unlinkSync(join(dir, 'originals', n)); } catch {} }
    }
  }
  let busy = null;                       /* 'publish' | 'restore': never both at once */
  const notReady = 'Publishing is not set up yet: add CF_ACCOUNT_ID, CF_PAGES_TOKEN and CF_PAGES_PROJECT to galleryapp.';
  async function publish() {
    if (!publisher.ready) throw new InputError(notReady);
    if (busy) throw new InputError(`A ${busy} is already running`);
    busy = 'publish';
    const rev = store.rev();
    const snap = store.snapshot();      /* what is being published, captured before any await */
    try {
      if (cfg.allowTestHooks && store.meta('_test_fail_deploy')) { store.setMeta('_test_fail_deploy', null); throw new Error('test failure'); }
      const { files, images } = build(store.getState(), { base: '/', siteUrl: cfg.siteUrl });
      const out = new Map();
      for (const [p, body] of files) out.set(p, Buffer.from(body));
      for (const [p, rel] of images) out.set(p, await readFile(join(dir, rel)));
      const d = await publisher.deploy(out, hashOf);
      store.recordPublish({ status: 'ok', deploymentId: d.id, rev, snapshot: snap });
      store.setMeta('publishedRev', rev);
      store.setMeta('liveDeploymentId', d.id);
      prune();
      await watcher.resolve('publish', 'Website publishing works again', ['Your last publish went through.']);
      return d;
    } catch (e) {
      if (e instanceof InputError) throw e;
      store.recordPublish({ status: 'failed', error: e.message, rev, snapshot: snap });
      await watcher.alert('publish', 'Your website did not publish', [
        `The publish failed: ${e.message}`,
        'Your live site is unchanged. Open the Website section of the admin panel and press Publish to try again.',
      ]);
      throw e;
    } finally { busy = null; }
  }
  async function restore(id) {
    if (!publisher.ready) throw new InputError(notReady);
    if (busy) throw new InputError(`A ${busy} is already running`);
    const row = store.getPublish(Number(id));
    if (!row || row.status !== 'ok') throw new InputError('That version cannot be restored');
    busy = 'restore';
    try {
      await publisher.rollback(row.deploymentId);
    } catch (e) {
      await watcher.alert('restore', 'Your website could not be restored', [
        `Going back to an earlier version failed: ${e.message}`, 'Your live site is unchanged.']);
      throw e;
    } finally { busy = null; }
    store.restoreSnapshot(row.snapshot);
    const logo = store.getState().settings.style.logo;
    if (logo && !existsSync(join(dir, logo))) store.patchSettings(null, { style: { logo: null } });
    store.setMeta('publishedRev', store.rev());
    store.setMeta('liveDeploymentId', row.deploymentId);
    await watcher.resolve('restore', 'Website restore works again', ['The last restore went through.']);
  }

  /* ---- pages ---- */
  const pagesOf = st => resolvePages(st.pages ?? migratePages(st.settings, st.galleries), st.galleries);
  const photoIdsOf = st => new Set([...st.pagePhotos, ...st.galleries.flatMap(g => g.photos)].map(p => p.id));
  /* the editor's live preview: the real build of pages that are not saved yet, as one self-contained page */
  function renderDraft(raw, slug) {
    const st = store.getState();
    const { pages, errors } = cleanPages(raw, { galleries: st.galleries, photoIds: photoIdsOf(st) });
    if (!pages) { const e = new InputError(errors[0]); e.errors = errors; throw e; }
    const { files } = build({ ...st, pages }, { base: '/admin/site-preview/', siteUrl: cfg.siteUrl, editor: true });
    return { html: files.get(slug ? `${slug}/index.html` : 'index.html') ?? files.get('404.html') };
  }
  /* back to the pages the live site shows (or, never published, the pages made from the settings) */
  function discardPages() {
    const ok = store.listPublishes().filter(p => p.status === 'ok');
    const live = ok.find(p => p.deploymentId === store.meta('liveDeploymentId')) || ok[0];
    store.discardPages(live ? store.getPublish(live.id).snapshot : null);
    return { pages: pagesOf(store.getState()), pagesRev: store.pagesRev() };
  }

  /* ---- helpers ---- */
  const revOf = req => (req.headers['x-site-rev'] == null ? null : Number(req.headers['x-site-rev']));
  const pagesRevOf = req => (req.headers['x-pages-rev'] == null ? null : Number(req.headers['x-pages-rev']));
  async function readBody(req, res, limit) {
    try { return await readJson(req, limit); }
    catch (e) {
      const big = /too large/.test(e.message);
      json(res, big ? 413 : 400, { error: big ? 'That is too much to save at once' : 'That request was not valid' });
      return null;
    }
  }
  async function respond(res, fn, okCode = 200) {
    try {
      const out = await fn();
      return json(res, okCode, { ...(out || {}), rev: store.rev() });
    } catch (e) {
      if (e instanceof StaleError) return json(res, 409, { error: 'stale' });
      if (e instanceof InputError) return json(res, 400, { error: e.message, ...(e.errors ? { errors: e.errors } : {}) });
      console.error('site:', e.message);
      return json(res, 502, { error: e.message });
    }
  }
  async function serveFile(res, rel, cache) {
    try {
      const body = await readFile(join(dir, rel));
      const h = { 'content-type': TYPES[extname(rel)] || 'application/octet-stream', 'cache-control': cache, 'x-content-type-options': 'nosniff' };
      if (extname(rel) === '.svg') h['content-security-policy'] = SVG_CSP;
      res.writeHead(200, h);
      res.end(body);
    } catch { json(res, 404, { error: 'not_found' }); }
  }

  /* ---- admin API ---- */
  async function admin(req, res, path, url) {
    const m = req.method;
    if (path === '/api/admin/site' && m === 'GET') {
      const st = store.getState();
      return json(res, 200, {
        state: st, rev: store.rev(), publishes: store.listPublishes(),
        dirty: store.rev() !== Number(store.meta('publishedRev') ?? -1),
        canPublish: publisher.ready,
        missing: publisher.ready ? null : 'Publishing is not set up yet: add CF_ACCOUNT_ID, CF_PAGES_TOKEN and CF_PAGES_PROJECT to galleryapp.',
        liveDeploymentId: store.meta('liveDeploymentId'),
        fonts: FONTS, defaults: DEFAULT_STYLE, liveUrl: cfg.siteUrl || null, publishing: busy === 'publish',
        pages: pagesOf(st), pagesRev: store.pagesRev(), pagesSaved: st.pages != null,
      });
    }
    if (path === '/api/admin/site/blocks' && m === 'GET') {
      return json(res, 200, { types: listBlockTypes(), style: STYLE_SCHEMA, motion: MOTION_SCHEMA,
                              styleDefaults: STYLE_DEFAULTS, motionDefaults: MOTION_DEFAULTS });
    }
    if (path === '/api/admin/site/pages' && m === 'PUT') {
      const b = await readBody(req, res, PAGES_MAX); if (!b) return;
      return respond(res, () => store.putPages(pagesRevOf(req), b.pages));
    }
    if (path === '/api/admin/site/pages/discard' && m === 'POST') return respond(res, () => discardPages());
    if (path === '/api/admin/site/render' && m === 'POST') {
      const b = await readBody(req, res, PAGES_MAX); if (!b) return;
      return respond(res, () => renderDraft(b.pages, String(b.slug ?? '')));
    }
    if (path === '/api/admin/site/settings' && m === 'PUT') {
      const b = await readJson(req, 256 * 1024);
      return respond(res, () => { store.patchSettings(revOf(req), b); });
    }
    if (path === '/api/admin/site/galleries' && m === 'POST') {
      const b = await readJson(req);
      return respond(res, () => ({ gallery: store.addGallery(revOf(req), b.title) }), 201);
    }
    if (path === '/api/admin/site/galleries/order' && m === 'PUT') {
      const b = await readJson(req);
      return respond(res, () => { store.reorderGalleries(revOf(req), (b.ids || []).map(Number)); });
    }
    const gm = path.match(/^\/api\/admin\/site\/galleries\/(\d+)$/);
    if (gm && m === 'PATCH') {
      const b = await readJson(req);
      return respond(res, () => ({ gallery: store.updateGallery(revOf(req), Number(gm[1]), b) }));
    }
    if (gm && m === 'DELETE') return respond(res, () => { store.deleteGallery(revOf(req), Number(gm[1])); });
    const om = path.match(/^\/api\/admin\/site\/galleries\/(\d+)\/photos\/order$/);
    if (om && m === 'PUT') {
      const b = await readJson(req);
      return respond(res, () => { store.reorderPhotos(revOf(req), Number(om[1]), (b.ids || []).map(Number)); });
    }

    if (path === '/api/admin/site/photos' && m === 'POST') {
      const gq = url.searchParams.get('gallery');
      const galleryId = gq === 'pages' ? null : Number(gq);
      if (galleryId !== null && !store.gallery(galleryId)) return json(res, 404, { error: 'No such gallery' });
      const cap = (cfg.uploadMaxMb + 40) * 1024 * 1024;
      if (Number(req.headers['content-length'] || 0) > cap) {
        json(res, 413, { error: `Photos must be under ${cfg.uploadMaxMb} MB` }, { connection: 'close' });
        req.destroy(); return;
      }
      const form = await new Request('http://local/', { method: 'POST', body: req, duplex: 'half',
        headers: { 'content-type': req.headers['content-type'] || '' } }).formData();
      const [o, g, fu] = ['original', 'grid', 'full'].map(k => form.get(k));
      if (![o, g, fu].every(x => x instanceof Blob)) return json(res, 400, { error: 'Missing files' });
      const name = String(o.name || 'photo.jpg').replace(/[\\/\u0000]/g, '_').slice(0, 200);
      if (!ORIGINAL_OK.test(name)) return json(res, 415, { error: 'Photos only — jpg, png, heic, webp, tiff or dng' });
      const [ob, gb, fb] = await Promise.all([o, g, fu].map(async x => Buffer.from(await x.arrayBuffer())));
      if (!isJpeg(gb) || !isJpeg(fb)) return json(res, 415, { error: 'The web copies must be JPEG' });
      const width = Number(form.get('width')), height = Number(form.get('height'));
      if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 20000)) return json(res, 400, { error: 'Bad photo size' });
      const key = randomBytes(9).toString('hex');
      await writeFile(join(dir, 'img', `${key}-grid.jpg`), gb);
      await writeFile(join(dir, 'img', `${key}-full.jpg`), fb);
      await writeFile(join(dir, 'originals', `${key}${extname(name).toLowerCase()}`), ob);
      const photo = store.addPhoto(null, galleryId, { fileKey: key, width, height, originalName: name });
      sendToImmich(photo).then(aid => { if (aid) store.setPhotoImmich(photo.id, 'ok', aid, 1); })
        .catch(e => { console.error('site immich:', e.message); try { store.setPhotoImmich(photo.id, 'pending', null, 1); } catch {} });
      return json(res, 201, { photo: store.photo(photo.id), rev: store.rev() });
    }
    const pm = path.match(/^\/api\/admin\/site\/photos\/(\d+)$/);
    if (pm && m === 'DELETE') return respond(res, () => { store.removePhoto(revOf(req), Number(pm[1])); });
    const rm = path.match(/^\/api\/admin\/site\/photos\/(\d+)\/retry$/);
    if (rm && m === 'POST') {
      return respond(res, async () => {
        const p = store.photo(Number(rm[1]));
        if (!p) throw new InputError('No such photo');
        if (p.immichStatus === 'ok') return { photo: p };
        let aid;
        try { aid = await sendToImmich(p); }
        catch (e) {
          const cur = store.photo(p.id);
          if (cur && cur.immichStatus !== 'ok') store.setPhotoImmich(p.id, p.immichStatus === 'failed' ? 'failed' : 'pending', null, 1);
          throw new InputError(`Immich: ${e.message}`);
        }
        if (aid) store.setPhotoImmich(p.id, 'ok', aid, 1);
        await watcher.resolve(`immich:${p.id}`, 'A website photo is in Immich now', [`${p.originalName || 'A photo'} has been saved to Immich.`]);
        return { photo: store.photo(p.id) };
      });
    }

    if (path === '/api/admin/site/logo' && m === 'POST') {
      const chunks = []; let got = 0;
      for await (const c of req) {
        got += c.length;
        if (got > 2 * 1024 * 1024) { json(res, 413, { error: 'Logos must be under 2 MB' }); req.destroy(); return; }
        chunks.push(c);
      }
      const buf = Buffer.concat(chunks);
      const svg = /\.svg$/i.test(url.searchParams.get('name') || '');
      if (buf.length > 2 * 1024 * 1024) return json(res, 413, { error: 'Logos must be under 2 MB' });
      if (svg ? !isSafeSvg(buf) : !isPng(buf)) return json(res, 415, { error: 'Logos must be PNG or a plain SVG' });
      const file = svg ? 'logo.svg' : 'logo.png';
      for (const n of ['logo.png', 'logo.svg']) if (existsSync(join(dir, n))) unlinkSync(join(dir, n));
      await writeFile(join(dir, file), buf);
      return respond(res, () => { store.patchSettings(null, { style: { logo: file } }); });
    }
    if (path === '/api/admin/site/logo' && m === 'DELETE') return respond(res, () => { store.patchSettings(null, { style: { logo: null } }); });

    const im = path.match(/^\/api\/admin\/site\/img\/([^/]+)$/);
    if (im && m === 'GET') {
      const n = im[1];
      if (IMG_NAME.test(n)) return serveFile(res, join('img', n), 'private, max-age=31536000, immutable');
      if (LOGO_NAME.test(n)) return serveFile(res, n, 'no-store');
      return json(res, 404, { error: 'not_found' });
    }

    if (path === '/api/admin/site/publish' && m === 'POST') return respond(res, () => publish());
    if (path === '/api/admin/site/restore' && m === 'POST') {
      const b = await readJson(req);
      return respond(res, () => restore(b.id));
    }
    return json(res, 404, { error: 'not_found' });
  }

  /* ---- preview: the real build, served from memory, only to a signed-in admin ---- */
  async function preview(req, res, path) {
    if (!adminOk(req)) { res.writeHead(302, { location: '/admin' }); return res.end(); }
    const base = '/admin/site-preview/';
    let rel;
    try { rel = decodeURIComponent(path.slice(base.length)); } catch { return json(res, 404, { error: 'not_found' }); }
    const im = /^img\/([^/]+)$/.exec(rel);
    if (im && IMG_NAME.test(im[1])) return serveFile(res, rel, 'private, max-age=300');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const { files, images } = build(store.getState(), { base, siteUrl: cfg.siteUrl });
    if (images.has(rel)) return serveFile(res, images.get(rel), 'private, max-age=300');
    const found = files.has(rel) && rel !== '_headers';
    const body = found ? files.get(rel) : files.get('404.html');
    res.writeHead(found ? 200 : 404, { 'content-type': TYPES[extname(found ? rel : '404.html')] || 'text/plain', 'cache-control': 'no-store' });
    res.end(body);
  }

  /* ---- backup: the web copies and logo, next to the database snapshots ---- */
  function backup(dst) {
    if (!dst) return null;
    try {
      const to = join(dst, 'site');
      mkdirSync(join(to, 'img'), { recursive: true });
      let copied = 0;
      for (const n of readdirSync(join(dir, 'img'))) {
        if (!existsSync(join(to, 'img', n))) { copyFileSync(join(dir, 'img', n), join(to, 'img', n)); copied++; }
      }
      for (const n of ['logo.png', 'logo.svg']) if (existsSync(join(dir, n))) copyFileSync(join(dir, n), join(to, n));
      return { copied, photos: Math.floor(readdirSync(join(to, 'img')).length / 2) };
    } catch (e) { console.error('site backup failed:', e.message); return null; }
  }

  function startJobs() {
    const run = (fn, label) => fn().catch(e => console.error(`site ${label}:`, e.message));
    setTimeout(() => run(watcher.immichTick, 'immich'), 60_000);
    setInterval(() => run(watcher.immichTick, 'immich'), 15 * 60_000);
    if (cfg.siteUrl) {
      setTimeout(() => run(watcher.siteTick, 'site check'), 60_000);
      setInterval(() => run(watcher.siteTick, 'site check'), 30 * 60_000);
    }
  }

  /* what the admin Home page needs to know about the website, cheaply */
  const summary = () => ({
    dirty: store.rev() !== Number(store.meta('publishedRev') ?? -1),
    pendingImmich: store.pendingImmich().length,
    check: watcher.lastCheck(),
  });

  return { admin, preview, backup, startJobs, store, summary };
}
