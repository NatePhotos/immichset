/* The website's editable state - settings, galleries, photos, publish history and open
   alerts - in the gallery app's own database, so the nightly backup covers it. */

import { cleanPages } from './pages.mjs';

export const FONTS = ['Roboto', 'Figtree', 'Montserrat', 'Inter', 'Lato', 'Lora',
                      'Playfair Display', 'Cormorant Garamond', 'EB Garamond', 'Josefin Sans'];
export const DEFAULT_STYLE = {
  page: '#f4f5f0', band: '#e3e8df', text: '#373737', ink: '#343b2f',
  headingFont: 'Roboto', bodyFont: 'Figtree', textSize: 'normal', logo: null,
  colsDesktop: 4, colsPhone: 2, gap: 'tight', cardShape: 'tall',
};
export const DEFAULTS = {
  siteName: '',
  style: DEFAULT_STYLE,
  about: { heading: 'About', text: '', photoId: null },
  contact: { heading: 'Contact us', bannerPhotoId: null, email: '', phone: '' },
  footer: { copyright: '', instagram: '' },
};
const KEEP = 10;
/* these paths belong to the site itself, so a gallery may not take them */
const RESERVED = new Set(['about', 'contact', 'img', 'index.html', '404.html', 'style.css', 'site.js', 'logo.png', 'logo.svg', '_headers']);

export class StaleError extends Error { constructor() { super('stale'); } }
export class InputError extends Error {}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS site_galleries (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
  show_title INTEGER NOT NULL DEFAULT 1, hidden INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL, cover_photo_id INTEGER, immich_album_id TEXT);
