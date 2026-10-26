import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { overview } from '../overview.mjs';

const DAY = 86400_000, HOUR = 3600_000;
const NOW = Date.parse('2026-10-24T12:00:00Z');
const sql = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const iso = ms => new Date(ms).toISOString();

function mk() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
CREATE TABLE galleries (
  id              INTEGER PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  subtitle        TEXT,
  album_id        TEXT NOT NULL,
  cover_asset_id  TEXT,
  cover_file      TEXT,
  cover_focus     TEXT,
  sort_order      TEXT,
  require_email   INTEGER NOT NULL DEFAULT 0,
  password_hash   TEXT,
  password_salt   TEXT,
  allow_download  INTEGER NOT NULL DEFAULT 1,
  expires_at      TEXT,
  published_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE registrations (
  id          INTEGER PRIMARY KEY,
  gallery_id  INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (gallery_id, email)
);
CREATE TABLE favourites (
  id              INTEGER PRIMARY KEY,
  gallery_id      INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  asset_id        TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (registration_id, asset_id)
);
CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  gallery_id  INTEGER REFERENCES galleries(id) ON DELETE CASCADE,
  reg_id      INTEGER REFERENCES registrations(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,
  asset_id    TEXT,
  ip          TEXT,
  ua          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);`);
  const gal = (id, title, o = {}) => db.prepare(
    'INSERT INTO galleries (id,slug,title,album_id,cover_asset_id,cover_file,expires_at,published_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, 's' + id, title, 'a' + id, o.coverAsset ?? null, o.coverFile ?? null, o.expires ?? null,
         o.published === false ? null : iso(NOW - 30 * DAY), sql(o.created ?? NOW - id * DAY));
  const reg = (id, g, email, name, ago) =>
    db.prepare('INSERT INTO registrations (id,gallery_id,email,name,created_at) VALUES (?,?,?,?,?)').run(id, g, email, name, sql(NOW - ago));
  const ev = (g, r, type, ago) =>
    db.prepare('INSERT INTO events (gallery_id,reg_id,type,created_at) VALUES (?,?,?,?)').run(g, r, type, sql(NOW - ago));
  const fav = (g, r, asset, ago) =>
    db.prepare('INSERT INTO favourites (gallery_id,registration_id,asset_id,created_at) VALUES (?,?,?,?)').run(g, r, asset, sql(NOW - ago));
  return { db, gal, reg, ev, fav };
}

test('stats count views, downloads and sign-ups in the right weeks', () => {
  const { db, gal, reg, ev } = mk();
  gal(1, 'Autumn Wedding');
  gal(2, 'Draft Shoot', { published: false });
  gal(3, 'Old Shoot', { expires: iso(NOW - DAY) });
  reg(1, 1, 'someone@example.com', 'Sam', 2 * DAY);
  reg(2, 1, 'other@example.com', null, 9 * DAY);
  ev(1, 1, 'view', HOUR); ev(1, 1, 'view', 6 * DAY);
  ev(1, 1, 'view', 8 * DAY); ev(1, 1, 'view', 13 * DAY); ev(1, 1, 'view', 15 * DAY);
  ev(1, 1, 'download', DAY); ev(1, 1, 'download_all', 2 * DAY); ev(1, 1, 'download', 9 * DAY);
  ev(1, 1, 'landing', HOUR);
  const o = overview(db, { now: NOW });
  assert.deepEqual(o.stats, { liveGalleries: 1, viewsWeek: 2, viewsPrevWeek: 2, downloadsWeek: 2, signupsWeek: 1 });
});

test('expiring: published, not expired, within 7 days; counts registrations who have not downloaded', () => {
  const { db, gal, reg, ev } = mk();
  gal(1, 'Autumn Wedding', { expires: iso(NOW + 3 * DAY) });
  gal(2, 'Far Off', { expires: iso(NOW + 20 * DAY) });
  gal(3, 'Gone', { expires: iso(NOW - DAY) });
  gal(4, 'Draft', { expires: iso(NOW + 2 * DAY), published: false });
  reg(1, 1, 'a@example.com', 'A', DAY); reg(2, 1, 'b@example.com', 'B', DAY); reg(3, 1, 'c@example.com', 'C', DAY);
  ev(1, 1, 'download', HOUR); ev(1, 2, 'download_all', HOUR);
  const rows = overview(db, { now: NOW }).attention.filter(a => a.kind === 'expiring');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].galleryId, 1);
  assert.match(rows[0].title, /Autumn Wedding/);
  assert.match(rows[0].detail, /1 of 3/);
  assert.ok(rows[0].action);
});

test('favourites group by gallery, naming one person when it is one', () => {
  const { db, gal, reg, fav } = mk();
  gal(1, 'Autumn Wedding'); gal(2, 'Studio');
  reg(1, 1, 'someone@example.com', 'Sam', DAY); reg(2, 1, 'x@example.com', null, DAY); reg(3, 2, 'solo@example.com', null, DAY);
  fav(1, 1, 'p1', DAY); fav(1, 2, 'p2', DAY);
  fav(2, 3, 'p3', DAY); fav(2, 3, 'p4', 2 * DAY);
  fav(1, 1, 'p9', 8 * DAY);                     /* too old */
  const rows = overview(db, { now: NOW }).attention.filter(a => a.kind === 'favourites');
  const by = Object.fromEntries(rows.map(r => [r.galleryId, r]));
  assert.equal(rows.length, 2);
  assert.match(by[1].detail, /2 favourites$/);
  assert.match(by[2].detail, /2 favourites from solo@example\.com/);
  const { db: d2, gal: g2, reg: r2, fav: f2 } = mk();
  g2(1, 'Autumn Wedding'); r2(1, 1, 'someone@example.com', 'Sam', DAY); f2(1, 1, 'p1', DAY);
  assert.match(overview(d2, { now: NOW }).attention[0].detail, /1 favourite from Sam/);
});

test('website and immich rows appear only when the site says so', () => {
  const { db } = mk();
  const kinds = site => overview(db, { now: NOW, site }).attention.map(a => a.kind);
  assert.deepEqual(kinds(null), []);
  assert.deepEqual(kinds({ dirty: false, pendingImmich: 0 }), []);
  assert.deepEqual(kinds({ dirty: true, pendingImmich: 0 }), ['website']);
  assert.deepEqual(kinds({ dirty: true, pendingImmich: 2 }), ['website', 'immich']);
});

test('activity is newest first, at most 8, with gallery title and email', () => {
  const { db, gal, reg, ev } = mk();
  gal(1, 'Autumn Wedding');
  reg(1, 1, 'someone@example.com', 'Sam', DAY);
  for (let i = 0; i < 10; i++) ev(1, 1, 'download', (i + 1) * HOUR);
  ev(1, null, 'register', 30 * 60_000);
  ev(1, 1, 'landing', 1000);
  const a = overview(db, { now: NOW }).activity;
  assert.equal(a.length, 8);
  assert.equal(a[0].type, 'register');
  assert.equal(a[1].email, 'someone@example.com');
  assert.equal(a[1].galleryTitle, 'Autumn Wedding');
  assert.equal(a[1].galleryId, 1);
  assert.ok(a[1].at > a[2].at);
});

test('recent: newest four galleries with status, cover and total views', () => {
  const { db, gal, ev } = mk();
  gal(1, 'One', { created: NOW - 1 * DAY, coverAsset: 'asset-1' });
  gal(2, 'Two', { created: NOW - 2 * DAY, coverFile: 'c.jpg' });
  gal(3, 'Three', { created: NOW - 3 * DAY, published: false });
  gal(4, 'Four', { created: NOW - 4 * DAY, expires: iso(NOW - DAY) });
  gal(5, 'Five', { created: NOW - 5 * DAY });
  ev(1, null, 'view', 40 * DAY); ev(1, null, 'view', HOUR);
  const r = overview(db, { now: NOW }).recent;
  assert.deepEqual(r.map(x => x.title), ['One', 'Two', 'Three', 'Four']);
  assert.deepEqual(r.map(x => x.status), ['live', 'live', 'draft', 'expired']);
  assert.equal(r[0].views, 2); assert.equal(r[0].coverAssetId, 'asset-1'); assert.equal(r[1].coverFile, 'c.jpg');
  assert.equal(r[0].slug, 's1'); assert.equal(r[3].expiresAt, iso(NOW - DAY));
});

test('health: site from the last check, nas from backup age, email from mailReady', () => {
  const { db } = mk();
  let h = overview(db, { now: NOW }).health;
  assert.equal(h.site.ok, null); assert.equal(h.nas.ok, false); assert.equal(h.email.ok, false);
  h = overview(db, { now: NOW, mailReady: true, site: { dirty: false, pendingImmich: 0, check: { ok: true, at: NOW, why: 'HTTP 200' } },
    backups: [{ file: 'x', at: iso(NOW - 10 * HOUR) }] }).health;
  assert.equal(h.site.ok, true); assert.equal(h.nas.ok, true); assert.equal(h.email.ok, true);
  h = overview(db, { now: NOW, site: { check: { ok: false, at: NOW, why: 'timeout' } }, backups: [{ file: 'x', at: iso(NOW - 40 * HOUR) }] }).health;
  assert.equal(h.site.ok, false); assert.match(h.site.detail, /timeout/); assert.equal(h.nas.ok, false);
});

test('the server\'s own checks are added to the health cards', () => {
  const o = overview(mk().db, { now: NOW, extraHealth: { immich: { ok: false, detail: 'Cannot reach Immich' } } });
  assert.deepEqual(o.health.immich, { ok: false, detail: 'Cannot reach Immich' });
  assert.ok(o.health.site && o.health.nas && o.health.email);
});

test('the portfolio-website notices vanish until the website is set up', () => {
  const { db } = mk();
  const site = { dirty: true, pendingImmich: 2, check: null };
  const on = overview(db, { now: NOW, site });                                   /* default: configured, as on the live install */
  assert.ok(on.attention.some(a => a.kind === 'website') && on.health.site);
  const off = overview(db, { now: NOW, site, siteConfigured: false });
  assert.ok(!off.attention.some(a => a.kind === 'website' || a.kind === 'immich'));
  assert.equal(off.health.site, undefined); assert.ok(off.health.nas && off.health.email);
});

test('the getting-started list appears only after setup, until it is dismissed, and ticks itself', () => {
  const { db } = mk();
  assert.equal(overview(db, { now: NOW }).checklist, null, 'an install run from a compose file never sees it');
  assert.equal(overview(db, { now: NOW, getting: { setupDone: false } }).checklist, null);
  assert.equal(overview(db, { now: NOW, getting: { setupDone: true, dismissed: true } }).checklist, null);
  const fresh = overview(db, { now: NOW, publicUrl: 'http://192.168.1.20:3000', getting: { setupDone: true, dismissed: false, albums: 0, offsite: false } }).checklist;
  assert.deepEqual(fresh.items.map(i => i.id), ['photos', 'gallery', 'email', 'online', 'backup', 'offsite']);
  assert.equal(fresh.doneCount, 0);
  const { db: db2, gal } = mk();
  const more = overview(db2, { now: NOW, mailReady: true, publicUrl: 'https://g.example.com', backups: [{ at: new Date(NOW).toISOString() }],
    getting: { setupDone: true, dismissed: false, albums: 3, offsite: true } }).checklist;
  const byId = Object.fromEntries(more.items.map(i => [i.id, i.done]));
  assert.deepEqual([byId.photos, byId.email, byId.online, byId.backup, byId.offsite], [true, true, true, true, true]);
  assert.ok(more.items.every(i => i.doc && i.detail));
});