CREATE TABLE IF NOT EXISTS site_photos (
  id INTEGER PRIMARY KEY, gallery_id INTEGER, position INTEGER NOT NULL,
  file_key TEXT UNIQUE NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
  original_name TEXT NOT NULL DEFAULT '', immich_asset_id TEXT,
  immich_status TEXT NOT NULL DEFAULT 'pending', immich_tries INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS site_publishes (
  id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL, deployment_id TEXT, rev INTEGER NOT NULL,
  status TEXT NOT NULL, error TEXT, snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS site_alerts (kind TEXT PRIMARY KEY, opened_at INTEGER NOT NULL, last_sent_at INTEGER NOT NULL);
`;

const text = (v, max) => String(v ?? '').trim().slice(0, max);
const idOrNull = v => (Number.isInteger(v) && v > 0 ? v : null);
function int(v, lo, hi, dflt) { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt; }
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);

function cleanStyle(s) {
  const d = DEFAULT_STYLE, o = { ...d, ...s };
  for (const k of ['page', 'band', 'text', 'ink']) if (!/^#[0-9a-f]{6}$/i.test(String(o[k]))) o[k] = d[k];
  o.headingFont = oneOf(o.headingFont, FONTS, d.headingFont);
  o.bodyFont = oneOf(o.bodyFont, FONTS, d.bodyFont);
  o.textSize = oneOf(o.textSize, ['smaller', 'normal', 'larger'], d.textSize);
  o.colsDesktop = int(o.colsDesktop, 2, 5, d.colsDesktop);
  o.colsPhone = int(o.colsPhone, 1, 2, d.colsPhone);
  o.gap = oneOf(o.gap, ['none', 'tight', 'normal', 'roomy'], d.gap);
  o.cardShape = oneOf(o.cardShape, ['tall', 'square', 'wide'], d.cardShape);
  if (o.logo !== null && !/^logo\.(png|svg)$/.test(String(o.logo))) o.logo = null;
  return o;
}
const CLEAN = {
  siteName: v => text(v, 80),
  style: cleanStyle,
  about: v => ({ heading: text(v.heading, 120), text: text(v.text, 5000), photoId: idOrNull(v.photoId) }),
  contact: v => ({ heading: text(v.heading, 120), bannerPhotoId: idOrNull(v.bannerPhotoId),
                   email: text(v.email, 200), phone: text(v.phone, 60) }),
  footer: v => ({ copyright: text(v.copyright, 200),
                  instagram: /^https:\/\/[^\s"'<>]+$/.test(text(v.instagram, 300)) ? text(v.instagram, 300) : '' }),
};

const galDto = r => r && ({ id: r.id, slug: r.slug, title: r.title, showTitle: !!r.show_title, hidden: !!r.hidden,
  position: r.position, coverPhotoId: r.cover_photo_id ?? null, immichAlbumId: r.immich_album_id ?? null });
const phoDto = r => r && ({ id: r.id, galleryId: r.gallery_id ?? null, position: r.position, fileKey: r.file_key,
  width: r.width, height: r.height, originalName: r.original_name, immichStatus: r.immich_status, immichTries: r.immich_tries, createdAt: r.created_at });

export function createStore(db, { now = Date.now } = {}) {
  db.exec(SCHEMA);
  const q = {
    setGet: db.prepare('SELECT value FROM site_settings WHERE key = ?'),
    setPut: db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    setDel: db.prepare('DELETE FROM site_settings WHERE key = ?'),
    galAll: db.prepare('SELECT * FROM site_galleries ORDER BY position, id'),
    galGet: db.prepare('SELECT * FROM site_galleries WHERE id = ?'),
    galSlug: db.prepare('SELECT id FROM site_galleries WHERE slug = ? COLLATE NOCASE'),
    galMax: db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM site_galleries'),
    galIns: db.prepare('INSERT INTO site_galleries (id, slug, title, position) VALUES (?, ?, ?, ?)'),
    galUpd: db.prepare('UPDATE site_galleries SET title = ?, show_title = ?, hidden = ?, cover_photo_id = ? WHERE id = ?'),
    galAlbum: db.prepare('UPDATE site_galleries SET immich_album_id = ? WHERE id = ?'),
    galPos: db.prepare('UPDATE site_galleries SET position = ? WHERE id = ?'),
    galDel: db.prepare('DELETE FROM site_galleries WHERE id = ?'),
    galCoverClear: db.prepare('UPDATE site_galleries SET cover_photo_id = NULL WHERE cover_photo_id = ?'),
    galRestore: db.prepare('INSERT INTO site_galleries (id, slug, title, show_title, hidden, position, cover_photo_id, immich_album_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    phoAll: db.prepare('SELECT * FROM site_photos ORDER BY position, id'),
    phoGet: db.prepare('SELECT * FROM site_photos WHERE id = ?'),
    phoMax: db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM site_photos WHERE gallery_id IS ?'),
    phoIns: db.prepare('INSERT INTO site_photos (id, gallery_id, position, file_key, width, height, original_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    galMaxId: db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM site_galleries'),
    phoMaxId: db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM site_photos'),
    phoPos: db.prepare('UPDATE site_photos SET position = ? WHERE id = ?'),
    phoDel: db.prepare('DELETE FROM site_photos WHERE id = ?'),
    phoDelGal: db.prepare('DELETE FROM site_photos WHERE gallery_id = ?'),
    phoImm: db.prepare('UPDATE site_photos SET immich_status = ?, immich_asset_id = COALESCE(?, immich_asset_id), immich_tries = immich_tries + ? WHERE id = ?'),
    phoPending: db.prepare("SELECT * FROM site_photos WHERE immich_status = 'pending' ORDER BY id"),
    phoRestore: db.prepare('INSERT INTO site_photos (id, gallery_id, position, file_key, width, height, original_name, immich_asset_id, immich_status, immich_tries, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    pubIns: db.prepare('INSERT INTO site_publishes (created_at, deployment_id, rev, status, error, snapshot) VALUES (?, ?, ?, ?, ?, ?)'),
    pubList: db.prepare('SELECT id, created_at, deployment_id, rev, status, error FROM site_publishes ORDER BY id DESC'),
    pubGet: db.prepare('SELECT * FROM site_publishes WHERE id = ?'),
    pubSnaps: db.prepare("SELECT snapshot FROM site_publishes WHERE status = 'ok'"),
    pubPruneOk: db.prepare("DELETE FROM site_publishes WHERE status = 'ok' AND id NOT IN (SELECT id FROM site_publishes WHERE status = 'ok' ORDER BY id DESC LIMIT ?)"),
    pubPruneFail: db.prepare("DELETE FROM site_publishes WHERE status != 'ok' AND id NOT IN (SELECT id FROM site_publishes ORDER BY id DESC LIMIT ?)"),
    pubClear: db.prepare('DELETE FROM site_publishes'),
    alGet: db.prepare('SELECT * FROM site_alerts WHERE kind = ?'),
    alOpen: db.prepare('INSERT OR REPLACE INTO site_alerts (kind, opened_at, last_sent_at) VALUES (?, ?, ?)'),
    alSent: db.prepare('UPDATE site_alerts SET last_sent_at = ? WHERE kind = ?'),
    alDel: db.prepare('DELETE FROM site_alerts WHERE kind = ?'),
  };

  const meta = key => q.setGet.get(key)?.value ?? null;
  const setMeta = (key, value) => (value == null ? q.setDel.run(key) : q.setPut.run(key, String(value)));
  const rev = () => Number(meta('_rev') || 0);
  /* The pages are the editor's draft: the public site only changes when they are published. They have their own
     revision so an editor's autosave is refused only when the pages changed elsewhere, not on every photo upload. */
  const pagesRev = () => Number(meta('_pagesRev') || 0);
  function getPages() { const raw = meta('s:pages'); return raw == null ? null : JSON.parse(raw); }
  function setPages(pages) { setMeta('s:pages', pages == null ? null : JSON.stringify(pages)); setMeta('_pagesRev', pagesRev() + 1); }

  /* Row ids are never reused: saved pages keep pointing at photos and galleries by id after they are deleted, so a
     new row must not inherit a dead one's id. The high-water marks live beside the other meta values. */
  const SEQ = { photo: ['_photoSeq', q.phoMaxId], gallery: ['_gallerySeq', q.galMaxId] };
  function raiseSeq(kind) {
    const [key, max] = SEQ[kind];
    const v = Math.max(Number(meta(key) || 0), max.get().m);
    if (v !== Number(meta(key) || 0)) setMeta(key, v);
    return v;
  }
  function nextId(kind) { const id = raiseSeq(kind) + 1; setMeta(SEQ[kind][0], id); return id; }

  function tx(fn) {
    db.exec('BEGIN');
    try { const out = fn(); db.exec('COMMIT'); return out; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  /* every change to what the site shows goes through here */
  function mutate(expected, fn) {
    if (expected != null && expected !== rev()) throw new StaleError();
    return tx(() => { const out = fn(); setMeta('_rev', rev() + 1); return out; });
  }

  function getSettings() {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) {
      const raw = meta(`s:${k}`);
      const v = raw == null ? DEFAULTS[k] : JSON.parse(raw);
      out[k] = typeof DEFAULTS[k] === 'object' ? { ...DEFAULTS[k], ...v } : v;
    }
    return out;
  }
  function putSettings(all) {
    for (const k of Object.keys(DEFAULTS)) setMeta(`s:${k}`, JSON.stringify(all[k]));
  }
  function clearPhotoRefs(id) {
    q.galCoverClear.run(id);
    const s = getSettings();
    if (s.about.photoId === id) s.about.photoId = null;
    if (s.contact.bannerPhotoId === id) s.contact.bannerPhotoId = null;
    putSettings(s);
  }
  function slugFor(title) {
    const base = title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'gallery';
    const pageSlugs = new Set((getPages() || []).filter(p => p.galleryId == null).map(p => p.slug.toLowerCase()));
    for (let n = 1; ; n++) {
      const s = n === 1 ? base : `${base}-${n}`;
      if (!RESERVED.has(s.toLowerCase()) && !pageSlugs.has(s.toLowerCase()) && !q.galSlug.get(s)) return s;
    }
  }
  const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const snapshot = () => JSON.stringify({ settings: getSettings(), galleries: q.galAll.all(), photos: q.phoAll.all(), pages: getPages() });

  return {
    rev, meta, setMeta, getSettings, pagesRev, getPages,
    gallery: id => galDto(q.galGet.get(id)),
    photo: id => phoDto(q.phoGet.get(id)),

    getState() {
      const photos = q.phoAll.all().map(phoDto);
      return {
        rev: rev(),
        settings: getSettings(),
        galleries: q.galAll.all().map(r => ({ ...galDto(r), photos: photos.filter(p => p.galleryId === r.id) })),
        pagePhotos: photos.filter(p => p.galleryId == null),
        pages: getPages(),
      };
    },

    patchSettings(expected, patch) {
      return mutate(expected, () => {
        const s = getSettings();
        for (const k of Object.keys(CLEAN)) {
          if (!(k in patch)) continue;
          const merged = typeof DEFAULTS[k] === 'object' ? { ...s[k], ...patch[k] } : patch[k];
          s[k] = CLEAN[k](merged);
        }
        for (const id of [s.about.photoId, s.contact.bannerPhotoId]) {
          if (id != null && !q.phoGet.get(id)) throw new InputError('That photo no longer exists');
        }
        putSettings(s);
      });
    },

    putPages(expectedPagesRev, raw) {
      if (expectedPagesRev != null && expectedPagesRev !== pagesRev()) throw new StaleError();
      const galleries = q.galAll.all().map(galDto);
      const photoIds = new Set(q.phoAll.all().map(p => p.id));
      const { pages, errors } = cleanPages(raw, { galleries, photoIds });
      if (!pages) { const e = new InputError(errors[0]); e.errors = errors; throw e; }
      mutate(null, () => setPages(pages));
      return { pagesRev: pagesRev() };
    },
    /* back to the pages of a published version; with none, back to the pages made from the settings */
    discardPages(snapshotJson) {
      const snap = snapshotJson ? JSON.parse(snapshotJson) : {};
      /* the snapshot was made against galleries and photos that may have changed since: check it like a save. When it
         cannot be made valid (say a gallery now owns a published page's address) refuse and leave the draft alone,
         rather than quietly swap the published pages for the ones made from the settings */
      let pages = snap.pages ?? null;
      if (pages != null) {
        const galleries = q.galAll.all().map(galDto);
        const photoIds = new Set(q.phoAll.all().map(p => p.id));
        const r = cleanPages(pages, { galleries, photoIds });
        if (!r.pages) {
          const e = new InputError(`The published pages can't be restored as they are: ${r.errors[0]}. Fix the clash and try again.`);
          e.errors = r.errors; throw e;
        }
        pages = r.pages;
      }
      mutate(null, () => setPages(pages));
      return { pagesRev: pagesRev() };
    },

    addGallery(expected, title) {
      const t = text(title, 120);
      if (!t) throw new InputError('Give the gallery a name');
      return mutate(expected, () => {
        const id = nextId('gallery');
        q.galIns.run(id, slugFor(t), t, q.galMax.get().m + 1);
        return galDto(q.galGet.get(id));
      });
    },
    updateGallery(expected, id, patch) {
      return mutate(expected, () => {
        const g = q.galGet.get(id);
        if (!g) throw new InputError('No such gallery');
        const title = 'title' in patch ? text(patch.title, 120) || g.title : g.title;
        const show = 'showTitle' in patch ? (patch.showTitle ? 1 : 0) : g.show_title;
        const hidden = 'hidden' in patch ? (patch.hidden ? 1 : 0) : g.hidden;
        let cover = 'coverPhotoId' in patch ? idOrNull(patch.coverPhotoId) : g.cover_photo_id;
        if (cover != null && q.phoGet.get(cover)?.gallery_id !== id) throw new InputError('That photo is not in this gallery');
        q.galUpd.run(title, show, hidden, cover, id);
        return galDto(q.galGet.get(id));
      });
    },
    deleteGallery(expected, id) {
      return mutate(expected, () => {
        raiseSeq('photo'); raiseSeq('gallery');
        for (const p of q.phoAll.all()) if (p.gallery_id === id) clearPhotoRefs(p.id);
        q.phoDelGal.run(id);
        q.galDel.run(id);
      });
    },
    reorderGalleries(expected, ids) {
      return mutate(expected, () => {
        const have = q.galAll.all().map(g => g.id);
        if (!sameSet(have, ids)) throw new InputError('The gallery list changed - reload and try again');
        ids.forEach((id, i) => q.galPos.run(i, id));
      });
    },
    setImmichAlbum: (galleryId, albumId) => q.galAlbum.run(albumId, galleryId),

    addPhoto(expected, galleryId, { fileKey, width, height, originalName }) {
      return mutate(expected, () => {
        if (galleryId != null && !q.galGet.get(galleryId)) throw new InputError('No such gallery');
        const id = nextId('photo');
        q.phoIns.run(id, galleryId, q.phoMax.get(galleryId).m + 1, fileKey, width, height,
                               text(originalName, 200), now());
        return phoDto(q.phoGet.get(id));
      });
    },
    removePhoto(expected, id) {
      return mutate(expected, () => { raiseSeq('photo'); clearPhotoRefs(id); q.phoDel.run(id); });
    },
    reorderPhotos(expected, galleryId, ids) {
      return mutate(expected, () => {
        const have = q.phoAll.all().filter(p => p.gallery_id === galleryId).map(p => p.id);
        if (!sameSet(have, ids)) throw new InputError('The photos changed - reload and try again');
        ids.forEach((id, i) => q.phoPos.run(i, id));
      });
    },
    setPhotoImmich: (id, status, assetId, triesAdd = 0) => q.phoImm.run(status, assetId ?? null, triesAdd, id),
    pendingImmich: () => q.phoPending.all().map(phoDto),

    snapshot,
    restoreSnapshot(json) {
      const snap = JSON.parse(json);
      return mutate(null, () => {
        /* Immich state is a fact about the outside world, not part of an old version: keep today's */
        const nowPhotos = new Map(q.phoAll.all().map(p => [p.id, p]));
        const nowGalleries = new Map(q.galAll.all().map(g => [g.id, g]));
        raiseSeq('photo'); raiseSeq('gallery'); /* remember today's highest ids before the rows go */
        db.exec('DELETE FROM site_photos; DELETE FROM site_galleries;');
        for (const g of snap.galleries) {
          const cur = nowGalleries.get(g.id);
          q.galRestore.run(g.id, g.slug, g.title, g.show_title, g.hidden, g.position, g.cover_photo_id, g.immich_album_id ?? (cur ? cur.immich_album_id : null));
        }
        for (const p of snap.photos) {
          const cur = nowPhotos.get(p.id);
          const imm = cur || p;
          q.phoRestore.run(p.id, p.gallery_id, p.position, p.file_key, p.width, p.height,
            p.original_name, imm.immich_asset_id, imm.immich_status, imm.immich_tries, p.created_at);
        }
        raiseSeq('photo'); raiseSeq('gallery');
        putSettings(snap.settings);
        /* versions published before pages existed have no "pages": they go back to pages made from their settings */
        setPages(Object.hasOwn(snap, 'pages') ? snap.pages : null);
      });
    },
    referencedFileKeys() {
      const keys = new Set(q.phoAll.all().map(p => p.file_key));
      for (const { snapshot } of q.pubSnaps.all()) for (const p of JSON.parse(snapshot).photos) keys.add(p.file_key);
      return keys;
    },

    recordPublish({ status, deploymentId = null, error = null, rev: r, snapshot: snap }) {
      const res = q.pubIns.run(now(), deploymentId, r, status, error, snap ?? snapshot());
      q.pubPruneOk.run(KEEP);
      q.pubPruneFail.run(KEEP);
      return Number(res.lastInsertRowid);
    },
    listPublishes: () => q.pubList.all().map(p => ({ id: p.id, createdAt: p.created_at, deploymentId: p.deployment_id,
                                                      rev: p.rev, status: p.status, error: p.error })),
    getPublish: id => { const p = q.pubGet.get(id); return p && { id: p.id, deploymentId: p.deployment_id, status: p.status, rev: p.rev, snapshot: p.snapshot }; },
    clearPublishes: () => q.pubClear.run(),

    alertGet: kind => q.alGet.get(kind) ?? null,
    alertOpen: (kind, t) => q.alOpen.run(kind, t, t),
    alertSent: (kind, t) => q.alSent.run(t, kind),
    alertClose: kind => q.alDel.run(kind),
  };
}
