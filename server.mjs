/* Client gallery platform - Phase 1
   Node 24, no npm dependencies. Immich is the photo engine; this owns the
   client relationship: access gates, sessions and the activity log. */

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHmac, createHash, timingSafeEqual, scryptSync } from 'node:crypto';
import { readFile, writeFile, open as openFile } from 'node:fs/promises';
import { readdirSync, renameSync, unlinkSync, statSync, statfsSync, copyFileSync, createReadStream } from 'node:fs';
import { existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createSite } from './site/routes.mjs';
import { overview } from './admin/overview.mjs';
import { createZipWriter } from './zip/writer.mjs';
import { DownloadQueue } from './zip/queue.mjs';
import { createWatchdog } from './health/watchdog.mjs';
import { render, cleanDesign, IMAGE_FILE, scanVars, unsubToken, readUnsubToken, maskEmail, selectRecipients, planHash, classify, verifySvix, isReservedAddress } from './mail/blast.mjs';

const CFG = {
  port:       Number(process.env.PORT || 3000),
  immichUrl:  (process.env.IMMICH_URL || '').replace(/\/+$/, ''),
  immichKey:   process.env.IMMICH_API_KEY || '',
  immichWriteKey: process.env.IMMICH_WRITE_KEY || '',
  uploadMaxMb: Number(process.env.UPLOAD_MAX_MB || 250),
  uploadMaxVideoMb: Number(process.env.UPLOAD_MAX_VIDEO_MB || 4096),
  secret:      process.env.APP_SECRET || '',
  adminToken:  process.env.ADMIN_TOKEN || '',
  dataDir:     process.env.DATA_DIR || '/data',
  webDir:      process.env.WEB_DIR  || '/app/web',
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  publicUrl:   (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  resendKey:    process.env.RESEND_API_KEY || '',
  mailFrom:     process.env.MAIL_FROM || '',
  remindDays:  Number(process.env.REMIND_DAYS || 7),
  mailReplyTo:  process.env.MAIL_REPLY_TO || '',
  adminEmail:  (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminPass:    process.env.ADMIN_PASSWORD || '',
  admin2fa:   (process.env.ADMIN_2FA || 'on').toLowerCase() !== 'off',
  backupDir:    process.env.BACKUP_DIR || '',
  backupKeep:  Number(process.env.BACKUP_KEEP || 14),
  brandName:    process.env.BRAND_NAME || '',
  brandUrl:     process.env.BRAND_URL || '',
  brandSocial:  process.env.BRAND_SOCIAL || '',
  brandSocialLabel: process.env.BRAND_SOCIAL_LABEL || '',
  hostingerToken: process.env.HOSTINGER_TOKEN || '',
  cfToken:     process.env.CLOUDFLARE_TOKEN || '',
  dnsDomain:   process.env.DNS_DOMAIN || '',
  dnsHost:     process.env.DNS_HOST || '',
  dnsApply:   (process.env.DNS_APPLY || 'on').toLowerCase() !== 'off',
  dnsEvery:    Number(process.env.DNS_CHECK_MINUTES || 10),
  cfAccountId:   process.env.CF_ACCOUNT_ID || '',
  cfPagesToken:  process.env.CF_PAGES_TOKEN || '',
  cfPagesProject: process.env.CF_PAGES_PROJECT || '',
  siteUrl:      (process.env.SITE_URL || '').replace(/\/+$/, ''),
  prezip:      (process.env.PREZIP || 'on').toLowerCase() !== 'off',
  zipDir:       process.env.ZIP_DIR || '',
  zipMaxActive: Number(process.env.ZIP_MAX_ACTIVE || 3),
  zipTotalMbit: Number(process.env.ZIP_TOTAL_MBIT || 120),
  zipRateMbit:  Number(process.env.ZIP_RATE_MBIT || 0),
  zipMaxGb:     Number(process.env.ZIP_MAX_GB || 100),
  zipMinFreeGb: Number(process.env.ZIP_MIN_FREE_GB || 50),
  zipSweepMin:  Number(process.env.ZIP_SWEEP_MINUTES || 60),
  zipSettleMin: Number(process.env.ZIP_SETTLE_MINUTES || 10),
  zipStallSec:  Number(process.env.ZIP_STALL_SECONDS || 120),
  healthMinutes: Number(process.env.HEALTH_MINUTES || 30),
  brandAddress:  process.env.BRAND_ADDRESS || '',
  mailingMax:    Number(process.env.MAILING_MAX || 500),
  mailingDayMax: Number(process.env.MAILING_DAY_MAX || 500),
  mailingIntervalMs: Number(process.env.MAILING_INTERVAL_MS || 600),
  mailSend:     (process.env.MAIL_SEND || 'on').toLowerCase() !== 'off',
  resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET || '',
  resendBase:  (process.env.RESEND_API_URL || 'https://api.resend.com').replace(/\/+$/, ''),
  healthFirstSec: Number(process.env.HEALTH_FIRST_SECONDS || 120),
  healthMinFreeGb: Number(process.env.HEALTH_MIN_FREE_GB || 20),
};
for (const k of ['immichUrl', 'immichKey', 'secret', 'adminToken']) {
  if (!CFG[k]) { console.error(`FATAL: missing config: ${k}`); process.exit(1); }
}
if (!existsSync(CFG.dataDir)) mkdirSync(CFG.dataDir, { recursive: true });

/* ---------------------------------------------------------------- database */
const db = new DatabaseSync(join(CFG.dataDir, 'gallery.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS galleries (
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

/* A gallery delivers one or more named sets - Ceremony, Dancing - each backed by its own
   Immich album. A gallery with a single set never shows its name to the client. */
CREATE TABLE IF NOT EXISTS sets (
  id          INTEGER PRIMARY KEY,
  gallery_id  INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  album_id    TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_sets ON sets(gallery_id, position);

/* One ready-made zip per set, kept on disk so a download starts at once and can resume.
   'fingerprint' is a hash of the set's photo ids: if it no longer matches the album the
   file is out of date and is never served. */
/* What full downloads cost: one row per download sent, and the busiest moment of each hour,
   so "is the uplink the limit?" has an answer in numbers instead of a feeling. */
CREATE TABLE IF NOT EXISTS dl_stats (
  id          INTEGER PRIMARY KEY,
  gallery_id  INTEGER REFERENCES galleries(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                  -- zip | adhoc
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  bytes       INTEGER NOT NULL DEFAULT 0,
  ms          INTEGER NOT NULL DEFAULT 0,
  waited_ms   INTEGER NOT NULL DEFAULT 0,
  resume      INTEGER NOT NULL DEFAULT 0,     -- 1 = picking a dropped download back up
  complete    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_dl_stats ON dl_stats(at);
CREATE TABLE IF NOT EXISTS dl_peaks (
  hour    TEXT PRIMARY KEY,                   -- 2026-10-26T14, UTC
  active  INTEGER NOT NULL DEFAULT 0,
  waiting INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS zips (
  id          INTEGER PRIMARY KEY,
  gallery_id  INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  set_id      INTEGER NOT NULL UNIQUE REFERENCES sets(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'none',   -- none | building | ready | failed | evicted
  file        TEXT,
  fingerprint TEXT,
  assets      INTEGER,
  bytes       INTEGER,
  error       TEXT,
  seen_fp     TEXT,
  seen_at     INTEGER,
  updated_at  INTEGER NOT NULL DEFAULT 0,
  built_at    TEXT,
  last_used_at TEXT,
  served      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS registrations (
  id          INTEGER PRIMARY KEY,
  gallery_id  INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (gallery_id, email)
);

/* A client's picks. Tied to a registration, so a selection has a name on it —
   an anonymous list of favourites tells a photographer nothing. */
CREATE TABLE IF NOT EXISTS favourites (
  id              INTEGER PRIMARY KEY,
  gallery_id      INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  asset_id        TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (registration_id, asset_id)
);
CREATE INDEX IF NOT EXISTS ix_fav ON favourites(gallery_id, registration_id);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY,
  gallery_id  INTEGER REFERENCES galleries(id) ON DELETE CASCADE,
  reg_id      INTEGER REFERENCES registrations(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,
  asset_id    TEXT,
  ip          TEXT,
  ua          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_events_gallery ON events(gallery_id, created_at);
CREATE INDEX IF NOT EXISTS ix_events_type    ON events(type, created_at);

CREATE TABLE IF NOT EXISTS invites (
  id          INTEGER PRIMARY KEY,
  gallery_id  INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (gallery_id, email)
);

CREATE TABLE IF NOT EXISTS mail_log (
  id          INTEGER PRIMARY KEY,
  gallery_id  INTEGER REFERENCES galleries(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_mail ON mail_log(gallery_id, kind, created_at);

CREATE TABLE IF NOT EXISTS reminders (
  id          INTEGER PRIMARY KEY,
  gallery_id  INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  days_before INTEGER NOT NULL,
  audience    TEXT NOT NULL DEFAULT 'all',   -- 'all' | 'email'
  email       TEXT,
  UNIQUE (gallery_id, days_before, audience, email)
);

CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_codes (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_templates (
  id         INTEGER PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  built_in   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/* A mailing: one template sent to a list. The subject and body are copied in when it is made, so
   editing the template later changes nothing that is already queued. */
CREATE TABLE IF NOT EXISTS mailings (
  id           INTEGER PRIMARY KEY,
  request_key  TEXT UNIQUE NOT NULL,
  template_id  INTEGER,
  template_name TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  audience     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued',   -- queued | sending | paused | cancelled | done
  dry_run      INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  started_at   TEXT,
  finished_at  TEXT
);
CREATE TABLE IF NOT EXISTS mailing_recipients (
  id            INTEGER PRIMARY KEY,
  mailing_id    INTEGER NOT NULL REFERENCES mailings(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT,
  gallery_id    INTEGER REFERENCES galleries(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'queued',  -- queued | sending | sent | failed | skipped | cancelled | simulated
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_at       INTEGER NOT NULL DEFAULT 0,
  sending_since INTEGER,
  resend_id     TEXT,
  error         TEXT,
  sent_at       TEXT,
  UNIQUE (mailing_id, email)
);
CREATE INDEX IF NOT EXISTS ix_mrcpt ON mailing_recipients(mailing_id, status, next_at);
CREATE INDEX IF NOT EXISTS ix_mrcpt_sent ON mailing_recipients(status, sent_at);
/* people who asked not to be mailed. scope 'marketing' stops mailings; 'all' also stops gallery
   notices and reminders (set by the second button on the page, or by a bounce or complaint) */
CREATE TABLE IF NOT EXISTS suppressions (
  email      TEXT PRIMARY KEY,
  scope      TEXT NOT NULL DEFAULT 'marketing',
  reason     TEXT NOT NULL,                       -- unsubscribed | bounced | complained | manual
  mailing_id INTEGER,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

/* forward-only migrations, for databases created before a column existed */
for (const [table, col, decl] of [['email_templates', 'kind', "TEXT NOT NULL DEFAULT 'ready'"],
                                  ['email_templates', 'design', 'TEXT'],
                                  ['mailings', 'design', 'TEXT'],
                                  ['galleries', 'cover_file', 'TEXT'],
                                  ['galleries', 'cover_focus', 'TEXT'],
                                  ['galleries', 'sort_order', 'TEXT'],
                                  ['events', 'detail', 'TEXT']]) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
  if (!has) { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); console.log(`migrated: ${table}.${col}`); }
}

/* Galleries predate sets: give each one a set holding the album it already pointed at. */
{
  const need = db.prepare(
    'SELECT g.id, g.album_id FROM galleries g LEFT JOIN sets s ON s.gallery_id = g.id WHERE s.id IS NULL').all();
  for (const g of need) {
    db.prepare('INSERT INTO sets (gallery_id,name,album_id,position) VALUES (?,?,?,0)').run(g.id, 'Photos', g.album_id);
    console.log(`migrated: gallery ${g.id} now has one set`);
  }
}

/* a cover that is not one of the album's photos lives here, beside the database,
   so it is never part of the gallery and never lands in the Immich library */
const COVERS_DIR = join(CFG.dataDir, 'covers');
if (!existsSync(COVERS_DIR)) mkdirSync(COVERS_DIR, { recursive: true });

const q = {
  gallBySlug: db.prepare('SELECT * FROM galleries WHERE slug = ?'),
  gallById:   db.prepare('SELECT * FROM galleries WHERE id = ?'),
  gallAll:    db.prepare('SELECT * FROM galleries ORDER BY created_at DESC'),
  gallIns:    db.prepare(`INSERT INTO galleries
    (slug,title,subtitle,album_id,cover_asset_id,require_email,password_hash,password_salt,allow_download,expires_at,published_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
  regGet:     db.prepare('SELECT * FROM registrations WHERE gallery_id = ? AND email = ?'),
  regIns:     db.prepare('INSERT INTO registrations (gallery_id,email,name) VALUES (?,?,?)'),
  regById:    db.prepare('SELECT * FROM registrations WHERE id = ?'),
  regList:    db.prepare('SELECT * FROM registrations WHERE gallery_id = ? ORDER BY created_at DESC'),
  evIns:      db.prepare('INSERT INTO events (gallery_id,reg_id,type,asset_id,ip,ua,detail) VALUES (?,?,?,?,?,?,?)'),
  dlList:     db.prepare(`SELECT e.type, e.asset_id, e.detail, e.created_at, e.reg_id, r.email, r.name
                          FROM events e LEFT JOIN registrations r ON r.id = e.reg_id
                          WHERE e.gallery_id = ? AND e.type IN ('download','download_all')
                          ORDER BY e.created_at DESC, e.id DESC`),
  evList:     db.prepare('SELECT * FROM events WHERE gallery_id = ? ORDER BY created_at DESC LIMIT ?'),
  evCounts:   db.prepare(`SELECT type, COUNT(*) n FROM events WHERE gallery_id = ? GROUP BY type`),
  gallDel:    db.prepare('DELETE FROM galleries WHERE id = ?'),
  gallUpd:    db.prepare(`UPDATE galleries SET slug=?, title=?, subtitle=?, album_id=?, cover_asset_id=?,
                 require_email=?, allow_download=?, expires_at=?, published_at=? WHERE id=?`),
  gallPw:     db.prepare('UPDATE galleries SET password_hash=?, password_salt=? WHERE id=?'),
  coverClear: db.prepare('UPDATE galleries SET cover_asset_id = NULL WHERE cover_asset_id = ?'),
  favMine:    db.prepare('SELECT asset_id FROM favourites WHERE registration_id = ? ORDER BY created_at'),
  favAdd:     db.prepare('INSERT OR IGNORE INTO favourites (gallery_id,registration_id,asset_id) VALUES (?,?,?)'),
  favDel:     db.prepare('DELETE FROM favourites WHERE registration_id = ? AND asset_id = ?'),
  favCount:   db.prepare('SELECT COUNT(*) n FROM favourites WHERE registration_id = ?'),
  favWho:     db.prepare(`SELECT r.id, r.email, r.name, COUNT(f.id) n, MAX(f.created_at) last
                          FROM registrations r JOIN favourites f ON f.registration_id = r.id
                          WHERE r.gallery_id = ? GROUP BY r.id ORDER BY n DESC, last DESC`),
  favOf:      db.prepare('SELECT asset_id FROM favourites WHERE registration_id = ? ORDER BY created_at'),
  favTotal:   db.prepare('SELECT COUNT(DISTINCT asset_id) n FROM favourites WHERE gallery_id = ?'),
  setsFor:    db.prepare('SELECT * FROM sets WHERE gallery_id = ? ORDER BY position, id'),
  setById:    db.prepare('SELECT * FROM sets WHERE id = ?'),
  setIns:     db.prepare('INSERT INTO sets (gallery_id,name,album_id,position) VALUES (?,?,?,?)'),
  setName:    db.prepare('UPDATE sets SET name = ? WHERE id = ?'),
  setPos:     db.prepare('UPDATE sets SET position = ? WHERE id = ?'),
  setDel:     db.prepare('DELETE FROM sets WHERE id = ?'),
  setMax:     db.prepare('SELECT COALESCE(MAX(position), -1) n FROM sets WHERE gallery_id = ?'),
  zipBySet:   db.prepare('SELECT * FROM zips WHERE set_id = ?'),
  zipEnsure:  db.prepare('INSERT OR IGNORE INTO zips (gallery_id,set_id) VALUES (?,?)'),
  zipForGallery: db.prepare('SELECT * FROM zips WHERE gallery_id = ? ORDER BY set_id'),
  zipEvery:   db.prepare(`SELECT z.*, s.name set_name, s.album_id, g.slug, g.title FROM zips z
                          JOIN sets s ON s.id = z.set_id JOIN galleries g ON g.id = z.gallery_id ORDER BY z.id`),
  zipState:   db.prepare('UPDATE zips SET status=?, error=?, updated_at=? WHERE set_id=?'),
  zipReady:   db.prepare(`UPDATE zips SET status='ready', file=?, fingerprint=?, assets=?, bytes=?, error=NULL,
                          updated_at=?, built_at=datetime('now') WHERE set_id=?`),
  zipGone:    db.prepare(`UPDATE zips SET status=?, file=NULL, bytes=NULL, updated_at=? WHERE set_id=?`),
  zipSeen:    db.prepare('UPDATE zips SET seen_fp=?, seen_at=? WHERE set_id=?'),
  zipUsed:    db.prepare(`UPDATE zips SET last_used_at=datetime('now'), served=served+1 WHERE id=?`),
  zipDelSet:  db.prepare('DELETE FROM zips WHERE set_id = ?'),
  dlIns:      db.prepare('INSERT INTO dl_stats (gallery_id,kind,bytes,ms,waited_ms,resume,complete) VALUES (?,?,?,?,?,?,?)'),
  peakPut:    db.prepare(`INSERT INTO dl_peaks (hour,active,waiting) VALUES (?,?,?)
                          ON CONFLICT(hour) DO UPDATE SET active = MAX(active, excluded.active), waiting = MAX(waiting, excluded.waiting)`),
  dlTotals:   db.prepare(`SELECT COUNT(CASE WHEN resume = 0 THEN 1 END) downloads, COALESCE(SUM(bytes),0) bytes,
                          COUNT(CASE WHEN resume = 0 AND waited_ms > 5000 THEN 1 END) waited,
                          COALESCE(MAX(waited_ms),0) maxWait, COALESCE(AVG(CASE WHEN resume = 0 THEN waited_ms END),0) avgWait
                          FROM dl_stats WHERE at >= datetime('now', ?)`),
  dlByGallery: db.prepare(`SELECT s.gallery_id id, g.title, COUNT(CASE WHEN s.resume = 0 THEN 1 END) downloads, SUM(s.bytes) bytes
                          FROM dl_stats s JOIN galleries g ON g.id = s.gallery_id WHERE s.at >= datetime('now', ?)
                          GROUP BY s.gallery_id ORDER BY bytes DESC LIMIT 10`),
  peaksSince: db.prepare('SELECT * FROM dl_peaks WHERE hour >= ? ORDER BY hour'),
  statsPrune: db.prepare(`DELETE FROM dl_stats WHERE at < datetime('now', '-400 days')`),
  peaksPrune: db.prepare('DELETE FROM dl_peaks WHERE hour < ?'),
  coverFile:  db.prepare('UPDATE galleries SET cover_file = ? WHERE id = ?'),
  coverFocus: db.prepare('UPDATE galleries SET cover_focus = ? WHERE id = ?'),
  sortOrder:  db.prepare('UPDATE galleries SET sort_order = ? WHERE id = ?'),
  regCount:   db.prepare('SELECT COUNT(*) n FROM registrations WHERE gallery_id = ?'),
  evCount1:   db.prepare('SELECT COUNT(*) n FROM events WHERE gallery_id = ? AND type = ?'),
  invList:    db.prepare('SELECT * FROM invites WHERE gallery_id = ? ORDER BY created_at'),
  invIns:     db.prepare('INSERT OR IGNORE INTO invites (gallery_id,email,name) VALUES (?,?,?)'),
  invDel:     db.prepare('DELETE FROM invites WHERE gallery_id = ? AND email = ?'),
  mailIns:    db.prepare('INSERT INTO mail_log (gallery_id,email,kind,status,detail) VALUES (?,?,?,?,?)'),
  mailFor:    db.prepare('SELECT * FROM mail_log WHERE gallery_id = ? ORDER BY created_at DESC LIMIT 60'),
  mailSent:   db.prepare("SELECT COUNT(*) n FROM mail_log WHERE gallery_id=? AND email=? AND kind=? AND status='sent'"),
  gallDue:    db.prepare("SELECT * FROM galleries WHERE published_at IS NOT NULL AND expires_at IS NOT NULL"),
  remList:    db.prepare('SELECT * FROM reminders WHERE gallery_id = ? ORDER BY days_before DESC'),
  remIns:     db.prepare('INSERT OR IGNORE INTO reminders (gallery_id,days_before,audience,email) VALUES (?,?,?,?)'),
  remDel:     db.prepare('DELETE FROM reminders WHERE id = ? AND gallery_id = ?'),
  setGet:     db.prepare('SELECT value FROM settings WHERE key = ?'),
  tplAll:     db.prepare('SELECT * FROM email_templates WHERE kind = ? ORDER BY built_in DESC, name'),
  tplGet:     db.prepare('SELECT * FROM email_templates WHERE id = ?'),
  tplIns:     db.prepare('INSERT INTO email_templates (name,subject,body,built_in,kind,design) VALUES (?,?,?,?,?,?)'),
  tplDesign:  db.prepare('UPDATE email_templates SET design = ? WHERE id = ?'),
  tplByName:  db.prepare('SELECT * FROM email_templates WHERE name = ? AND kind = ?'),
  tplUpd:     db.prepare('UPDATE email_templates SET name=?, subject=?, body=?, design=? WHERE id=?'),
  tplDel:     db.prepare('DELETE FROM email_templates WHERE id = ? AND built_in = 0'),
  tplCount:   db.prepare("SELECT COUNT(*) n FROM email_templates WHERE kind = 'ready'"),
  mlIns:      db.prepare('INSERT INTO mailings (request_key,template_id,template_name,subject,body,design,audience,status,dry_run,total) VALUES (?,?,?,?,?,?,?,?,?,?)'),
  mlGet:      db.prepare('SELECT * FROM mailings WHERE id = ?'),
  mlByKey:    db.prepare('SELECT * FROM mailings WHERE request_key = ?'),
  mlList:     db.prepare('SELECT * FROM mailings ORDER BY id DESC LIMIT 100'),
  mlActive:   db.prepare("SELECT * FROM mailings WHERE status IN ('queued','sending') ORDER BY id LIMIT 1"),
  mlStatus:   db.prepare('UPDATE mailings SET status = ?, error = ? WHERE id = ?'),
  mlStarted:  db.prepare("UPDATE mailings SET started_at = COALESCE(started_at, datetime('now')) WHERE id = ?"),
  mlFinished: db.prepare("UPDATE mailings SET finished_at = datetime('now') WHERE id = ?"),
  mlPrune:    db.prepare("DELETE FROM mailings WHERE created_at < datetime('now', '-730 days')"),
  mrIns:      db.prepare('INSERT INTO mailing_recipients (mailing_id,email,name,gallery_id,status,error) VALUES (?,?,?,?,?,?)'),
  mrNext:     db.prepare("SELECT * FROM mailing_recipients WHERE mailing_id = ? AND status = 'queued' AND next_at <= ? ORDER BY id LIMIT 1"),
  mrPending:  db.prepare("SELECT COUNT(*) n, MIN(next_at) minNext FROM mailing_recipients WHERE mailing_id = ? AND status IN ('queued','sending')"),
  mrCounts:   db.prepare('SELECT status, COUNT(*) n FROM mailing_recipients WHERE mailing_id = ? GROUP BY status'),
  mrFor:      db.prepare(`SELECT r.email, r.name, r.status, r.error, r.sent_at, g.title gallery FROM mailing_recipients r
                          LEFT JOIN galleries g ON g.id = r.gallery_id WHERE r.mailing_id = ? ORDER BY r.id LIMIT 3000`),
  mrSet:      db.prepare('UPDATE mailing_recipients SET status = ?, attempts = ?, next_at = ?, sending_since = ?, resend_id = ?, error = ?, sent_at = COALESCE(?, sent_at) WHERE id = ?'),
  mrCancel:   db.prepare("UPDATE mailing_recipients SET status = 'cancelled' WHERE mailing_id = ? AND status = 'queued'"),
  mrRetry:    db.prepare("UPDATE mailing_recipients SET status = 'queued', attempts = 0, next_at = 0, error = NULL WHERE mailing_id = ? AND status = 'failed'"),
  mrStaleSending:  db.prepare("UPDATE mailing_recipients SET status = 'failed', error = 'Outcome unknown after a restart; it may have been sent' WHERE status = 'sending' AND sending_since < ?"),
  mrRecentSending: db.prepare("UPDATE mailing_recipients SET status = 'queued', next_at = 0 WHERE status = 'sending' AND sending_since >= ?"),
  sentLast24h: db.prepare("SELECT COUNT(*) n FROM mailing_recipients WHERE status = 'sent' AND sent_at >= datetime('now', '-1 day')"),
  supGet:     db.prepare('SELECT * FROM suppressions WHERE email = ?'),
  supAll:     db.prepare('SELECT * FROM suppressions ORDER BY created_at DESC'),
  supPut:     db.prepare(`INSERT INTO suppressions (email,scope,reason,mailing_id,detail) VALUES (?,?,?,?,?)
                          ON CONFLICT(email) DO UPDATE SET scope = CASE WHEN suppressions.scope = 'all' OR excluded.scope = 'all' THEN 'all' ELSE 'marketing' END`),
  supDel:     db.prepare('DELETE FROM suppressions WHERE email = ?'),
  supCount:   db.prepare('SELECT COUNT(*) n FROM suppressions WHERE mailing_id = ?'),
  setPut:     db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  admGet:     db.prepare('SELECT * FROM admin_users WHERE email = ?'),
  admAny:     db.prepare('SELECT COUNT(*) n FROM admin_users'),
  admIns:     db.prepare('INSERT INTO admin_users (email,password_hash,password_salt) VALUES (?,?,?)'),
  admUpd:     db.prepare('UPDATE admin_users SET password_hash=?, password_salt=? WHERE email=?'),
  codeIns:    db.prepare('INSERT INTO login_codes (id,email,code_hash,expires_at) VALUES (?,?,?,?)'),
  codeGet:    db.prepare('SELECT * FROM login_codes WHERE id = ?'),
  codeTry:    db.prepare('UPDATE login_codes SET tries = tries + 1 WHERE id = ?'),
  codeDel:    db.prepare('DELETE FROM login_codes WHERE id = ?'),
  codeGC:     db.prepare('DELETE FROM login_codes WHERE expires_at < ?'),
};

/* The admin account comes from the environment, so there is no setup wizard
   sitting on the public internet waiting to be found. */
function seedTemplates() {
  if (q.tplCount.get().n) return;
  q.tplIns.run('Default',
    'Your photos are ready \u2014 {{title}}',
    "Hi,\n\nYour photos from {{title}} are ready to view and download.\n\nTake your time looking through them, and let me know if you have any questions.",
    1, 'ready', null);
  q.tplIns.run('Short and warm',
    '{{title}} \u2014 your gallery is live',
    "Hi,\n\nHere are your photos. I hope you love them as much as I enjoyed taking them.",
    0, 'ready', null);
}
/* starters for mailings, added once; deleting them all does not bring them back */
const STARTER_DESIGNS = {
  'New work': { image: { mode: 'none' }, button: { text: 'See the new work', mode: 'site' } },
  'Seasonal check-in': { image: { mode: 'none' }, button: { text: '', mode: 'none' } },
  'Your gallery is closing soon': { image: { mode: 'cover' }, button: { text: 'View your gallery', mode: 'gallery' }, showExpiry: true },
};
function seedMailingTemplates() {
  /* starters made before mailings had a design get one, once, and only if still untouched */
  if (q.setGet.get('mailing_tpl_seeded') && !q.setGet.get('mailing_design_seeded')) {
    for (const [name, d] of Object.entries(STARTER_DESIGNS)) { const t = q.tplByName.get(name, 'mailing'); if (t && !t.design) q.tplDesign.run(JSON.stringify(cleanDesign(d)), t.id); }
    q.setPut.run('mailing_design_seeded', '1');
  }
  if (q.setGet.get('mailing_tpl_seeded')) return;
  q.setPut.run('mailing_design_seeded', '1');
  q.tplIns.run('New work', 'New from {{brand}}',
    "Hi {{name}},\n\nI've just finished a new set of work and thought of you. You can see it here:\n\n{{site}}\n\nThank you for being part of it.", 0, 'mailing', JSON.stringify(cleanDesign(STARTER_DESIGNS['New work'])));
  q.tplIns.run('Seasonal check-in', 'Booking for the season ahead',
    "Hi {{name}},\n\nIt's that time of year again, and my calendar is starting to fill. If you'd like to plan a session, just reply to this email and we'll find a date.\n\nWarmly,\n{{brand}}", 0, 'mailing', JSON.stringify(cleanDesign(STARTER_DESIGNS['Seasonal check-in'])));
  q.tplIns.run('Your gallery is closing soon', '{{title}} closes on {{expiry}}',
    "Hi {{name}},\n\nA gentle note that your gallery is available until {{expiry}}. After that it will no longer be online, so please download anything you'd like to keep.\n\n{{link}}", 0, 'mailing', JSON.stringify(cleanDesign(STARTER_DESIGNS['Your gallery is closing soon'])));
  q.setPut.run('mailing_tpl_seeded', '1');
}

function syncAdminUser() {
  if (!CFG.adminEmail || !CFG.adminPass) return;
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(CFG.adminPass, salt, 32).toString('hex');
  const existing = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(CFG.adminEmail);
  if (existing) db.prepare('UPDATE admin_users SET password_hash=?, password_salt=? WHERE email=?')
                  .run(hash, salt, CFG.adminEmail);
  else db.prepare('INSERT INTO admin_users (email,password_hash,password_salt) VALUES (?,?,?)')
         .run(CFG.adminEmail, hash, salt);
}

/* A small ring buffer of our own output, so logs can be read without shell
   access to the host. */
const LOG_MAX = 400;
const logRing = [];
function remember(level, args) {
  const line = args.map(a => (typeof a === 'string' ? a : (a && a.stack) || JSON.stringify(a))).join(' ');
  logRing.push({ at: new Date().toISOString(), level, line: line.slice(0, 2000) });
  if (logRing.length > LOG_MAX) logRing.shift();
}
for (const lvl of ['log', 'warn', 'error']) {
  const orig = console[lvl].bind(console);
  console[lvl] = (...a) => { try { remember(lvl, a); } catch {} orig(...a); };
}

/* ------------------------------------------------------------------ helpers */
const b64u  = b => Buffer.from(b).toString('base64url');
const unb64 = s => Buffer.from(s, 'base64url');

function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac  = createHmac('sha256', CFG.secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function unsign(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const want = createHmac('sha256', CFG.secret).update(body).digest('base64url');
  const a = Buffer.from(mac || ''), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(unb64(body).toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
const hashPw = (pw, salt) => scryptSync(pw, salt, 32).toString('hex');
function pwMatches(gallery, pw) {
  if (!gallery.password_hash) return true;
  const got  = Buffer.from(hashPw(String(pw ?? ''), gallery.password_salt), 'hex');
  const want = Buffer.from(gallery.password_hash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}
function constEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function setAdminCookie(res, req) {
  const tok = sign({ adm: true, exp: Date.now() + 14 * 86400_000 });
  res.setHeader('set-cookie',
    `adm=${encodeURIComponent(tok)}; Path=/; Max-Age=${14 * 86400}; HttpOnly; SameSite=Lax` +
    (isHttps(req) ? '; Secure' : ''));
}
/* Real mailings need the browser sign-in (password and emailed code), never just the API token:
   a leaked token must not be able to mail every client. */
function sessionOnly(req) {
  const p = unsign(cookies(req)['adm'] || '');
  return !!(p && p.adm === true);
}
function originOk(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === new URL(CFG.publicUrl).host; } catch { return false; }
}
function adminOk(req) {
  const hdr = req.headers['x-admin-token'];
  if (hdr && constEq(hdr, CFG.adminToken)) return true;
  const p = unsign(cookies(req)['adm'] || '');
  return !!(p && p.adm === true);
}
const isExpired = g => !!g.expires_at && new Date(g.expires_at).getTime() < Date.now();

/* The line under a gallery's title is a date. It is stored as YYYY-MM-DD and written out
   long form; anything else is text from before dates were dates, and is passed through. */
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function prettyDate(v) {
  const t = String(v || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return t;
  /* build from parts: `new Date("2026-10-18")` is UTC and can land on the 17th */
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d)) return t;
  const day = d.getDate();
  const suf = (day % 10 === 1 && day !== 11) ? 'st'
            : (day % 10 === 2 && day !== 12) ? 'nd'
            : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
  return `${MONTHS[d.getMonth()]} ${day}${suf}, ${d.getFullYear()}`;
}

/* Galleries live at the root, so a slug may not be a path the app already answers. */
const RESERVED = new Set(['g', 's', 'share', 'api', 'admin', 'healthz', 'brand', 'static', 'assets',
                          'favicon.ico', 'robots.txt', 'sitemap.xml', 'index.html', 'admin.html',
                          'well-known', 'login', 'logout', 'unsubscribe', 'u', 'mail']);
const slugShape = s => /^[a-z0-9][a-z0-9-]{1,60}$/i.test(String(s));
const slugFree  = s => !RESERVED.has(String(s).toLowerCase());

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const clientIp = req =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

function log(gallery, regId, type, assetId, req, detail) {
  try {
    q.evIns.run(gallery?.id ?? null, regId ?? null, type, assetId ?? null,
                clientIp(req), (req.headers['user-agent'] || '').slice(0, 300),
                detail ? JSON.stringify(detail) : null);
  } catch (e) { console.error('log failed', e.message); }
}

function json(res, code, obj, headers = {}) {
  let body = Buffer.from(JSON.stringify(obj));
  const h = { 'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store', vary: 'accept-encoding', ...headers };
  /* The asset list for a large gallery runs to a hundred kilobytes and every photo
     waits behind it. Below an MTU there is nothing to gain. */
  if (res.gzOk && body.length > 1400) {
    body = gzipSync(body);
    h['content-encoding'] = 'gzip';
  }
  res.writeHead(code, h);
  res.end(body);
}
async function readJson(req, limit = 64 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new Error('body too large');
    chunks.push(c);
  }
  if (!n) return {};
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function readBuffer(req, limit) {
  const chunks = []; let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new Error('body too large');   /* the caller answers, then closes */
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
function isoOrNow(v) { const d = new Date(v || ''); return isNaN(d) ? new Date().toISOString() : d.toISOString(); }

/* simple per-IP throttle for the password gate */
const attempts = new Map();
function tooManyAttempts(key, limit = 12) {
  const now = Date.now();
  const rec = attempts.get(key) || { n: 0, t: now };
  if (now - rec.t > 15 * 60_000) { rec.n = 0; rec.t = now; }
  rec.n++; attempts.set(key, rec);
  return rec.n > limit;
}

/* --------------------------------------------------------------------- mail */
function defaultReminders() {
  try {
    const row = q.setGet.get('default_reminders');
    const v = row ? JSON.parse(row.value) : null;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function applyDefaultReminders(galleryId) {
  for (const r of defaultReminders()) {
    const days = Number(r.daysBefore);
    if (!Number.isFinite(days) || days < 0 || days > 365) continue;
    q.remIns.run(galleryId, Math.round(days), r.audience === 'email' ? 'email' : 'all',
                 r.audience === 'email' ? String(r.email || '').toLowerCase() : null);
  }
}

const mailReady = () => !!(CFG.resendKey && CFG.mailFrom && CFG.publicUrl);

function fillVars(text, g) {
  const url = galleryUrl(g);
  const when = g.expires_at
    ? new Date(g.expires_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })
    : '';
  return String(text || '')
    .replace(/\{\{\s*title\s*\}\}/gi, g.title || '')
    .replace(/\{\{\s*subtitle\s*\}\}/gi, prettyDate(g.subtitle))
    .replace(/\{\{\s*link\s*\}\}/gi, url)
    .replace(/\{\{\s*expiry\s*\}\}/gi, when)
    .replace(/\{\{\s*brand\s*\}\}/gi, CFG.brandName || '');
}

function galleryUrl(g) { return `${CFG.publicUrl}/${g.slug}`; }

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

/* The layout clients see: mark, title, cover photo, your words, one button. */
function emailHtml(g, bodyText, opts = {}) {
  const url    = galleryUrl(g);
  const cover  = opts.coverUrl || `${CFG.publicUrl}/api/g/${encodeURIComponent(g.slug)}/cover`;
  const logo   = `${CFG.publicUrl}/brand/logo`;
  const brand  = CFG.brandName || '';
  const site   = CFG.brandUrl || '';
  const when   = g.expires_at
    ? new Date(g.expires_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })
    : '';
  const paras = esc(fillVars(bodyText, g)).split(/\n{2,}/).filter(Boolean)
    .map(t => `<p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#333">${t.replace(/\n/g,'<br>')}</p>`)
    .join('');

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:28px 12px">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff">
    <tr><td align="center" style="padding:40px 32px 22px">
      <img src="${logo}" width="64" height="64" alt="${esc(brand)}" style="display:block;border:0">
    </td></tr>
    <tr><td align="center" style="padding:0 32px 26px">
      <div style="font-family:Helvetica,Arial,sans-serif;font-size:19px;font-weight:600;
        letter-spacing:.16em;text-transform:uppercase;color:#1a1a1a">${esc(g.title)}</div>
      ${g.subtitle ? `<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.22em;
        text-transform:uppercase;color:#8a8a8a;margin-top:9px">${esc(prettyDate(g.subtitle))}</div>` : ''}
    </td></tr>
    <tr><td style="padding:0">
      <a href="${url}"><img src="${cover}" width="560" alt="" style="display:block;width:100%;height:auto;border:0"></a>
    </td></tr>
    <tr><td style="padding:30px 36px 6px;font-family:Helvetica,Arial,sans-serif">${paras}</td></tr>
    <tr><td align="center" style="padding:14px 32px 38px">
      <a href="${url}" style="display:inline-block;padding:15px 44px;background:#1a1a1a;color:#fff;
        text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;
        letter-spacing:.24em;text-transform:uppercase">View Gallery</a>
      ${opts.showExpiry && when ? `<div style="font-family:Helvetica,Arial,sans-serif;font-size:12px;
        color:#8a8a8a;margin-top:20px">Available until ${esc(when)}</div>` : ''}
    </td></tr>
    <tr><td align="center" style="padding:0 32px 34px;border-top:1px solid #eee">
      <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.2em;
        text-transform:uppercase;color:#aaa;padding-top:24px">
        ${site ? `<a href="${site}" style="color:#888;text-decoration:none">${esc(brand || site)}</a>` : esc(brand)}
      </div>
      <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#bbb;margin-top:12px">
        <a href="${url}" style="color:#bbb">${esc(url)}</a></div>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

function tmpl(kind, g, extra) {
  if (kind === 'ready') {
    return {
      subject: fillVars(extra?.subject || 'Your photos are ready \u2014 {{title}}', g),
      html: emailHtml(g, extra?.body || 'Your photos are ready to view and download.',
                      { showExpiry: extra?.showExpiry !== false, coverUrl: extra?.coverUrl }),
    };
  }
  const days = extra?.days;
  const lead = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  const when = g.expires_at
    ? new Date(g.expires_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) : '';
  return {
    subject: `Reminder: ${g.title} expires ${lead}`,
    html: emailHtml(g,
      `Your gallery expires ${lead}.\n\nAfter ${when} it will no longer be available, so please download anything you would like to keep.`,
      { showExpiry: true }),
  };
}

async function sendLoginCode(email, code) {
  if (!mailReady()) throw new Error('email is not configured');
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:460px;margin:0 auto;padding:36px 24px;color:#1a1a1a">
    <h1 style="font-size:17px;letter-spacing:.06em;margin:0 0 12px">Your sign-in code</h1>
    <p style="font-size:14px;line-height:1.7;margin:0 0 24px">Use this code to finish signing in to your gallery admin.</p>
    <div style="font-size:34px;font-weight:700;letter-spacing:.32em;padding:18px 0;border-top:1px solid #e6e6e6;border-bottom:1px solid #e6e6e6">${code}</div>
    <p style="font-size:12.5px;color:#8a8a8a;line-height:1.7;margin:22px 0 0">
      It expires in 10 minutes. If you didn't try to sign in, someone has your password — change it.</p></div>`;
  const r = await fetch(`${CFG.resendBase}/emails`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${CFG.resendKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: CFG.mailFrom, to: [email], subject: `${code} is your sign-in code`, html,
      ...(CFG.mailReplyTo ? { reply_to: CFG.mailReplyTo } : {}),
    }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 160)}`);
}

async function sendMailKind(g, email, kind, logKind, extra) {
  if (!mailReady()) throw new Error('email is not configured');
  if (suppressedFor(email, 'service')) throw new Error('unsubscribed from all email');
  const t = tmpl(kind, g, extra);
  try {
    const r = await fetch(`${CFG.resendBase}/emails`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${CFG.resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: CFG.mailFrom, to: [email], subject: t.subject, html: t.html,
        ...(CFG.mailReplyTo ? { reply_to: CFG.mailReplyTo } : {}),
      }),
    });
    const body = await r.text();
    q.mailIns.run(g.id, email, logKind, r.ok ? 'sent' : 'failed', r.ok ? null : body.slice(0, 300));
    if (!r.ok) throw new Error(`resend ${r.status}: ${body.slice(0, 160)}`);
    return true;
  } catch (e) {
    q.mailIns.run(g.id, email, logKind, 'failed', String(e.message).slice(0, 300));
    throw e;
  }
}

/* everyone who should hear about this gallery */
function audience(gid) {
  const out = new Map();
  for (const r of q.invList.all(gid))  out.set(r.email.toLowerCase(), r.name || null);
  for (const r of q.regList.all(gid))  if (!out.has(r.email.toLowerCase())) out.set(r.email.toLowerCase(), r.name || null);
  return [...out.keys()];
}

/* hourly: warn about galleries about to expire, once per person */
async function expirySweep() {
  if (!mailReady()) return;
  const now = Date.now();
  for (const g of q.gallDue.all()) {
    const expires = new Date(g.expires_at).getTime();
    if (!Number.isFinite(expires) || expires <= now) continue;
    const rules = q.remList.all(g.id);
    if (!rules.length) continue;
    const daysLeft = (expires - now) / 86400_000;
    for (const rule of rules) {
      if (daysLeft > rule.days_before) continue;          /* not due yet */
      const kind = `expiring-${rule.days_before}`;
      const to = rule.audience === 'email'
        ? (rule.email ? [rule.email] : [])
        : audience(g.id);
      for (const email of to) {
        if (q.mailSent.get(g.id, email, kind).n) continue; /* already sent this one */
        if (suppressedFor(email, 'service')) continue;      /* asked for nothing at all */
        try {
          await sendMailKind(g, email, 'expiring', kind, { days: rule.days_before });
          console.log(`reminder (${rule.days_before}d) -> ${email} [${g.slug}]`);
        } catch (e) { console.error('reminder failed:', e.message); }
      }
    }
  }
}

/* --------------------------------------------------------------------- backup */
/* VACUUM INTO writes a consistent copy even while the app is serving, which a
   plain file copy of a live SQLite database would not. */
function runBackup(force = false) {
  if (!CFG.backupDir) return null;
  try {
    if (!existsSync(CFG.backupDir)) mkdirSync(CFG.backupDir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const final = join(CFG.backupDir, `gallery-${day}.db`);
    if (!force && existsSync(final)) return null;          /* already done today */
    const tmp = final + '.tmp';
    if (existsSync(tmp)) unlinkSync(tmp);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    if (existsSync(final)) unlinkSync(final);
    renameSync(tmp, final);

    /* keep the most recent N, drop the rest */
    const old = readdirSync(CFG.backupDir)
      .filter(f => /^gallery-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort().reverse().slice(CFG.backupKeep);
    for (const f of old) { try { unlinkSync(join(CFG.backupDir, f)); } catch {} }

    const cov = backupCovers(); backupMailImages();
    const siteCopy = site.backup(CFG.backupDir);
    const size = statSync(final).size;
    console.log(`backup written: ${final} (${(size / 1024).toFixed(0)} KB)`
      + (cov ? `, covers ${cov.held} held${cov.copied ? ` (+${cov.copied})` : ''}${cov.pruned ? ` -${cov.pruned}` : ''}` : '')
      + (siteCopy ? `, website ${siteCopy.photos} photos` : ''));
    return { file: final, size, covers: cov };
  } catch (e) {
    console.error('backup failed:', e.message);
    return { error: e.message };
  }
}

/* pictures in sent mailings must outlive the box they were uploaded to; they are small and never change */
function backupMailImages() {
  if (!CFG.backupDir || !existsSync(MAIL_IMG_DIR)) return;
  try {
    const dst = join(CFG.backupDir, 'mail-images');
    if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
    for (const f of readdirSync(MAIL_IMG_DIR)) {
      if (f.startsWith('.') || existsSync(join(dst, f))) continue;
      copyFileSync(join(MAIL_IMG_DIR, f), join(dst, f));
    }
  } catch (e) { console.error('mail picture backup failed:', e.message); }
}

/* An uploaded cover lives on disk, not in the database, so a snapshot of the
   database alone restores galleries pointing at files that are not there. */
function backupCovers() {
  if (!CFG.backupDir || !existsSync(COVERS_DIR)) return null;
  try {
    const dst = join(CFG.backupDir, 'covers');
    if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
    const live = readdirSync(COVERS_DIR).filter(f => !f.startsWith('.'));

    /* names carry a random part, so a copy already here is the same file */
    let copied = 0;
    for (const f of live) {
      const to = join(dst, f);
      if (!existsSync(to)) { copyFileSync(join(COVERS_DIR, f), to); copied++; }
    }

    /* A cover that has been replaced is still needed by the snapshots that point at
       it, so it is kept for as long as they are. */
    const have = new Set(live);
    const cutoff = Date.now() - CFG.backupKeep * 86400_000;
    let pruned = 0;
    for (const f of readdirSync(dst)) {
      if (have.has(f) || f.startsWith('.')) continue;
      try { if (statSync(join(dst, f)).mtimeMs < cutoff) { unlinkSync(join(dst, f)); pruned++; } } catch {}
    }
    return { held: readdirSync(dst).filter(f => !f.startsWith('.')).length, copied, pruned };
  } catch (e) {
    console.error('cover backup failed:', e.message);
    return null;
  }
}

function backupList() {
  if (!CFG.backupDir || !existsSync(CFG.backupDir)) return [];
  return readdirSync(CFG.backupDir)
    .filter(f => /^gallery-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort().reverse()
    .map(f => { const st = statSync(join(CFG.backupDir, f)); return { file: f, size: st.size, at: st.mtime.toISOString() }; });
}
function coverBackupCount() {
  const dst = CFG.backupDir ? join(CFG.backupDir, 'covers') : null;
  if (!dst || !existsSync(dst)) return 0;
  return readdirSync(dst).filter(f => !f.startsWith('.')).length;
}

/* ------------------------------------------------------------------- covers */
/* only what every browser renders - a HEIC cover would be a broken image for most clients */
const COVER_OK = /\.(jpe?g|png|webp|avif|gif)$/i;
const COVER_MAX = 12 * 1024 * 1024;
const COVER_MIME = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png',
                     '.webp':'image/webp', '.avif':'image/avif', '.gif':'image/gif' };
const coverPath = g => (g.cover_file ? join(COVERS_DIR, g.cover_file) : null);
function dropCoverFile(g) {
  const p = coverPath(g);
  if (p && existsSync(p)) { try { unlinkSync(p); } catch (e) { console.error('cover unlink', e.message); } }
}

/* ------------------------------------------------------------------- immich */
async function immich(path, init = {}) {
  /* `write: true` picks the key allowed to create things; the default key is read-only
     so a bug in the client path can never add or change anything in Immich. */
  const { write, ...rest } = init;
  const r = await fetch(CFG.immichUrl + path, {
    ...rest,
    headers: { 'x-api-key': write && CFG.immichWriteKey ? CFG.immichWriteKey : CFG.immichKey,
               ...(rest.headers || {}) },
  });
  if (write && (rest.method || 'GET') !== 'GET') albumLists.clear();   /* a photo was added, removed or moved */
  return r;
}
const canUpload = () => !!CFG.immichWriteKey;
const UPLOAD_PHOTO = /\.(jpe?g|png|heic|heif|webp|avif|gif|tiff?|dng)$/i;
const UPLOAD_VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|wmv|3gp|mts|m2ts|mpe?g)$/i;
const MEDIA_TYPE = {
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.heic':'image/heic','.heif':'image/heif',
  '.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.tif':'image/tiff','.tiff':'image/tiff',
  '.dng':'image/x-adobe-dng','.mp4':'video/mp4','.m4v':'video/x-m4v','.mov':'video/quicktime',
  '.webm':'video/webm','.mkv':'video/x-matroska','.avi':'video/x-msvideo','.wmv':'video/x-ms-wmv',
  '.3gp':'video/3gpp','.mts':'video/mp2t','.m2ts':'video/mp2t','.mpg':'video/mpeg','.mpeg':'video/mpeg',
};

/* Send the file to Immich as it arrives. A video runs to gigabytes, and holding one in
   the container's memory to hand over as a Blob would be the end of a small NAS. */
function uploadToImmich(req, name, when, cap) {
  const b = '----immichset' + randomBytes(12).toString('hex');
  const safe = name.replace(/["\r\n]/g, '_');
  const field = (k, v) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  const head = Buffer.from(
    field('fileCreatedAt', when) + field('fileModifiedAt', when) + field('filename', safe)
    + `--${b}\r\nContent-Disposition: form-data; name="assetData"; filename="${safe}"\r\n`
    + `Content-Type: ${MEDIA_TYPE[extname(safe).toLowerCase()] || 'application/octet-stream'}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${b}--\r\n`);

  let sent = 0;
  const body = new ReadableStream({
    async start(c) {
      c.enqueue(head);
      try {
        for await (const chunk of req) {
          sent += chunk.length;
          if (sent > cap) { c.error(new Error('too large')); return; }   /* never store a truncated file */
          c.enqueue(chunk);
        }
      } catch (e) { c.error(e); return; }                                /* the browser went away */
      c.enqueue(tail); c.close();
    },
  });

  const declared = Number(req.headers['content-length'] || 0);
  const headers = { 'content-type': `multipart/form-data; boundary=${b}` };
  if (declared) headers['content-length'] = String(head.length + declared + tail.length);
  return immich('/api/assets', { write: true, method: 'POST', headers, body, duplex: 'half' })
    .then(r => ({ r, bytes: sent }));
}

/* What the write key may actually do. Immich answers the permission question before it
   validates the body, so a deliberately empty request asks without creating anything.
   The panel uses this to show only the buttons that will work, and to name the exact
   permission to tick when one is missing. */
/* Shaped like a real v4 id so the probes clear Immich's format check and reach the
   permission answer, but belonging to nothing. Never an empty ids array: an API that
   reads empty as "all" would turn a probe into a mass operation. */
const NIL_ID = '00000000-0000-4000-8000-000000000000';
const NO_CAPS = { upload: false, albumCreate: false, albumAdd: false, albumRemove: false, trash: false, restore: false };
let capsCache = null, capsAt = 0;
async function writeCaps() {
  if (!canUpload()) return NO_CAPS;
  if (capsCache && Date.now() - capsAt < 600_000) return capsCache;
  const asJson = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const probe = async (p, init) => {
    try {
      const r = await immich(p, { write: true, ...init });
      if (r.status !== 403) return true;
      return !/Missing required permission/.test(await r.text().catch(() => ''));
    } catch { return true; }   /* if Immich is unreachable, don't hide the buttons too */
  };
  const [upload, albumCreate, albumAdd, albumRemove, trash, restore] = await Promise.all([
    probe('/api/assets', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: '--x--' }),
    probe('/api/albums', asJson('POST', {})),
    probe(`/api/albums/${NIL_ID}/assets`, asJson('PUT', { ids: [NIL_ID] })),
    probe(`/api/albums/${NIL_ID}/assets`, asJson('DELETE', { ids: [NIL_ID] })),
    probe('/api/assets', asJson('DELETE', { ids: [NIL_ID], force: false })),
    probe('/api/trash/restore/assets', asJson('POST', { ids: [NIL_ID] })),
  ]);
  capsCache = { upload, albumCreate, albumAdd, albumRemove, trash, restore };
  capsAt = Date.now();
  return capsCache;
}

/* Undo only reaches photos this panel trashed, so it can never pull something
   unrelated back out of Immich's trash. */
const recentTrash = new Map();
function rememberTrash(albumId, ids) {
  const now = Date.now();
  for (const [id, rec] of recentTrash) if (now - rec.at > 30 * 60_000) recentTrash.delete(id);
  for (const id of ids) recentTrash.set(id, { albumId, at: now });
}
async function immichJson(path, init) {
  const r = await immich(path, init);
  if (!r.ok) throw new Error(`immich ${path} -> ${r.status}`);
  return r.json();
}
/* Membership cache so an image request can be checked without re-walking the album.
   Without this, a session for one gallery could fetch any asset id from another. */
const albumSets = new Map();
async function albumHas(albumId, assetId) {
  let c = albumSets.get(albumId);
  if (!c || Date.now() - c.at > 120_000) {
    const list = await albumAssets(albumId);
    c = { ids: new Set(list.map(a => a.id)), at: Date.now() };
    albumSets.set(albumId, c);
  }
  if (c.ids.has(assetId)) return true;
  /* a newly added photo may predate the cache - refresh once before refusing */
  if (Date.now() - c.at > 5_000) {
    const list = await albumAssets(albumId, { fresh: true });
    c = { ids: new Set(list.map(a => a.id)), at: Date.now() };
    albumSets.set(albumId, c);
    return c.ids.has(assetId);
  }
  return false;
}

const setsOf = g => q.setsFor.all(g.id);

/* A photo may be served only if it is in one of this gallery's sets, never because
   it happens to live somewhere else in the library. */
async function galleryHas(g, assetId) {
  for (const st of setsOf(g)) if (await albumHas(st.album_id, assetId)) return true;
  return false;
}
async function firstAsset(g) {
  for (const st of setsOf(g)) {
    try {
      const l = await albumAssets(st.album_id);
      const a = l.find(x => x.isImage) || l[0];
      if (a) return a.id;
    } catch (e) { console.error('set listing failed', st.id, e.message); }
  }
  return null;
}
async function allAssets(g) {
  const out = [];
  for (const st of setsOf(g)) {
    try { out.push(...await albumAssets(st.album_id)); } catch (e) { console.error('set listing failed', st.id, e.message); }
  }
  return out;
}

/* An album's photo list costs one Immich call per month of photos, and every gallery open,
   set count and zip check asked for it again. A minute-old answer is plenty for a client; the
   admin panel and anything that is about to act on membership ask for a fresh one, and any
   change made through the write key clears the lot. Callers get their own copy to sort. */
const albumLists = new Map();
async function albumAssets(albumId, { fresh = false } = {}) {
  const c = albumLists.get(albumId);
  if (!fresh && c) {
    if (c.list && Date.now() - c.at < 60_000) return c.list.slice();
    if (c.pending) return (await c.pending).slice();
  }
  if (albumLists.size > 200) albumLists.clear();
  const p = albumAssetsRaw(albumId).then(
    list => { albumLists.set(albumId, { at: Date.now(), list, pending: null }); return list; },
    e => { if (albumLists.get(albumId)?.pending === p) albumLists.delete(albumId); throw e; });
  albumLists.set(albumId, { at: 0, list: null, pending: p });
  return (await p).slice();
}
async function albumAssetsRaw(albumId) {
  const buckets = await immichJson(`/api/timeline/buckets?albumId=${encodeURIComponent(albumId)}`);
  const out = [];
  for (const b of buckets) {
    const d = await immichJson(
      `/api/timeline/bucket?albumId=${encodeURIComponent(albumId)}&timeBucket=${encodeURIComponent(b.timeBucket)}`);
    const ids = d.id || [];
    for (let i = 0; i < ids.length; i++) {
      out.push({
        id: ids[i],
        ratio: Number(d.ratio?.[i]) || 1.5,
        isImage: d.isImage ? !!d.isImage[i] : true,
        created: d.fileCreatedAt?.[i] ?? null,
      });
    }
  }
  return out;
}

/* Original-file sizes by asset id. The timeline lists carry no sizes; a metadata search does.
   Kept ten minutes: this is for the admin's storage figures, not anything a client waits on. */
const albumSizes = new Map();
async function albumSizeMap(albumId) {
  const c = albumSizes.get(albumId);
  if (c && Date.now() - c.at < 600_000) return c.sizes;
  const sizes = new Map();
  for (let page = 1; page; ) {
    const r = await immichJson('/api/search/metadata', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ albumIds: [albumId], withExif: true, size: 1000, page }),
    });
    for (const x of r.assets?.items || []) sizes.set(x.id, Number(x.exifInfo?.fileSizeInByte) || 0);
    page = r.assets?.nextPage ? Number(r.assets.nextPage) : 0;
  }
  albumSizes.set(albumId, { sizes, at: Date.now() });
  return sizes;
}
/* A photo that sits in two galleries is one file on disk, so the total counts it once. */
async function storageUsage() {
  const all = new Map(), galleries = {};
  let unreadable = 0;
  for (const g of q.gallAll.all()) {
    const own = new Map();
    for (const st of setsOf(g)) {
      try { for (const [id, n] of await albumSizeMap(st.album_id)) own.set(id, n); }
      catch (e) { unreadable++; console.error('storage listing failed', st.id, e.message); }
    }
    galleries[g.id] = { bytes: [...own.values()].reduce((a, n) => a + n, 0), photos: own.size };
    for (const [id, n] of own) all.set(id, n);
  }
  return { totalBytes: [...all.values()].reduce((a, n) => a + n, 0), galleries, unreadable };
}

/* ------------------------------------------------------------------ session */
function sessionFor(req, gallery) {
  const t = cookies(req)[`gs_${gallery.id}`];
  const p = t ? unsign(t) : null;
  return (p && p.g === gallery.id) ? p : null;
}
/* Secure is correct behind the HTTPS proxy, but would make the cookie
   undeliverable when testing over plain http on the LAN. */
function isHttps(req) {
  return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function setSession(res, gallery, regId, req) {
  const exp = Date.now() + CFG.sessionDays * 86400_000;
  const tok = sign({ g: gallery.id, r: regId ?? null, exp });
  res.setHeader('set-cookie',
    `gs_${gallery.id}=${encodeURIComponent(tok)}; Path=/; Max-Age=${CFG.sessionDays * 86400}; HttpOnly; SameSite=Lax` +
    (isHttps(req) ? '; Secure' : ''));
}
/* what still stands between this visitor and the photos */
function gateFor(gallery, sess) {
  if (sess) return null;
  if (gallery.password_hash) return 'password';
  if (gallery.require_email) return 'email';
  return null;
}

/* ------------------------------------------------------------------- routes */
const PLACEHOLDER_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
 stroke="#000" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/>
 <line x1="14.31" y1="8" x2="20.05" y2="17.94"/><line x1="9.69" y1="8" x2="21.17" y2="8"/>
 <line x1="7.38" y1="12" x2="13.12" y2="2.06"/><line x1="9.69" y1="16" x2="3.95" y2="6.06"/>
 <line x1="14.31" y1="16" x2="2.83" y2="16"/><line x1="16.62" y1="12" x2="10.88" y2="21.94"/></svg>`;

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
               '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

async function serveStatic(res, file) {
  try {
    const buf = await readFile(join(CFG.webDir, file));
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream',
                         'cache-control': 'no-store' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
  }
}

/* Pasted into a message, a bare link says nothing. These tags give it the cover,
   the title and the date — the same things the gallery shows before its gate. */
async function serveGalleryPage(res, gallery) {
  let html;
  try { html = await readFile(join(CFG.webDir, 'index.html'), 'utf8'); }
  catch { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  const base = CFG.publicUrl || '';
  const date = prettyDate(gallery.subtitle);
  const desc = date || (CFG.brandName ? `Photographs by ${CFG.brandName}` : 'A private gallery');
  const slug = encodeURIComponent(gallery.slug);
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(gallery.title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:site_name" content="${esc(CFG.brandName || gallery.title)}">`,
    base ? `<meta property="og:image" content="${esc(base)}/api/g/${slug}/cover">` : '',
    base ? `<meta property="og:url" content="${esc(base)}/${slug}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="description" content="${esc(desc)}">`,
  ].filter(Boolean).join('\n');
  html = html.replace('<title>Gallery</title>', `<title>${esc(gallery.title)}</title>\n${tags}`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

/* the public website editor: its own tables, files and routes, see site/ */
const site = createSite({ db, cfg: CFG, json, readJson, adminOk, immich, canUpload, tellAdmin });

const server = createServer(async (req, res) => {
  res.gzOk = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;

  try {
    /* ---- health ---- */
    if (path === '/healthz') return json(res, 200, { ok: true });

    /* ---- mailing: the unsubscribe page and the bounce webhook, both public ---- */
    if (path.startsWith('/mail/img/') && (req.method === 'GET' || req.method === 'HEAD')) return mailImageRoute(req, res, path.slice('/mail/img/'.length));
    if (path.startsWith('/unsubscribe/')) return unsubscribeRoute(req, res, path.slice('/unsubscribe/'.length));
    if (path === '/api/mail/webhook' && req.method === 'POST') return mailWebhook(req, res);

    /* ---- admin (token in header) ---- */
    if (path === '/api/admin/login' && req.method === 'POST') {
      if (tooManyAttempts(`adm:${clientIp(req)}`, 8)) return json(res, 429, { error: 'too_many' });
      const b = await readJson(req);
      q.codeGC.run(Date.now());

      /* step two: the emailed code */
      if (b.challenge) {
        const row = q.codeGet.get(String(b.challenge));
        if (!row || row.expires_at < Date.now()) return json(res, 401, { error: 'code_expired' });
        if (row.tries >= 5) { q.codeDel.run(row.id); return json(res, 429, { error: 'too_many' }); }
        q.codeTry.run(row.id);
        const got = createHmac('sha256', CFG.secret).update(String(b.code || '').trim()).digest('hex');
        if (!constEq(got, row.code_hash)) return json(res, 401, { error: 'bad_code' });
        q.codeDel.run(row.id);
        setAdminCookie(res, req);
        return json(res, 200, { ok: true });
      }

      /* step one: email and password */
      let ok = false, email = '';
      if (b.email !== undefined) {
        email = String(b.email || '').trim().toLowerCase();
        const u = q.admGet.get(email);
        const salt = u ? u.password_salt : 'x'.repeat(32);
        const got  = scryptSync(String(b.password || ''), salt, 32).toString('hex');
        ok = !!u && constEq(got, u.password_hash);
      } else {
        ok = constEq(String(b.token || ''), CFG.adminToken);   /* for API use, never the browser form */
      }
      if (!ok) { console.warn('admin login failed from', clientIp(req)); return json(res, 401, { error: 'bad_login' }); }

      /* second factor, when email works */
      if (CFG.admin2fa && email && mailReady()) {
        const code = String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, '0');
        const id = randomBytes(18).toString('base64url');
        q.codeIns.run(id, email, createHmac('sha256', CFG.secret).update(code).digest('hex'),
                      Date.now() + 10 * 60_000);
        try { await sendLoginCode(email, code); }
        catch (e) {
          console.error('could not send sign-in code:', e.message);
          return json(res, 502, { error: 'Could not send your code. Try again shortly.' });
        }
        return json(res, 200, { step: 'code', challenge: id, sentTo: email.replace(/^(.).*(@.*)$/, '$1\u2022\u2022\u2022$2') });
      }

      setAdminCookie(res, req);
      return json(res, 200, { ok: true });
    }

    if (path === '/api/admin/logout' && req.method === 'POST') {
      res.setHeader('set-cookie', 'adm=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
      return json(res, 200, { ok: true });
    }
    if (path.startsWith('/api/admin/')) {
      if (!adminOk(req)) return json(res, 401, { error: 'unauthorized' });
      return await adminRoutes(req, res, path, url);
    }
    if (path.startsWith('/admin/site-preview/')) return await site.preview(req, res, path);
    if (path === '/admin' || path.startsWith('/admin/')) return await serveStatic(res, 'admin.html');

    /* ---- public gallery api: /api/g/<slug>/... ---- */
    const m = path.match(/^\/api\/g\/([^/]+)(\/.*)?$/);
    if (m) {
      const slug = decodeURIComponent(m[1]).toLowerCase();   /* links in the wild may differ in case */
      const rest = m[2] || '';
      const gallery = q.gallBySlug.get(slug);
      if (!gallery) return json(res, 404, { error: 'not_found' });
      if (!gallery.published_at) return json(res, 404, { error: 'not_found' });
      if (isExpired(gallery)) return json(res, 410, { error: 'expired' });
      return await galleryRoutes(req, res, gallery, rest, url);
    }

    /* Links already sent to clients used Immich's /s/<slug> form. Keep them working. */
    const legacy = path.match(/^\/(?:s|share)\/(.+)$/);
    if (legacy) {
      const slug = decodeURIComponent(legacy[1]).replace(/\/+$/, '');
      res.writeHead(302, { location: '/' + encodeURIComponent(slug) });
      return res.end();
    }

    /* ---- the app shell for every /g/... path ---- */
    /* Drop a brand-logo.png (black artwork on transparent) into the web folder to
       use your own mark; otherwise a neutral aperture is served. */
    if (path === '/favicon.ico' || path === '/brand/logo') {
      /* an operator may supply brand-logo-dark.png (light artwork) for dark UIs */
      const wantDark = url.searchParams.get('theme') === 'dark';
      const darkFile = join(CFG.webDir, 'brand-logo-dark.png');
      const own = (wantDark && existsSync(darkFile)) ? darkFile : join(CFG.webDir, 'brand-logo.png');
      if (existsSync(own)) {
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' });
        return res.end(await readFile(own));
      }
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' });
      return res.end(PLACEHOLDER_MARK);
    }

    /* A gallery is /<slug>. The old /g/<slug> form still works - clients have those
       links in their inboxes - but it moves to the short one. */
    const old = path.match(/^\/g\/([^/]+)\/?$/);
    if (old) {
      res.writeHead(301, { location: '/' + encodeURIComponent(decodeURIComponent(old[1])) });
      return res.end();
    }
    if (path === '/g' || path === '/g/' || path === '/') return await serveStatic(res, 'index.html');

    const bare = path.match(/^\/([^/]+)\/?$/);
    if (bare) {
      const slug = decodeURIComponent(bare[1]).toLowerCase();
      /* only serve the shell for a slug that exists, so a typo still gets a real 404 */
      const g = slugShape(slug) && slugFree(slug) ? q.gallBySlug.get(slug) : null;
      /* only a live gallery gets a preview card; a draft or an expired one stays plain */
      if (g) return (g.published_at && !isExpired(g))
        ? await serveGalleryPage(res, g)
        : await serveStatic(res, 'index.html');
    }

    return await serveStatic(res, path.replace(/^\/+/, '') || 'index.html');
  } catch (e) {
    console.error('request failed:', req.method, path, '-', e?.message || e);
    if (!res.headersSent) return json(res, 502, { error: 'upstream_error', detail: String(e?.message || e) });
    try { res.end(); } catch {}
  }
});

async function galleryRoutes(req, res, gallery, rest, url) {
  const sess = sessionFor(req, gallery);

  /* public descriptor - enough to render the cover and the right gate */
  if (rest === '' || rest === '/') {
    const gate = gateFor(gallery, sess);
    if (!gate && !sess) setSession(res, gallery, null, req);   /* nothing to ask for */
    if (!sess) log(gallery, null, 'landing', null, req);
    return json(res, 200, {
      slug: gallery.slug,
      title: gallery.title,
      subtitle: prettyDate(gallery.subtitle),   /* the client prints it as sent */
      cover: `/api/g/${gallery.slug}/cover`,
      coverFocus: gallery.cover_focus || '50 50',
      /* only when the cover comes from Immich: an uploaded one has no cheaper variant,
         and asking for it twice would be slower, not faster */
      coverSmall: coverPath(gallery) && existsSync(coverPath(gallery))
        ? null : `/api/g/${gallery.slug}/cover?size=thumbnail`,
      allowDownload: !!gallery.allow_download,
      expiresAt: gallery.expires_at,
      /* the client shows these as tabs only when there is more than one */
      sets: setsOf(gallery).map(x => ({ id: x.id, name: x.name })),
      gate,
      unlocked: !gate,
      brand: {
        name: CFG.brandName || null,
        url: CFG.brandUrl || null,
        social: CFG.brandSocial || null,
        socialLabel: CFG.brandSocialLabel || null,
      },
    });
  }

  /* the cover is visible before the gate, like Pixieset */
  if (rest === '/cover') {
    /* an uploaded cover wins: it is deliberately not one of the album's photos */
    const fp = coverPath(gallery);
    if (fp && existsSync(fp)) {
      const buf = await readFile(fp);
      res.writeHead(200, { 'content-type': COVER_MIME[extname(fp).toLowerCase()] || 'application/octet-stream',
                           'content-length': buf.length, 'cache-control': 'private, max-age=300' });
      return res.end(req.method === 'HEAD' ? undefined : buf);
    }
    let id = gallery.cover_asset_id;
    if (id && !(await galleryHas(gallery, id))) id = null;   /* never serve something outside the gallery */
    /* a video's thumbnail works as a cover too, so fall back to whatever comes first */
    if (!id) id = await firstAsset(gallery);
    if (!id) { res.writeHead(404); return res.end(); }
    /* a client stares at nothing until the cover lands, so the small one is offered
       first and the full one swapped in behind it */
    const small = url.searchParams.get('size') === 'thumbnail';
    return proxyImage(req, res, id, small ? 'thumbnail' : 'preview', 'private, max-age=300');
  }

  if (rest === '/unlock' && req.method === 'POST') {
    const key = `${clientIp(req)}:${gallery.id}`;
    if (tooManyAttempts(key)) return json(res, 429, { error: 'too_many' });
    const body = await readJson(req);
    if (!gallery.password_hash) return json(res, 400, { error: 'no_password' });
    if (!pwMatches(gallery, body.password)) {
      log(gallery, null, 'password_fail', null, req);
      return json(res, 401, { error: 'bad_password' });
    }
    /* password satisfied; if the gallery also wants an email, ask next */
    if (gallery.require_email) {
      const tok = sign({ g: gallery.id, pw: 1, exp: Date.now() + 30 * 60_000 });
      res.setHeader('set-cookie',
        `gp_${gallery.id}=${encodeURIComponent(tok)}; Path=/; Max-Age=1800; HttpOnly; SameSite=Lax` +
        (isHttps(req) ? '; Secure' : ''));
      log(gallery, null, 'password_ok', null, req);
      return json(res, 200, { gate: 'email' });
    }
    setSession(res, gallery, null, req);
    log(gallery, null, 'unlock', null, req);
    return json(res, 200, { gate: null });
  }

  if (rest === '/register' && req.method === 'POST') {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'bad_email' });
    /* if the gallery also has a password, it must already have been cleared */
    if (gallery.password_hash) {
      const p = unsign(cookies(req)[`gp_${gallery.id}`] || '');
      if (!p || p.g !== gallery.id || !p.pw) return json(res, 401, { error: 'password_required' });
    }
    let reg = q.regGet.get(gallery.id, email);
    if (!reg) {
      q.regIns.run(gallery.id, email, String(body.name || '').slice(0, 120) || null);
      reg = q.regGet.get(gallery.id, email);
      log(gallery, reg.id, 'register', null, req);
    } else {
      log(gallery, reg.id, 'return', null, req);
    }
    setSession(res, gallery, reg.id, req);
    return json(res, 200, { gate: null });
  }

  /* everything below needs a session - unless the gallery asks nothing of visitors */
  const open = gateFor(gallery, null) === null;
  const who = sess || (open ? { g: gallery.id, r: null } : null);
  if (!who) return json(res, 401, { error: 'gate', gate: gateFor(gallery, null) });

  if (rest === '/assets') {
    const sets = setsOf(gallery);
    if (!sets.length) return json(res, 200, { setId: null, assets: [] });
    const asked = Number(url.searchParams.get('set') || 0);
    const set = sets.find(x => x.id === asked) || sets[0];
    const list = await albumAssets(set.album_id);
    /* Immich hands them back newest first; chronological is the other way round */
    if (gallery.sort_order === 'oldest') list.reverse();
    log(gallery, who.r, 'view', null, req);
    return json(res, 200, { setId: set.id, assets: list });
  }

  if (rest === '/favourites') {
    if (req.method === 'GET')
      return json(res, 200, { ids: who.r ? q.favMine.all(who.r).map(x => x.asset_id) : [], named: !!who.r });

    if (req.method === 'POST') {
      /* a pick needs a name against it, so an open gallery asks who is choosing */
      if (!who.r) return json(res, 401, { error: 'who', gate: 'email' });
      const b = await readJson(req);
      const id = String(b.assetId || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: 'bad_asset' });
      if (!(await galleryHas(gallery, id))) return json(res, 404, { error: 'not_found' });
      if (b.on === false) q.favDel.run(who.r, id);
      else { q.favAdd.run(gallery.id, who.r, id); log(gallery, who.r, 'favourite', id, req); }
      return json(res, 200, { on: b.on !== false, count: q.favCount.get(who.r).n });
    }
  }

  const img = rest.match(/^\/img\/([0-9a-f-]{36})$/i);
  if (img) {
    if (!(await galleryHas(gallery, img[1]))) {
      log(gallery, who.r, 'asset_denied', img[1], req);
      return json(res, 404, { error: 'not_found' });
    }
    const size = url.searchParams.get('size') || 'thumbnail';
    if (size === 'original' || size === 'web') {
      if (!gallery.allow_download) return json(res, 403, { error: 'download_disabled' });
      log(gallery, who.r, 'download', img[1], req);
    }
    /* the full-quality file played in the browser: it is the original's bytes, so it follows
       the download rule; with downloads off the client only gets the lighter `video` stream */
    if (size === 'video-orig' && !gallery.allow_download) return json(res, 403, { error: 'download_disabled' });
    /* `video` is playback, not a download: it is never gated, and a single viewing
       makes many range requests, so logging each one would bury the activity log */
    return proxyImage(req, res, img[1], size);
  }

  if (rest === '/zip' && req.method === 'POST') {
    if (!gallery.allow_download) return json(res, 403, { error: 'download_disabled' });
    const sets = setsOf(gallery);
    const only = sets.find(x => x.id === Number(url.searchParams.get('set') || 0));
    const picks = url.searchParams.get('picks') === '1' && !!who.r;
    const wantIds = url.searchParams.get('ids');
    const key = clientKey(gallery, who, req);

    /* a whole set is prepared ahead and served as a file; a selection is built as it is sent */
    const whole = !picks && !wantIds && (only || (sets.length === 1 ? sets[0] : null));
    let spec;
    if (CFG.prezip && whole) {
      if (!(await albumInfo(whole.album_id)).ids.size) return json(res, 400, { error: 'nothing_selected' });
      spec = { kind: 'set', setId: whole.id, name: zipFileName(gallery, whole, sets) };
    } else {
      let list = only ? await albumAssets(only.album_id) : await allAssets(gallery);
      if (picks) {
        const mine = new Set(q.favMine.all(who.r).map(x => x.asset_id));
        list = (await allAssets(gallery)).filter(a => mine.has(a.id));
      } else if (wantIds) {
        /* a hand-picked batch: only ids this gallery actually holds */
        const want = new Set(String(wantIds).split(',').filter(x => /^[0-9a-f-]{36}$/i.test(x)));
        list = (await allAssets(gallery)).filter(a => want.has(a.id));
      }
      if (!list.length) return json(res, 400, { error: 'nothing_selected' });
      spec = { kind: 'adhoc', ids: list.map(a => a.id),
               name: zipFileName(gallery, only, sets, picks ? 'favourites' : wantIds ? 'selection' : '') };
    }
    const t = zipQueue.request(key, spec);
    return json(res, 200, await zipInfo(gallery, t.id, key));
  }

  if (rest === '/zip/status' && req.method === 'GET') {
    const info = await zipInfo(gallery, String(url.searchParams.get('t') || ''), clientKey(gallery, who, req));
    return info ? json(res, 200, info) : json(res, 404, { error: 'gone' });
  }

  if (rest === '/zip' && req.method === 'DELETE') {
    zipQueue.cancel(String(url.searchParams.get('t') || ''), clientKey(gallery, who, req));
    return json(res, 200, { ok: true });
  }

  const zset = rest.match(/^\/zip\/set\/(\d+)$/);
  if (zset && (req.method === 'GET' || req.method === 'HEAD')) {
    const st = setsOf(gallery).find(x => x.id === Number(zset[1]));
    if (!st) return json(res, 404, { error: 'not_found' });
    return sendZipSet(req, res, gallery, st, who, url);
  }

  const ztick = rest.match(/^\/zip\/t\/([0-9a-f]{24})$/);
  if (ztick && req.method === 'GET') return sendZipAdhoc(req, res, gallery, who, ztick[1]);

  return json(res, 404, { error: 'not_found' });
}

async function proxyImage(req, res, assetId, size, cache) {
  /* `web` is the preview Immich already made: a few hundred KB instead of twenty
     megabytes, which is what someone on a phone actually wants to keep */
  const want = size === 'web' ? 'preview' : size;
  const path = want === 'video'
    ? `/api/assets/${assetId}/video/playback`          /* the stream a browser can actually play */
    : want === 'original' || want === 'video-orig'
      ? `/api/assets/${assetId}/original`
      : `/api/assets/${assetId}/thumbnail?size=${encodeURIComponent(want)}`;

  /* Carry the browser's Range through. Without it a video comes back as one
     unseekable response that the player has to swallow whole before it starts —
     which, for a file of any size, looks exactly like a gallery that won't load. */
  const range = req.headers.range;
  const up = await immich(path, range ? { headers: { range } } : {});
  if (!up.ok) { res.writeHead(up.status); return res.end(); }

  const headers = {
    'content-type': up.headers.get('content-type') || 'application/octet-stream',
    /* an asset's bytes never change for its id, so a repeat visit need not even ask.
       A cover is addressed by the gallery, not the asset, and can be swapped. */
    /* a video's encoded copy is replaced when the owner changes Immich's transcoding, so it is
       always revalidated rather than pinned for a day */
    'cache-control': cache || (want === 'video' || want === 'video-orig' ? 'private, no-cache' : 'private, max-age=86400, immutable'),
    'accept-ranges': up.headers.get('accept-ranges') || 'bytes',
  };
  for (const h of ['content-disposition', 'content-length', 'content-range']) {
    const v = up.headers.get(h); if (v) headers[h] = v;
  }
  if (size === 'web') headers['content-disposition'] = 'attachment';   /* a preview, offered as a file */
  if (size === 'video-orig') delete headers['content-disposition'];    /* it plays inline, not as a save */
  for (const h of ['etag', 'last-modified']) { const v = up.headers.get(h); if (v) headers[h] = v; }
  res.writeHead(up.status, headers);
  if (req.method === 'HEAD') return res.end();

  const reader = up.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || res.destroyed) break;
      /* respect backpressure, or a large file is buffered in memory on the way out */
      if (!res.write(Buffer.from(value))) await waitDrain(res);
    }
  } catch { /* the viewer closed the tab or skipped ahead */ }
  try { await reader.cancel(); } catch {}
  if (!res.destroyed) res.end();
}

/* ------------------------------------------------------------ prepared downloads
   A set's zip is built ahead of time, kept on disk and served as a plain file (so a
   dropped phone connection resumes). A queue in front of every full-size download keeps
   the home uplink from being split twenty ways: a few run at speed, the rest wait. */
const ZIP_DIR = CFG.zipDir || join(CFG.dataDir, 'zips');
if (CFG.prezip && !existsSync(ZIP_DIR)) mkdirSync(ZIP_DIR, { recursive: true });
const ZIP_FILE = /^\.?\d+-[0-9a-f]{16}\.zip(\.part)?$/;
const zipPath = f => join(ZIP_DIR, f);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const zipQueue = new DownloadQueue({
  maxActive: CFG.zipMaxActive, stallMs: CFG.zipStallSec * 1000,
  isReady: spec => spec.kind !== 'set' || zipFresh(spec.setId),
  onChange: () => noteLoad(),
});
/* remember the busiest moment of each hour; writes only when a new high is reached */
let loadPeak = { hour: '', active: 0, waiting: 0 };
function noteLoad() {
  const active = zipQueue.slots.size;
  const waiting = zipQueue.tickets.length;
  const hour = new Date().toISOString().slice(0, 13);
  if (loadPeak.hour !== hour) loadPeak = { hour, active: 0, waiting: 0 };
  if (active <= loadPeak.active && waiting <= loadPeak.waiting) return;
  loadPeak.active = Math.max(loadPeak.active, active); loadPeak.waiting = Math.max(loadPeak.waiting, waiting);
  try { q.peakPut.run(hour, loadPeak.active, loadPeak.waiting); } catch (e) { console.error('peak:', e.message); }
}
function recordDl(gallery, kind, slot, sent, t0, resume, complete) {
  try { q.dlIns.run(gallery.id, kind, sent, Date.now() - t0, slot.waited || 0, resume ? 1 : 0, complete ? 1 : 0); }
  catch (e) { console.error('download stats:', e.message); }
}
const zipBuild = { todo: [], running: null, busy: false };
const zipReaders = new Map();      /* file -> downloads reading it now */
const zipDeferred = new Set();     /* replaced files waiting for their readers to finish */
const zipGrants = new Map();       /* client -> the zip it was last let download, for resuming */

const fingerprintOf = ids => createHash('sha256').update([...ids].sort().join(',')).digest('hex');

/* the album's current photo ids, from the same short-lived cache the image gate uses */
async function albumInfo(albumId) {
  let c = albumSets.get(albumId);
  if (!c || Date.now() - c.at > 120_000) {
    const list = await albumAssets(albumId);
    c = { ids: new Set(list.map(a => a.id)), at: Date.now() };
    albumSets.set(albumId, c);
  }
  c.fp ??= fingerprintOf(c.ids);
  return c;
}

function zipUnlink(file) {
  if (!file) return;
  if (zipReaders.get(file)) { zipDeferred.add(file); return; }   /* someone is mid-download: let them finish */
  try { unlinkSync(zipPath(file)); } catch {}
}
function readerOpen(file) { zipReaders.set(file, (zipReaders.get(file) || 0) + 1); }
function readerClose(file) {
  const n = (zipReaders.get(file) || 1) - 1;
  if (n > 0) { zipReaders.set(file, n); return; }
  zipReaders.delete(file);
  if (zipDeferred.delete(file)) zipUnlink(file);
}

const zipWanted = g => CFG.prezip && !!g.published_at && !isExpired(g) && !!g.allow_download;
const zipHasFile = z => !!(z && z.status === 'ready' && z.file && existsSync(zipPath(z.file)));
/* quick and synchronous, for the queue: is a finished, up-to-date file there? */
function zipFresh(setId) {
  const z = q.zipBySet.get(setId);
  if (!zipHasFile(z)) return false;
  const st = q.setById.get(setId);
  const c = st && albumSets.get(st.album_id);
  return !c?.fp || c.fp === z.fingerprint;
}

function zipRequestBuild(setId, urgent) {
  const at = zipBuild.todo.findIndex(x => x.setId === setId);
  if (at >= 0) { if (urgent) { const [x] = zipBuild.todo.splice(at, 1); zipBuild.todo.unshift(x); } }
  else if (zipBuild.running?.setId !== setId) zipBuild.todo[urgent ? 'unshift' : 'push']({ setId });
  zipWork();
}
async function zipWork() {
  if (zipBuild.busy) return;
  zipBuild.busy = true;
  try {
    while (zipBuild.todo.length) {
      const { setId } = zipBuild.todo.shift();
      try { await buildSetZip(setId); } catch (e) { console.error('zip build:', e.message); }
      zipQueue.tick();
    }
  } finally { zipBuild.busy = false; }
}

function pickName(cd, fallback) {
  let n = '';
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd || '');
  if (star) { try { n = decodeURIComponent(star[1]); } catch {} }
  if (!n) { const m = /filename\s*=\s*"?([^";]+)"?/i.exec(cd || ''); if (m) n = m[1]; }
  n = n.replace(/[\\/\x00-\x1f]/g, '_').trim();
  return n || fallback;
}
function uniqueName(used, name) {
  const dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  let n = name, i = 2;
  while (used.has(n.toLowerCase())) n = `${base} (${i++})${ext}`;
  return n;
}

/* Keep the folder under its budget by dropping the zips nobody has used for longest.
   An evicted zip is built again only if a client asks for it. */
function zipEnsureSpace(need, keepSetId) {
  const rows = q.zipEvery.all().filter(z => z.status === 'ready' && z.file);
  let used = rows.reduce((n, z) => n + (z.bytes || 0), 0);
  const free = () => { try { const f = statfsSync(ZIP_DIR); return f.bavail * f.bsize; } catch { return Infinity; } };
  let room = free();
  const over = () => used + need > CFG.zipMaxGb * 1e9 || room - need < CFG.zipMinFreeGb * 1e9;
  const order = rows.filter(z => z.set_id !== keepSetId && !zipReaders.get(z.file))
    .sort((a, b) => String(a.last_used_at || a.built_at).localeCompare(String(b.last_used_at || b.built_at)));
  while (over() && order.length) {
    const z = order.shift();
    zipUnlink(z.file);
    q.zipGone.run('evicted', Date.now(), z.set_id);
    used -= z.bytes || 0; room += z.bytes || 0;
    console.log(`zip: evicted ${z.slug} / ${z.set_name} to make room`);
  }
  if (over()) throw new Error('over_budget');
}

async function buildSetZip(setId) {
  const st = q.setById.get(setId), g = st && q.gallById.get(st.gallery_id);
  if (!g || !zipWanted(g)) return;
  q.zipEnsure.run(g.id, st.id);
  const before = q.zipBySet.get(st.id);
  const ctl = new AbortController();
  const run = zipBuild.running = { setId, done: 0, total: 0, ctl };
  if (!zipHasFile(before)) q.zipState.run('building', null, Date.now(), st.id);
  const t0 = Date.now();
  let fh, part, name;
  try {
    const list = await albumAssets(st.album_id, { fresh: true });
    if (!list.length) throw new Error('empty set');
    const fp = fingerprintOf(list.map(a => a.id));
    /* the gate and the serve check read this cache: keep it in step with what is being zipped */
    albumSets.set(st.album_id, { ids: new Set(list.map(a => a.id)), at: Date.now(), fp });
    const sizes = await albumSizeMap(st.album_id).catch(() => new Map());
    run.total = list.reduce((n, a) => n + (sizes.get(a.id) || 0), 0);
    zipEnsureSpace(run.total * 1.01 + 1e6, st.id);

    name = `${st.id}-${randomBytes(8).toString('hex')}.zip`;
    part = zipPath('.' + name + '.part');
    fh = await openFile(part, 'w+');
    const w = createZipWriter(fh);
    const used = new Set();
    for (const a of list) {
      let lastErr = null, ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        if (ctl.signal.aborted) throw new Error('aborted');
        const pc = new AbortController();
        const stop = () => pc.abort();
        ctl.signal.addEventListener('abort', stop, { once: true });
        let idle;
        const arm = () => { clearTimeout(idle); idle = setTimeout(stop, 60_000); };
        try {
          arm();
          const r = await immich(`/api/assets/${a.id}/original`, { signal: pc.signal });
          if (!r.ok) throw new Error(`immich ${r.status} for ${a.id}`);
          const fname = uniqueName(used, pickName(r.headers.get('content-disposition'), a.id));
          const len = Number(r.headers.get('content-length'));
          let got = 0;
          const body = (async function* () {
            for await (const chunk of r.body) { arm(); got += chunk.length; yield chunk; }
          })();
          const { size } = await w.addEntry(fname, a.created ? new Date(a.created) : new Date(), len, body);
          used.add(fname.toLowerCase());
          run.done += size;
          ok = true;
        } catch (e) {
          lastErr = ctl.signal.aborted ? new Error('aborted') : e;
          if (ctl.signal.aborted) throw lastErr;
          await sleep(1000 * (attempt + 1));
        } finally { clearTimeout(idle); ctl.signal.removeEventListener('abort', stop); }
      }
      if (!ok) throw lastErr;
    }
    const bytes = await w.finish();
    await fh.sync(); await fh.close(); fh = null;
    if (ctl.signal.aborted) throw new Error('aborted');
    renameSync(part, zipPath(name)); part = null;
    const old = q.zipBySet.get(st.id);
    const row = q.zipReady.run(name, fp, list.length, bytes, Date.now(), st.id);
    if (!row.changes) { zipUnlink(name); return; }            /* the set was removed while this ran */
    if (old?.file && old.file !== name) zipUnlink(old.file);
    console.log(`zip: ${g.slug} / ${st.name}: ${list.length} photos, ${(bytes / 1e9).toFixed(2)} GB in ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    try { await fh?.close(); } catch {}
    if (part) { try { unlinkSync(part); } catch {} }
    const cur = q.zipBySet.get(st.id);
    if (cur) {
      const keep = zipHasFile(cur);
      if (e.message === 'aborted') { if (!keep) q.zipState.run('none', null, Date.now(), st.id); }
      else {
        if (!keep) q.zipState.run('failed', e.message.slice(0, 200), Date.now(), st.id);
        console.error(`zip: ${g.slug} / ${st.name} failed: ${e.message}`);
      }
    }
  } finally { zipBuild.running = null; }
}

/* Every few minutes: build what is missing, rebuild what changed once the photographer has
   stopped adding, and drop the zips of anything that is no longer shared. */
let zipSweeping = false, zipSweepTimer = null;
async function zipSweep() {
  if (!CFG.prezip || zipSweeping) return;
  zipSweeping = true;
  try {
    for (const g of q.gallAll.all()) {
      if (!zipWanted(g)) { dropZips(g.id); continue; }
      for (const st of setsOf(g)) {
        q.zipEnsure.run(g.id, st.id);
        const z = q.zipBySet.get(st.id);
        if (z.status === 'building' || z.status === 'evicted') continue;
        if (z.status === 'failed' && Date.now() - z.updated_at < 3600_000) continue;
        let info;
        try { info = await albumInfo(st.album_id); } catch { continue; }
        if (!info.ids.size) continue;
        if (!zipHasFile(z)) { zipRequestBuild(st.id, false); continue; }
        if (z.fingerprint === info.fp) continue;
        /* the album changed: wait until it has held still, since photos arrive in batches */
        if (z.seen_fp !== info.fp) q.zipSeen.run(info.fp, Date.now(), st.id);
        else if (Date.now() - z.seen_at >= CFG.zipSettleMin * 60_000) zipRequestBuild(st.id, false);
      }
    }
    zipCleanOrphans();
  } finally { zipSweeping = false; }
}
function zipArmSweep() {
  clearTimeout(zipSweepTimer);
  zipSweepTimer = setTimeout(() => zipSweep().catch(e => console.error('zip sweep:', e.message)), 60_000);
}

/* files nothing refers to: leftovers from a crash or a removed gallery */
function zipCleanOrphans(boot) {
  let names; try { names = readdirSync(ZIP_DIR); } catch { return; }
  const keep = new Set(q.zipEvery.all().map(z => z.file).filter(Boolean));
  for (const f of names) {
    if (!ZIP_FILE.test(f)) continue;                              /* never touch anything else in the folder */
    if (f.endsWith('.part')) { if (boot) { try { unlinkSync(zipPath(f)); } catch {} } continue; }
    if (!keep.has(f) && !zipReaders.get(f) && !zipDeferred.has(f)) { try { unlinkSync(zipPath(f)); } catch {} }
  }
}
function zipRecover() {
  if (!CFG.prezip) return;
  for (const z of q.zipEvery.all()) {
    if (z.status === 'building') q.zipState.run('none', null, Date.now(), z.set_id);
    else if (z.status === 'ready' && !zipHasFile(z)) q.zipGone.run('none', Date.now(), z.set_id);
  }
  zipCleanOrphans(true);
}

/* forget a gallery's (or one set's) zips: unshared, deleted, or no longer allowed to download */
function dropZips(gid, setId, status) {
  const rows = setId ? [q.zipBySet.get(setId)].filter(Boolean) : q.zipForGallery.all(gid);
  for (const z of rows) {
    if (zipBuild.running?.setId === z.set_id) zipBuild.running.ctl.abort();
    zipBuild.todo = zipBuild.todo.filter(x => x.setId !== z.set_id);
    zipUnlink(z.file);
    if (status) q.zipGone.run(status, Date.now(), z.set_id);
    else q.zipDelSet.run(z.set_id);
  }
}

/* ---- serving ---- */
function clientKey(gallery, who, req) {
  if (who.r) return `g${gallery.id}:r${who.r}`;
  const tok = cookies(req)[`gs_${gallery.id}`] || '';
  return `g${gallery.id}:a${createHash('sha256').update(tok + '|' + clientIp(req)).digest('hex').slice(0, 16)}`;
}
const zipDisposition = name => {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};
const zipFileName = (g, st, sets, extra) => {
  const base = [g.title, sets.length > 1 && st ? st.name : '', extra].filter(Boolean).join(' - ');
  return (base.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '').trim() || g.slug) + '.zip';
};

/* bytes per second one download may use right now; 0 means no limit */
function zipRate() {
  const total = CFG.zipTotalMbit * 125_000, cap = CFG.zipRateMbit * 125_000;
  const share = total ? total / Math.max(1, zipQueue.slots.size) : 0;
  return cap ? (share ? Math.min(cap, share) : cap) : share;
}
function waitDrain(res, dead) {
  return new Promise(resolve => {
    const done = () => { clearInterval(iv); res.off('drain', done); res.off('close', done); resolve(); };
    const iv = setInterval(() => { if (dead?.()) { res.destroy(); done(); } }, 5000);
    res.once('drain', done); res.once('close', done);
  });
}
/* write a stream to the client at the allowed pace, never faster than the client takes it */
async function pump(res, source, slot) {
  let sent = 0, next = Date.now();
  for await (const chunk of source) {
    if (res.destroyed || slot?.expired) break;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (!res.write(buf)) await waitDrain(res, () => slot?.expired);
    sent += buf.length;
    if (slot) zipQueue.progress(slot);
    const bps = zipRate();
    if (bps) {
      next = Math.max(next, Date.now()) + buf.length / bps * 1000;
      const wait = next - Date.now();
      if (wait > 5) await sleep(Math.min(wait, 2000));
    }
  }
  return sent;
}

function parseRange(h, size) {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(h).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;           /* several ranges, or nonsense: send it all */
  let start, end;
  if (m[1] === '') { const n = Number(m[2]); if (!n) return 'bad'; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  return start >= size || start > end ? 'bad' : { start, end };
}

/* where one set's zip stands for a client right now, starting a build if it is missing or stale */
async function zipView(st) {
  const z = q.zipBySet.get(st.id) || (q.zipEnsure.run(st.gallery_id, st.id), q.zipBySet.get(st.id));
  const running = zipBuild.running?.setId === st.id ? zipBuild.running : null;
  let info; try { info = await albumInfo(st.album_id); } catch { info = null; }
  if (zipHasFile(z) && (!info || z.fingerprint === info.fp)) return { state: 'ready', z };
  if (!running && !zipBuild.todo.some(x => x.setId === st.id)) {
    if (z.status === 'failed' && Date.now() - z.updated_at < 300_000) return { state: 'adhoc', z };
    zipRequestBuild(st.id, true);
  }
  return { state: 'building', z, progress: running ? { done: running.done, total: running.total } : null };
}

/* what the page needs to show: its place in line, or the link to start */
async function zipInfo(g, id, key) {
  let s = zipQueue.status(id, key);
  if (!s) return null;
  let view = null;
  if (s.spec.kind === 'set') {
    const st = q.setById.get(s.spec.setId);
    view = st && await zipView(st);
    if (!st || view.state === 'adhoc') {
      /* could not be prepared ahead: fall back to building it as it is sent */
      const ids = st ? [...(await albumInfo(st.album_id)).ids] : [];
      zipQueue.request(key, { kind: 'adhoc', ids, name: s.spec.name });
      s = zipQueue.status(id, key); view = null;
      if (!s) return null;
    }
  }
  const spec = s.spec, set = spec.kind === 'set';
  const out = { ticket: id, active: s.active, maxActive: s.maxActive, position: s.position, ahead: s.ahead,
                name: spec.name, resumable: set, building: null, url: null, bytes: null };
  if (s.state === 'reserved') {
    out.state = 'ready';
    out.url = set ? `zip/set/${spec.setId}?t=${id}&v=${(view.z.fingerprint || '').slice(0, 8)}` : `zip/t/${id}`;
    out.bytes = set ? view.z.bytes : null;
  } else if (set && view.state === 'building') {
    out.state = 'building'; out.building = view.progress;
  } else out.state = 'queued';
  return out;
}

async function sendZipSet(req, res, gallery, st, who, url) {
  if (!gallery.allow_download) return json(res, 403, { error: 'download_disabled' });
  const z = q.zipBySet.get(st.id);
  if (!zipHasFile(z)) return json(res, 409, { error: 'not_ready' });
  const size = z.bytes, file = z.file;
  const etag = `"z${z.id}-${(z.fingerprint || '').slice(0, 16)}-${size}"`;
  const key = clientKey(gallery, who, req);
  const spec = { kind: 'set', setId: st.id };

  let range = parseRange(req.headers.range, size);
  if (range && req.headers['if-range'] && req.headers['if-range'] !== etag) range = null;   /* changed since: start over */
  if (range === 'bad') { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
  const name = zipFileName(gallery, st, setsOf(gallery));
  const base = {
    'content-type': 'application/zip', 'content-disposition': zipDisposition(name),
    'accept-ranges': 'bytes', etag, 'cache-control': 'private, no-store', 'x-accel-buffering': 'no',
  };
  const a = range ? range.start : 0, b = range ? range.end : size - 1;
  const head = { ...base, 'content-length': b - a + 1, ...(range ? { 'content-range': `bytes ${a}-${b}/${size}` } : {}) };
  if (req.method === 'HEAD') { res.writeHead(range ? 206 : 200, head); return res.end(); }

  const tk = url.searchParams.get('t') || '';
  let slot = tk ? zipQueue.claim(tk, key) : null;
  if (!slot) {
    const gr = zipGrants.get(key);
    if (range && range.start > 0 && gr && gr.zipId === z.id && Date.now() - gr.at < 86_400_000) slot = zipQueue.resume(key, spec);
  }
  if (!slot && !tk) slot = zipQueue.claimDirect(key, spec);
  if (!slot) return tk ? json(res, 410, { error: 'ticket_expired' })
                       : json(res, 503, { error: 'busy' }, { 'retry-after': '30' });
  let opened = false;
  const finish = () => { zipQueue.release(slot); if (opened) readerClose(file); opened = false; };
  try {
    let info = null; try { info = await albumInfo(st.album_id); } catch { finish(); return json(res, 503, { error: 'immich_unavailable' }); }
    if (info.fp !== z.fingerprint) { finish(); zipRequestBuild(st.id, true); return json(res, 409, { error: 'stale' }); }
    readerOpen(file); opened = true;
    zipGrants.set(key, { zipId: z.id, at: Date.now() });
    if (zipGrants.size > 500) for (const [k, v] of zipGrants) if (Date.now() - v.at > 86_400_000) zipGrants.delete(k);
    q.zipUsed.run(z.id);
    if (!range || range.start === 0) log(gallery, who.r, 'download_all', null, req, [...info.ids]);
    res.writeHead(range ? 206 : 200, head);
    const t0 = Date.now();
    const sent = await pump(res, createReadStream(zipPath(file), { start: a, end: b, highWaterMark: 262144 }), slot);
    recordDl(gallery, 'zip', slot, sent, t0, range && range.start > 0, sent >= b - a + 1);
    console.log(`zip: ${gallery.slug} sent ${(sent / 1e6).toFixed(0)} of ${((b - a + 1) / 1e6).toFixed(0)} MB in ${Math.round((Date.now() - t0) / 1000)}s${sent < b - a + 1 ? ' (stopped early)' : ''}`);
    if (!res.destroyed) res.end();
  } catch (e) {
    console.error('zip send:', e.message);
    if (!res.headersSent) json(res, 500, { error: 'send_failed' }); else res.destroy();
  } finally { finish(); }
}

/* a selection (favourites, hand-picked) cannot be prepared ahead, so Immich builds it as it goes */
async function sendZipAdhoc(req, res, gallery, who, id) {
  const key = clientKey(gallery, who, req);
  const slot = zipQueue.claim(id, key);
  if (!slot) return json(res, 410, { error: 'ticket_expired' });
  try {
    if (slot.spec.kind !== 'adhoc') return json(res, 400, { error: 'wrong_kind' });
    log(gallery, who.r, 'download_all', null, req, slot.spec.ids);
    const up = await immich('/api/download/archive', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetIds: slot.spec.ids }),
    });
    if (!up.ok) return json(res, 502, { error: 'immich_failed' });
    res.writeHead(200, {
      'content-type': 'application/zip', 'content-disposition': zipDisposition(slot.spec.name || `${gallery.slug}.zip`),
      'cache-control': 'private, no-store', 'x-accel-buffering': 'no',
      ...(up.headers.get('content-length') ? { 'content-length': up.headers.get('content-length') } : {}),
    });
    const t0 = Date.now();
    const sent = await pump(res, up.body, slot);
    const want = Number(up.headers.get('content-length')) || 0;
    recordDl(gallery, 'adhoc', slot, sent, t0, false, !res.destroyed && (!want || sent >= want));
    if (!res.destroyed) res.end();
  } catch (e) {
    console.error('zip adhoc:', e.message);
    if (!res.headersSent) json(res, 500, { error: 'send_failed' }); else res.destroy();
  } finally { zipQueue.release(slot); }
}

const zipAdminDto = z => ({ setId: z.set_id, status: z.status, bytes: z.bytes, assets: z.assets, builtAt: z.built_at,
  lastUsedAt: z.last_used_at, served: z.served, error: z.error,
  building: zipBuild.running?.setId === z.set_id ? { done: zipBuild.running.done, total: zipBuild.running.total } : null });

async function setsDto(g) {
  const out = [];
  for (const st of q.setsFor.all(g.id)) {
    let n = 0;
    try { n = (await albumAssets(st.album_id)).length; } catch {}
    out.push({ id: st.id, name: st.name, albumId: st.album_id, count: n });
  }
  return out;
}

function gallDto(g) {
  return {
    id: g.id, slug: g.slug, title: g.title, subtitle: g.subtitle, subtitleText: prettyDate(g.subtitle),
    albumId: g.album_id, coverAssetId: g.cover_asset_id, coverFile: g.cover_file || null,
    coverFocus: g.cover_focus || '50 50', sortOrder: g.sort_order === 'oldest' ? 'oldest' : 'newest',
    sets: q.setsFor.all(g.id).map(x => ({ id: x.id, name: x.name, albumId: x.album_id })),
    requireEmail: !!g.require_email, hasPassword: !!g.password_hash,
    allowDownload: !!g.allow_download, expiresAt: g.expires_at,
    publishedAt: g.published_at, expired: isExpired(g),
    registrations: q.regCount.get(g.id).n,
    views: q.evCount1.get(g.id, 'view').n,
    downloads: q.evCount1.get(g.id, 'download').n + q.evCount1.get(g.id, 'download_all').n,
    zips: q.zipForGallery.all(g.id).map(zipAdminDto),
  };
}

async function adminRoutes(req, res, path, url) {
  if (path === '/api/admin/site' || path.startsWith('/api/admin/site/')) return site.admin(req, res, path, url);
  if (path === '/api/admin/overview' && req.method === 'GET')
    return json(res, 200, overview(db, { now: Date.now(), site: site.summary(), mailReady: mailReady(),
                                         backups: backupList(), publicUrl: CFG.publicUrl,
                                         extraHealth: watchdogHealth() }));
  if (path === '/api/admin/health' && req.method === 'GET') return json(res, 200, watchdog.summary());

  if (path === '/api/admin/usage' && req.method === 'GET') {
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const t = q.dlTotals.get(`-${days} days`);
    const peaks = q.peaksSince.all(new Date(Date.now() - days * 86400_000).toISOString().slice(0, 13));
    return json(res, 200, {
      days, downloads: t.downloads, bytes: t.bytes, waited: t.waited,
      avgWaitMs: Math.round(t.avgWait), maxWaitMs: t.maxWait, totalMbit: CFG.zipTotalMbit, maxActive: CFG.zipMaxActive,
      byGallery: q.dlByGallery.all(`-${days} days`),
      peak: { active: Math.max(0, ...peaks.map(x => x.active)), waiting: Math.max(0, ...peaks.map(x => x.waiting)) },
      backedUpHours: peaks.filter(x => x.waiting > 0).length,
      busiest: [...peaks].sort((a, b) => (b.active + b.waiting) - (a.active + a.waiting)).slice(0, 3),
    });
  }
  if (path === '/api/admin/me')
    return json(res, 200, { ok: true, publicUrl: CFG.publicUrl || null, brandName: CFG.brandName || null,
                            canUpload: canUpload(), uploadMaxMb: CFG.uploadMaxMb,
                            uploadMaxVideoMb: CFG.uploadMaxVideoMb,
                            defaultSort: (q.setGet.get('default_sort') || {}).value === 'oldest' ? 'oldest' : 'newest',
                            caps: await writeCaps() });

  /* sets: the named parts of a gallery, each one an Immich album */
  const setsM = path.match(/^\/api\/admin\/galleries\/(\d+)\/sets$/);
  if (setsM) {
    const g = q.gallById.get(Number(setsM[1]));
    if (!g) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET') return json(res, 200, { sets: await setsDto(g) });

    if (req.method === 'POST') {
      const b = await readJson(req);
      const name = String(b.name || '').trim().slice(0, 60);
      if (!name) return json(res, 400, { error: 'Give the set a name' });
      let albumId = String(b.albumId || '');
      if (!albumId) {
        /* no album chosen: make one, named so it is recognisable in Immich itself */
        if (!canUpload()) return json(res, 400, { error: 'no_write_key' });
        const r = await immich('/api/albums', {
          write: true, method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ albumName: `${g.title} \u00b7 ${name}` }),
        });
        if (!r.ok) return json(res, 502, { error: `Immich refused the album (${r.status})` });
        albumId = (await r.json()).id;
      }
      if (!/^[0-9a-f-]{36}$/i.test(albumId)) return json(res, 400, { error: 'bad album' });
      q.setIns.run(g.id, name, albumId, q.setMax.get(g.id).n + 1);
      console.log(`set "${name}" added to ${g.slug}`);
      return json(res, 201, { sets: await setsDto(g) });
    }
  }

  const setM = path.match(/^\/api\/admin\/galleries\/(\d+)\/sets\/(\d+)$/);
  if (setM) {
    const g = q.gallById.get(Number(setM[1]));
    const st = q.setById.get(Number(setM[2]));
    if (!g || !st || st.gallery_id !== g.id) return json(res, 404, { error: 'not_found' });
    const all = q.setsFor.all(g.id);

    if (req.method === 'PATCH') {
      const b = await readJson(req);
      if (b.name !== undefined) {
        const name = String(b.name).trim().slice(0, 60);
        if (!name) return json(res, 400, { error: 'Give the set a name' });
        q.setName.run(name, st.id);
      }
      if (b.move === 'up' || b.move === 'down') {
        const i = all.findIndex(x => x.id === st.id);
        const j = b.move === 'up' ? i - 1 : i + 1;
        if (j >= 0 && j < all.length) {
          /* positions can be equal or stale, so renumber the whole gallery as we swap */
          const order = all.slice();
          order[i] = all[j]; order[j] = all[i];
          order.forEach((x, k) => q.setPos.run(k, x.id));
        }
      }
      return json(res, 200, { sets: await setsDto(g) });
    }

    if (req.method === 'DELETE') {
      if (all.length < 2) return json(res, 400, { error: 'A gallery needs at least one set' });
      dropZips(g.id, st.id);
      q.setDel.run(st.id);
      q.setsFor.all(g.id).forEach((x, k) => q.setPos.run(k, x.id));
      /* the cover may have been one of its photos */
      if (g.cover_asset_id && !(await galleryHas(q.gallById.get(g.id), g.cover_asset_id)))
        q.coverClear.run(g.cover_asset_id);
      console.log(`set "${st.name}" removed from ${g.slug} (its Immich album is untouched)`);
      return json(res, 200, { sets: await setsDto(q.gallById.get(g.id)) });
    }
  }

  /* a cover of your own: stored beside the database, never added to the album
     and never pushed into the Immich library */
  const cu = path.match(/^\/api\/admin\/galleries\/(\d+)\/cover-upload$/);
  if (cu) {
    const g = q.gallById.get(Number(cu[1]));
    if (!g) return json(res, 404, { error: 'not_found' });

    if (req.method === 'DELETE') {
      dropCoverFile(g); q.coverFile.run(null, g.id);
      console.log(`cover file removed for ${g.slug}`);
      return json(res, 200, gallDto(q.gallById.get(g.id)));
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

    const name = (url.searchParams.get('name') || 'cover.jpg').replace(/[\\/\u0000]/g, '_').slice(0, 200);
    if (!COVER_OK.test(name))
      return json(res, 415, { error: 'Use a JPEG, PNG, WebP, AVIF or GIF. HEIC will not display in a browser.' });

    const tooBig = () => {
      json(res, 413, { error: 'Covers must be under 12 MB' }, { connection: 'close' });
      req.destroy();
    };
    if (Number(req.headers['content-length'] || 0) > COVER_MAX) return tooBig();
    let buf;
    try { buf = await readBuffer(req, COVER_MAX); } catch { return tooBig(); }
    if (!buf.length) return json(res, 400, { error: 'that file was empty' });

    /* a new name each time, so a replaced cover is not served from a browser cache */
    const file = `${g.id}-${randomBytes(6).toString('hex')}${extname(name).toLowerCase()}`;
    const tmp = join(COVERS_DIR, '.' + file);
    await writeFile(tmp, buf);
    renameSync(tmp, join(COVERS_DIR, file));      /* appears whole, never half written */
    dropCoverFile(g);
    q.coverFile.run(file, g.id);
    console.log(`cover for ${g.slug}: ${file} ${(buf.length / 1024).toFixed(0)}KB`);
    return json(res, 200, gallDto(q.gallById.get(g.id)));
  }

  if (path === '/api/admin/albums' && req.method === 'POST') {
    if (!canUpload()) return json(res, 400, { error: 'no_write_key' });
    const b = await readJson(req);
    const name = String(b.name || '').trim().slice(0, 120);
    if (!name) return json(res, 400, { error: 'Give the album a name' });
    const r = await immich('/api/albums', {
      write: true, method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ albumName: name, description: String(b.description || '') }),
    });
    if (!r.ok) {
      console.error('album create failed', r.status, (await r.text().catch(() => '')).slice(0, 200));
      return json(res, 502, { error: `Immich refused the album (${r.status})` });
    }
    const a = await r.json();
    console.log(`created immich album ${a.albumName} (${a.id})`);
    return json(res, 201, { id: a.id, name: a.albumName, count: a.assetCount || 0, thumb: null });
  }

  /* One photo per request, raw body - no multipart to parse on this side, and the
     browser gets a real progress bar per file. */
  if (path === '/api/admin/upload' && req.method === 'POST') {
    if (!canUpload()) return json(res, 400, { error: 'no_write_key' });
    const albumId = url.searchParams.get('albumId') || '';
    if (!/^[0-9a-f-]{36}$/i.test(albumId)) return json(res, 400, { error: 'albumId is required' });
    const name = (url.searchParams.get('name') || 'photo.jpg').replace(/[\\/\u0000]/g, '_').slice(0, 200);
    const isVideo = UPLOAD_VIDEO.test(name);
    if (!isVideo && !UPLOAD_PHOTO.test(name))
      return json(res, 415, { error: 'Photos and video only \u2014 jpg, png, heic, dng, mp4, mov and the like' });

    const maxMb = isVideo ? CFG.uploadMaxVideoMb : CFG.uploadMaxMb;
    const cap = maxMb * 1024 * 1024;
    if (Number(req.headers['content-length'] || 0) > cap) {
      /* answer before closing, or the browser only sees a dropped connection */
      json(res, 413, { error: `${isVideo ? 'Videos' : 'Photos'} must be under ${maxMb} MB` }, { connection: 'close' });
      req.destroy();
      return;
    }

    const when = isoOrNow(url.searchParams.get('created'));
    let up, bytes;
    try { ({ r: up, bytes } = await uploadToImmich(req, name, when, cap)); }
    catch (e) {
      console.error('upload stream failed', name, e.message);
      return json(res, 413, { error: `${isVideo ? 'Videos' : 'Photos'} must be under ${maxMb} MB` });
    }
    if (!up.ok) {
      console.error('upload failed', up.status, (await up.text().catch(() => '')).slice(0, 200));
      return json(res, 502, { error: `Immich refused the upload (${up.status})` });
    }
    const a = await up.json();                      /* { id, status: created | duplicate } */
    let added = false;
    if (a.id) {
      const r2 = await immich(`/api/albums/${albumId}/assets`, {
        write: true, method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [a.id] }),
      });
      if (r2.ok) {
        const rr = await r2.json().catch(() => null);
        added = Array.isArray(rr) ? rr.some(x => x && x.success) : true;
      } else console.error('album add failed', r2.status);
      albumSets.delete(albumId);                    /* a photo added now must be servable now */
    }
    console.log(`upload ${name} ${(bytes / 1048576).toFixed(1)}MB -> ${a.status || 'ok'}${added ? ' + album' : ''}`);
    return json(res, 200, { id: a.id || null, status: a.status || 'created', added });
  }

  /* Taking photos back out: off the album, into Immich's trash, and undo. */
  const mng = path.match(/^\/api\/admin\/photos\/(remove|trash|restore)$/);
  if (mng && req.method === 'POST') {
    if (!canUpload()) return json(res, 400, { error: 'no_write_key' });
    const act = mng[1];
    const b = await readJson(req);
    const albumId = String(b.albumId || '');
    if (!/^[0-9a-f-]{36}$/i.test(albumId)) return json(res, 400, { error: 'albumId is required' });
    const asked = (Array.isArray(b.ids) ? b.ids : []).map(String).filter(x => /^[0-9a-f-]{36}$/i.test(x));
    if (!asked.length) return json(res, 400, { error: 'Select at least one photo' });
    if (asked.length > 500) return json(res, 400, { error: 'Up to 500 photos at a time' });

    /* Act only on photos this gallery actually holds, so a stray id cannot reach the
       rest of the library. Undo is bounded to what this panel trashed instead. */
    let ids;
    if (act === 'restore') {
      ids = asked.filter(id => recentTrash.get(id)?.albumId === albumId);
      if (!ids.length) return json(res, 409, { error: "There's nothing left to undo" });
    } else {
      const here = new Set((await albumAssets(albumId, { fresh: true })).map(a => a.id));
      ids = asked.filter(id => here.has(id));
      if (!ids.length) return json(res, 409, { error: 'Those photos are no longer in this gallery' });
    }

    const call = act === 'remove'
      ? [`/api/albums/${albumId}/assets`, 'DELETE', { ids }]
      : act === 'trash'
        ? ['/api/assets', 'DELETE', { ids, force: false }]        /* recoverable, never a hard delete */
        : ['/api/trash/restore/assets', 'POST', { ids }];
    const r = await immich(call[0], {
      write: true, method: call[1],
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(call[2]),
    });
    if (!r.ok) {
      const txt = (await r.text().catch(() => '')).slice(0, 200);
      console.error(`${act} failed`, r.status, txt);
      const miss = /Missing required permission: ([\w.]+)/.exec(txt);
      return json(res, 502, { error: miss
        ? `Your Immich key is missing ${miss[1]}. Add it to the key and try again.`
        : `Immich refused that (${r.status})` });
    }

    albumSets.delete(albumId);                        /* clients must stop seeing them at once */
    if (act === 'trash') rememberTrash(albumId, ids);
    if (act === 'restore') for (const id of ids) recentTrash.delete(id);
    if (act !== 'restore') for (const id of ids) q.coverClear.run(id);
    console.log(`${act} ${ids.length} photo(s) in album ${albumId}`);
    return json(res, 200, { ok: true, ids, n: ids.length, skipped: asked.length - ids.length });
  }

  if (path === '/api/admin/storage' && req.method === 'GET') return json(res, 200, await storageUsage());

  if (path === '/api/admin/albums') {
    const albums = await immichJson('/api/albums');
    return json(res, 200, albums.map(a => ({
      id: a.id, name: a.albumName, count: a.assetCount, thumb: a.albumThumbnailAssetId,
    })));
  }

  const am = path.match(/^\/api\/admin\/albums\/([0-9a-f-]{36})\/assets$/i);
  if (am) {
    const list = await albumAssets(am[1], { fresh: true });
    if (url.searchParams.get('sort') === 'oldest') list.reverse();
    return json(res, 200, { assets: list.slice(0, 400) });
  }

  const im = path.match(/^\/api\/admin\/img\/([0-9a-f-]{36})$/i);
  if (im) return proxyImage(req, res, im[1], url.searchParams.get('size') || 'thumbnail');

  if (path === '/api/admin/galleries' && req.method === 'GET')
    return json(res, 200, q.gallAll.all().map(gallDto));

  if (path === '/api/admin/galleries' && req.method === 'POST') {
    const b = await readJson(req);
    if (!b.slug || !b.title || !b.albumId) return json(res, 400, { error: 'slug, title and albumId are required' });
    if (!slugShape(b.slug)) return json(res, 400, { error: 'slug must be letters, numbers and dashes' });
    if (!slugFree(b.slug))  return json(res, 400, { error: `“${b.slug}” is reserved — pick another web address` });
    let hash = null, salt = null;
    if (b.password) { salt = randomBytes(16).toString('hex'); hash = hashPw(String(b.password), salt); }
    try {
      q.gallIns.run(String(b.slug).toLowerCase(), String(b.title), b.subtitle || null, String(b.albumId),
        b.coverAssetId || null, b.requireEmail ? 1 : 0, hash, salt,
        b.allowDownload === false ? 0 : 1, b.expiresAt || null,
        b.publish === false ? null : new Date().toISOString());
    } catch (e) { return json(res, 409, { error: 'That web address is already taken' }); }
    /* a new gallery runs the way the last one was set to run */
    const lastSort = q.setGet.get('default_sort');
    const want = b.sortOrder !== undefined
      ? (b.sortOrder === 'oldest' ? 'oldest' : 'newest')
      : (lastSort && lastSort.value === 'oldest' ? 'oldest' : 'newest');
    const created = q.gallBySlug.get(String(b.slug).toLowerCase());
    q.sortOrder.run(want, created.id);
    if (b.sortOrder !== undefined) q.setPut.run('default_sort', want);
    q.setIns.run(created.id, String(b.setName || 'Photos').trim().slice(0, 60) || 'Photos', String(b.albumId), 0);
    applyDefaultReminders(created.id);
    /* read it back: the row was written to after it was first fetched */
    return json(res, 201, gallDto(q.gallById.get(created.id)));
  }

  const one = path.match(/^\/api\/admin\/galleries\/(\d+)$/);
  if (one) {
    const g = q.gallById.get(Number(one[1]));
    if (!g) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET') return json(res, 200, gallDto(g));

    if (req.method === 'DELETE') { dropZips(g.id); dropCoverFile(g); q.gallDel.run(g.id); return json(res, 200, { ok: true }); }

    if (req.method === 'PATCH') {
      const b = await readJson(req);
      const slug = (b.slug ?? g.slug).toLowerCase();
      if (!slugShape(slug)) return json(res, 400, { error: 'slug must be letters, numbers and dashes' });
      if (!slugFree(slug))  return json(res, 400, { error: `“${slug}” is reserved — pick another web address` });
      try {
        q.gallUpd.run(
          slug,
          b.title ?? g.title,
          b.subtitle !== undefined ? (b.subtitle || null) : g.subtitle,
          b.albumId ?? g.album_id,
          b.coverAssetId !== undefined ? (b.coverAssetId || null) : g.cover_asset_id,
          b.requireEmail !== undefined ? (b.requireEmail ? 1 : 0) : g.require_email,
          b.allowDownload !== undefined ? (b.allowDownload ? 1 : 0) : g.allow_download,
          b.expiresAt !== undefined ? (b.expiresAt || null) : g.expires_at,
          b.published !== undefined ? (b.published ? (g.published_at || new Date().toISOString()) : null) : g.published_at,
          g.id);
      } catch (e) { return json(res, 409, { error: 'That web address is already taken' }); }
      {
        const now = q.gallById.get(g.id);
        if (!zipWanted(now)) dropZips(g.id);
        else if (b.published !== undefined || b.allowDownload !== undefined) zipArmSweep();
      }
      if (b.password !== undefined) {
        if (b.password) { const salt = randomBytes(16).toString('hex'); q.gallPw.run(hashPw(String(b.password), salt), salt, g.id); }
        else q.gallPw.run(null, null, g.id);
      }
      if (b.coverFocus !== undefined) {
        /* two percentages, which is all CSS needs to decide what a crop keeps */
        const m = /^(\d{1,3}(?:\.\d+)?) (\d{1,3}(?:\.\d+)?)$/.exec(String(b.coverFocus || ''));
        const ok = m && Number(m[1]) <= 100 && Number(m[2]) <= 100;
        q.coverFocus.run(ok ? `${Math.round(Number(m[1]))} ${Math.round(Number(m[2]))}` : null, g.id);
      }
      if (b.sortOrder !== undefined) {
        const want = b.sortOrder === 'oldest' ? 'oldest' : 'newest';
        q.sortOrder.run(want, g.id);
        q.setPut.run('default_sort', want);     /* the next gallery starts this way too */
      }
      return json(res, 200, gallDto(q.gallById.get(g.id)));
    }
  }

  if (path === '/api/admin/zips' && req.method === 'GET') {
    const rows = q.zipEvery.all();
    let free = null; try { const f = statfsSync(ZIP_DIR); free = f.bavail * f.bsize; } catch {}
    return json(res, 200, {
      enabled: CFG.prezip, budgetBytes: CFG.zipMaxGb * 1e9,
      usedBytes: rows.reduce((n, z) => n + (z.status === 'ready' ? z.bytes || 0 : 0), 0), freeBytes: free,
      queue: zipQueue.snapshot(), totalMbit: CFG.zipTotalMbit,
      zips: rows.map(z => ({ ...zipAdminDto(z), slug: z.slug, gallery: z.title, set: z.set_name })),
    });
  }
  const zadm = path.match(/^\/api\/admin\/galleries\/(\d+)\/zips$/);
  if (zadm && req.method === 'POST') {
    const g = q.gallById.get(Number(zadm[1]));
    if (!g) return json(res, 404, { error: 'not_found' });
    const act = (await readJson(req)).action;
    if (act === 'delete') dropZips(g.id, null, 'evicted');       /* stays off until a client asks again */
    else if (act === 'rebuild' && zipWanted(g)) for (const st of setsOf(g)) { q.zipEnsure.run(g.id, st.id); zipRequestBuild(st.id, true); }
    else return json(res, 400, { error: 'bad_action' });
    return json(res, 200, gallDto(q.gallById.get(g.id)));
  }

  if (path === '/api/admin/logs') {
    const n = Math.min(Number(url.searchParams.get('n') || 150), LOG_MAX);
    return json(res, 200, { lines: logRing.slice(-n) });
  }

  if (path === '/api/admin/restart' && req.method === 'POST') {
    console.warn('restart requested via admin API');
    json(res, 200, { ok: true, note: 'restarting; the container policy brings us back' });
    /* exiting cleanly is enough - `restart: always` starts a fresh process,
       which reloads the mounted source files */
    setTimeout(() => process.exit(0), 250);
    return;
  }

  if (path === '/api/admin/backups') {
    if (req.method === 'POST') { const r = runBackup(true); return json(res, r && r.error ? 500 : 200, { result: r, backups: backupList() }); }
    return json(res, 200, { dir: CFG.backupDir || null, keep: CFG.backupKeep, backups: backupList(), covers: coverBackupCount() });
  }

  if (path === '/api/admin/mail-status')
    return json(res, 200, { configured: mailReady(), from: CFG.mailFrom || null, replyTo: CFG.mailReplyTo || null, remindDays: CFG.remindDays,
                            brandAddress: !!CFG.brandAddress, mailingMax: CFG.mailingMax, mailingDayMax: CFG.mailingDayMax,
                            sendOn: CFG.mailSend, webhook: !!CFG.resendWebhookSecret, signedIn: sessionOnly(req) });

  if (path === '/api/admin/default-reminders') {
    if (req.method === 'GET') return json(res, 200, { reminders: defaultReminders() });
    if (req.method === 'PUT') {
      const b = await readJson(req);
      const clean = (Array.isArray(b.reminders) ? b.reminders : [])
        .map(r => ({
          daysBefore: Math.round(Number(r.daysBefore)),
          audience: r.audience === 'email' ? 'email' : 'all',
          email: r.audience === 'email' ? String(r.email || '').trim().toLowerCase() : null,
        }))
        .filter(r => Number.isFinite(r.daysBefore) && r.daysBefore >= 0 && r.daysBefore <= 365)
        .filter(r => r.audience !== 'email' || /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(r.email));
      q.setPut.run('default_reminders', JSON.stringify(clean));
      return json(res, 200, { reminders: clean });
    }
  }

  const rem = path.match(/^\/api\/admin\/galleries\/(\d+)\/reminders$/);
  if (rem) {
    const g = q.gallById.get(Number(rem[1]));
    if (!g) return json(res, 404, { error: 'not_found' });
    if (req.method === 'GET') return json(res, 200, { reminders: q.remList.all(g.id) });
    if (req.method === 'POST') {
      const b = await readJson(req);
      const days = Math.round(Number(b.daysBefore));
      if (!Number.isFinite(days) || days < 0 || days > 365) return json(res, 400, { error: 'Days must be between 0 and 365' });
      const aud = b.audience === 'email' ? 'email' : 'all';
      const em = aud === 'email' ? String(b.email || '').trim().toLowerCase() : null;
      if (aud === 'email' && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(em))
        return json(res, 400, { error: 'That email address looks wrong' });
      q.remIns.run(g.id, days, aud, em);
      if (b.saveAsDefault) {
        const cur = defaultReminders();
        if (!cur.some(r => r.daysBefore === days && r.audience === aud && (r.email || null) === em))
          q.setPut.run('default_reminders', JSON.stringify(cur.concat([{ daysBefore: days, audience: aud, email: em }])));
      }
      return json(res, 200, { reminders: q.remList.all(g.id) });
    }
    if (req.method === 'DELETE') {
      const b = await readJson(req);
      q.remDel.run(Number(b.id), g.id);
      return json(res, 200, { reminders: q.remList.all(g.id) });
    }
  }

  const inv = path.match(/^\/api\/admin\/galleries\/(\d+)\/invites$/);
  if (inv) {
    const g = q.gallById.get(Number(inv[1]));
    if (!g) return json(res, 404, { error: 'not_found' });
    if (req.method === 'GET') return json(res, 200, { invites: q.invList.all(g.id) });
    if (req.method === 'POST') {
      const b = await readJson(req);
      const raw = String(b.emails || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
      const good = [], bad = [];
      for (const e of raw) (/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(e) ? good : bad).push(e);
      for (const e of good) q.invIns.run(g.id, e, null);
      return json(res, 200, { added: good.length, invalid: bad, invites: q.invList.all(g.id) });
    }
    if (req.method === 'DELETE') {
      const b = await readJson(req);
      q.invDel.run(g.id, String(b.email || '').toLowerCase());
      return json(res, 200, { invites: q.invList.all(g.id) });
    }
  }

  if (path === '/api/admin/templates') {
    if (req.method === 'GET') {
      const row = q.setGet.get('last_template');
      const kind = url.searchParams.get('kind') === 'mailing' ? 'mailing' : 'ready';
      return json(res, 200, { templates: tplList(kind), lastUsed: row ? Number(row.value) : null });
    }
    if (req.method === 'POST') {
      const b = await readJson(req);
      const name = String(b.name || '').trim();
      if (!name) return json(res, 400, { error: 'Give the template a name' });
      const kind = b.kind === 'mailing' ? 'mailing' : 'ready';
      try { q.tplIns.run(name, String(b.subject || ''), String(b.body || ''), 0, kind, kind === 'mailing' ? JSON.stringify(cleanDesign(b.design)) : null); }
      catch { return json(res, 409, { error: 'A template with that name already exists' }); }
      return json(res, 201, { templates: tplList(kind) });
    }
  }

  const tplM = path.match(/^\/api\/admin\/templates\/(\d+)$/);
  if (tplM) {
    const t = q.tplGet.get(Number(tplM[1]));
    if (!t) return json(res, 404, { error: 'not_found' });
    if (req.method === 'PATCH') {
      const b = await readJson(req);
      try {
        q.tplUpd.run(String(b.name ?? t.name).trim(), String(b.subject ?? t.subject),
                     String(b.body ?? t.body),
                     t.kind === 'mailing' ? (b.design !== undefined ? JSON.stringify(cleanDesign(b.design)) : t.design) : null, t.id);
      } catch { return json(res, 409, { error: 'A template with that name already exists' }); }
      return json(res, 200, { templates: tplList(t.kind) });
    }
    if (req.method === 'DELETE') {
      if (t.built_in) return json(res, 400, { error: 'The built-in template cannot be deleted' });
      q.tplDel.run(t.id);
      return json(res, 200, { templates: tplList(t.kind) });
    }
  }

  const prevM = path.match(/^\/api\/admin\/galleries\/(\d+)\/preview$/);
  if (prevM && req.method === 'POST') {
    const g = q.gallById.get(Number(prevM[1]));
    if (!g) return json(res, 404, { error: 'not_found' });
    const b = await readJson(req);
    let coverId = g.cover_asset_id;
    if (!coverId) {
      try { coverId = (await albumAssets(g.album_id)).find(a => a.isImage)?.id || null; } catch {}
    }
    const coverUrl = coverId ? `/api/admin/img/${coverId}?size=preview` : null;
    const t = tmpl('ready', g, { subject: b.subject, body: b.body, showExpiry: b.showExpiry, coverUrl });
    return json(res, 200, { subject: t.subject, html: t.html });
  }

  const snd = path.match(/^\/api\/admin\/galleries\/(\d+)\/send$/);
  if (snd && req.method === 'POST') {
    const g = q.gallById.get(Number(snd[1]));
    if (!g) return json(res, 404, { error: 'not_found' });
    if (!mailReady()) return json(res, 400, { error: 'Email is not configured yet' });
    if (!g.published_at) return json(res, 400, { error: 'Publish the gallery before sending' });
    const b = await readJson(req);
    const extra = { subject: b.subject, body: b.body, showExpiry: b.showExpiry !== false };
    if (b.templateId) q.setPut.run('last_template', String(Number(b.templateId)));

    /* a test goes only to the admin, so a template can be checked before any client sees it */
    if (b.testOnly) {
      if (!CFG.adminEmail) return json(res, 400, { error: 'No admin email configured' });
      try { await sendMailKind(g, CFG.adminEmail, 'ready', 'test', extra); }
      catch (e) { return json(res, 502, { error: String(e.message).slice(0, 200) }); }
      return json(res, 200, { sent: 0, testSentTo: CFG.adminEmail, failed: [] });
    }

    const only = Array.isArray(b.to) && b.to.length
      ? b.to.map(x => String(x).trim().toLowerCase()).filter(Boolean) : null;
    const list = (only || q.invList.all(g.id).map(r => r.email)).filter(Boolean);
    if (!list.length) return json(res, 400, { error: 'Add at least one email address first' });

    let sent = 0; const failed = [];
    for (const email of list) {
      try { await sendMailKind(g, email, 'ready', 'ready', extra); sent++; }
      catch (e) { failed.push({ email, error: String(e.message).slice(0, 160) }); }
    }
    let copy = null;
    if (b.sendCopy && CFG.adminEmail) {
      try { await sendMailKind(g, CFG.adminEmail, 'ready', 'copy', extra); copy = CFG.adminEmail; }
      catch (e) { failed.push({ email: CFG.adminEmail, error: String(e.message).slice(0, 160) }); }
    }
    return json(res, 200, { sent, copySentTo: copy, failed });
  }


  /* who picked what */
  const favM = path.match(/^\/api\/admin\/galleries\/(\d+)\/favourites$/);
  if (favM) {
    const g = q.gallById.get(Number(favM[1]));
    if (!g) return json(res, 404, { error: 'not_found' });
    const people = q.favWho.all(g.id).map(r => ({
      id: r.id, email: r.email, name: r.name, count: r.n, last: r.last,
      ids: q.favOf.all(r.id).map(x => x.asset_id),
    }));
    return json(res, 200, { people, distinct: q.favTotal.get(g.id).n });
  }

  /* who downloaded what: one entry per client, singles and zips kept apart */
  const dlM = path.match(/^\/api\/admin\/galleries\/(\d+)\/downloads$/);
  if (dlM) {
    const g = q.gallById.get(Number(dlM[1]));
    if (!g) return json(res, 404, { error: 'not_found' });
    const by = new Map();
    for (const e of q.dlList.all(g.id)) {
      const k = e.reg_id ?? 0;
      if (!by.has(k)) by.set(k, { id: e.reg_id, email: e.email || null, name: e.name || null,
                                  last: e.created_at, ids: [], zips: [] });
      const p = by.get(k);
      if (e.type === 'download') { if (e.asset_id && !p.ids.includes(e.asset_id)) p.ids.push(e.asset_id); }
      else {
        let ids = null;
        try { ids = e.detail ? JSON.parse(e.detail) : null; } catch {}
        p.zips.push({ at: e.created_at, ids });
      }
    }
    return json(res, 200, { people: [...by.values()] });
  }

  /* everyone who left an email: registered, downloaded, or either, across one gallery or all of
     them; one row per address with the galleries it came from. ?format=csv for a file. */
  /* hidden addresses stay in the database; they are only left out of the list, copy and CSV */
  const hiddenSet = hiddenContacts;
  if (path === '/api/admin/contacts/hide' && req.method === 'POST') {
    const b = await readJson(req);
    const set = hiddenSet();
    for (const e of Array.isArray(b.emails) ? b.emails : []) {
      const k = String(e).trim().toLowerCase(); if (!k) continue;
      if (b.hidden === false) set.delete(k); else set.add(k);
    }
    q.setPut.run('hidden_contacts', JSON.stringify([...set]));
    return json(res, 200, { hidden: set.size });
  }
  if (path === '/api/admin/contacts' && req.method === 'GET') {
    const hid = hiddenSet(), showHidden = url.searchParams.get('hidden') === '1';
    const gid = url.searchParams.get('gallery') === 'all' || !url.searchParams.get('gallery')
      ? null : Number(url.searchParams.get('gallery'));
    const who = ['registered', 'downloaded'].includes(url.searchParams.get('who')) ? url.searchParams.get('who') : 'any';
    const rows = contactRows(gid);
    const by = new Map();
    for (const r of rows) {
      const downloaded = !!r.dl_at;
      if (who === 'downloaded' && !downloaded) continue;
      const k = String(r.email).trim().toLowerCase();
      if (!k || hid.has(k) !== showHidden) continue;
      const c = by.get(k) || { email: k, name: null, galleries: [], downloaded: false, last: r.reg_at };
      c.name = c.name || r.name || null;
      if (!c.galleries.includes(r.title)) c.galleries.push(r.title);
      c.downloaded = c.downloaded || downloaded;
      if (r.reg_at > c.last) c.last = r.reg_at;
      by.set(k, c);
    }
    const list = [...by.values()];
    if (url.searchParams.get('format') === 'csv') {
      /* a cell that starts with = + - @ would run as a formula in a spreadsheet */
      const cell = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
      const csv = ['Email,Name,Galleries,Downloaded,Last seen',
        ...list.map(c => [c.email, c.name, c.galleries.join('; '), c.downloaded ? 'yes' : 'no', c.last].map(cell).join(','))].join('\r\n');
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="contacts.csv"' });
      return res.end('﻿' + csv);
    }
    return json(res, 200, { contacts: list });
  }


  /* ---- mailings: a template sent to people from Contacts ---- */
  const mlWarnings = () => [
    ...(CFG.brandAddress ? [] : ['Add BRAND_ADDRESS (your postal address or PO box) before sending for real. It goes in every mailing’s footer, as the law requires.']),
    ...(CFG.mailSend ? [] : ['Sending is switched off (MAIL_SEND=off). Mailings are only simulated.']),
    ...(mailReady() ? [] : ['Email is not set up, so nothing can be sent.']),
  ];
  const sampleFor = (plan, wanted) => {
    const send = plan.sel.send;
    const pick = send.find(s => s.email === String(wanted || '').toLowerCase()) || send[0];
    if (pick) return { email: pick.email, name: pick.name, gallery_id: pick.galleryId };
    const g = q.gallAll.all().find(x => x.published_at && !isExpired(x));
    return { email: 'sam@example.com', name: 'Sam Lee', gallery_id: g ? g.id : null };
  };
  if (path === '/api/admin/mailings/preview' && req.method === 'POST') {
    const b = await readJson(req, 512 * 1024);
    const plan = mailingPlan(b);
    if (plan.error) return json(res, 400, { error: plan.error });
    const sample = sampleFor(plan, b.sampleEmail);
    const out = render(plan.snapshot, recipientView(sample), mailCtx(`${CFG.publicUrl}/unsubscribe/preview`));
    return json(res, 200, { subject: out.subject, html: out.html, text: out.text, unresolved: out.unresolved,
      noGallery: !recipientView(sample).gallery,
      sample: { email: sample.email, name: sample.name }, sampleOptions: plan.sel.send.slice(0, 20).map(s => s.email),
      count: plan.count, warnings: mlWarnings() });
  }
  if (path === '/api/admin/mailings/test' && req.method === 'POST') {
    if (tooManyAttempts('mltest', 20)) return json(res, 429, { error: 'Too many test sends. Wait a few minutes.' });
    if (!mailReady() || !CFG.adminEmail) return json(res, 409, { error: 'Email is not set up' });
    if (!CFG.mailSend) return json(res, 409, { error: 'Sending is switched off (MAIL_SEND=off)' });
    const b = await readJson(req, 512 * 1024);
    const plan = mailingPlan(b);
    if (plan.error) return json(res, 400, { error: plan.error });
    const sample = sampleFor(plan, b.sampleEmail);
    const url = unsubUrl(CFG.adminEmail, null);
    const out = render(plan.snapshot, recipientView(sample), mailCtx(url));
    const r = await resendSend({ to: CFG.adminEmail, subject: `[Test] ${out.subject}`, html: out.html, text: out.text, headers: listHeaders(url) });
    q.mailIns.run(null, CFG.adminEmail, 'mailing-test', r.ok ? 'sent' : 'failed', r.ok ? null : r.body);
    if (!r.ok) return json(res, 502, { error: `The mail service refused it (${r.status})` });
    return json(res, 200, { sentTo: CFG.adminEmail, unresolved: out.unresolved });
  }
  if (path === '/api/admin/mailings/plan' && req.method === 'POST') {
    const plan = mailingPlan(await readJson(req, 512 * 1024));
    if (plan.error) return json(res, 400, { error: plan.error });
    return json(res, 200, { count: plan.count, skipped: plan.skipped, planHash: plan.hash, templateName: plan.snapshot.name,
      cap: CFG.mailingMax, overCap: plan.count > CFG.mailingMax, dayCap: CFG.mailingDayMax,
      daysNeeded: Math.max(1, Math.ceil((plan.count + sentLast24()) / CFG.mailingDayMax)), warnings: mlWarnings() });
  }
  if (path === '/api/admin/mailings' && req.method === 'POST') {
    const b = await readJson(req, 512 * 1024);
    const key = String(b.key || '');
    if (!/^[\w-]{8,64}$/.test(key)) return json(res, 400, { error: 'Missing request key' });
    const dup = q.mlByKey.get(key);
    if (dup) return json(res, 200, { mailing: mailingDto(dup) });          /* a double click, or a retry after a dropped reply */
    const dry = b.dryRun === true || !CFG.mailSend;
    if (!dry) {
      if (!sessionOnly(req)) return json(res, 403, { error: 'Sign in to the admin panel in your browser to send real mail' });
      if (!originOk(req)) return json(res, 403, { error: 'Request came from somewhere else' });
      if (!mailReady()) return json(res, 409, { error: 'Email is not set up' });
      if (!CFG.brandAddress) return json(res, 409, { error: 'Set BRAND_ADDRESS (your postal address or PO box) first. It must appear in every mailing.' });
    }
    const plan = mailingPlan(b);
    if (plan.error) return json(res, 400, { error: plan.error });
    if (plan.hash !== b.planHash) return json(res, 409, { error: 'The list changed since you reviewed it. Review it again.' });
    if (!plan.count) return json(res, 400, { error: 'There is nobody to send this to' });
    if (plan.count > CFG.mailingMax) return json(res, 400, { error: `That is ${plan.count} people, over this app’s limit of ${CFG.mailingMax} per mailing. Narrow the list.` });
    let id;
    db.exec('BEGIN');
    try {
      id = Number(q.mlIns.run(key, b.templateId ? Number(b.templateId) : null, plan.snapshot.name, plan.snapshot.subject, plan.snapshot.body, JSON.stringify(plan.snapshot.design),
                              JSON.stringify(plan.audience), 'queued', dry ? 1 : 0, plan.count).lastInsertRowid);
      for (const r of plan.sel.send) q.mrIns.run(id, r.email, r.name, r.galleryId, 'queued', null);
      for (const r of plan.sel.skipped) { try { q.mrIns.run(id, r.email, null, null, 'skipped', r.reason); } catch {} }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); console.error('mailing create:', e.message); return json(res, 500, { error: 'Could not create the mailing' }); }
    console.log(`mailing ${id} created: "${plan.snapshot.name}" to ${plan.count}${dry ? ' (dry run)' : ''}`);
    mailerStart(0);
    return json(res, 201, { mailing: mailingDto(q.mlGet.get(id)) });
  }
  if (path === '/api/admin/mailings' && req.method === 'GET') return json(res, 200, { mailings: q.mlList.all().map(mailingDto) });
  const mlOne = path.match(/^\/api\/admin\/mailings\/(\d+)(?:\/(cancel|retry|resume))?$/);
  if (mlOne) {
    const m = q.mlGet.get(Number(mlOne[1]));
    if (!m) return json(res, 404, { error: 'not_found' });
    const act = mlOne[2];
    if (!act && req.method === 'GET') return json(res, 200, { mailing: mailingDto(m), recipients: q.mrFor.all(m.id) });
    if (act && req.method === 'POST') {
      if (act === 'cancel') {
        if (!['queued', 'sending', 'paused'].includes(m.status)) return json(res, 409, { error: 'That mailing is already finished' });
        q.mlStatus.run('cancelled', null, m.id); q.mrCancel.run(m.id); q.mlFinished.run(m.id);
      } else if (act === 'retry') {
        if (['cancelled'].includes(m.status)) return json(res, 409, { error: 'That mailing was cancelled' });
        q.mrRetry.run(m.id); q.mlStatus.run('sending', null, m.id); mailerState.fails.set(m.id, 0); mailerStart(0);
      } else if (act === 'resume') {
        if (m.status !== 'paused') return json(res, 409, { error: 'That mailing is not paused' });
        q.mlStatus.run('sending', null, m.id); mailerState.fails.set(m.id, 0); mailerStart(0);
      }
      return json(res, 200, { mailing: mailingDto(q.mlGet.get(m.id)) });
    }
  }
  if (path === '/api/admin/mail-images' && req.method === 'POST') {
    if (Number(req.headers['content-length'] || 0) > MAIL_IMG_MAX) { req.destroy(); return json(res, 413, { error: 'Pictures must be under 4 MB' }, { connection: 'close' }); }
    let buf; try { buf = await readBuffer(req, MAIL_IMG_MAX); } catch { return json(res, 413, { error: 'Pictures must be under 4 MB' }, { connection: 'close' }); }
    const ext = sniffImage(buf);
    if (!ext) return json(res, 415, { error: 'Use a JPEG, PNG or WebP picture' });
    const file = `${randomBytes(10).toString('hex')}.${ext}`;
    const tmp = join(MAIL_IMG_DIR, '.' + file);
    await writeFile(tmp, buf); renameSync(tmp, join(MAIL_IMG_DIR, file));
    console.log(`mailing picture: ${file} ${(buf.length / 1024).toFixed(0)} KB`);
    return json(res, 201, { file, url: `${CFG.publicUrl}/mail/img/${file}` });
  }
  if (path === '/api/admin/mailings/token' && req.method === 'GET') {
    /* for the smoke test only, and only for addresses that can never receive real mail */
    const e = String(url.searchParams.get('email') || '').toLowerCase();
    if (!isReservedAddress(e)) return json(res, 400, { error: 'Only reserved test addresses' });
    return json(res, 200, { token: unsubToken(e, null, CFG.secret) });
  }
  if (path === '/api/admin/suppressions') {
    if (req.method === 'GET') return json(res, 200, { suppressions: q.supAll.all() });
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'That is not an email address' });
    if (req.method === 'POST') {
      q.supPut.run(email, b.scope === 'all' ? 'all' : 'marketing', 'manual', null, null);
      return json(res, 200, { suppressions: q.supAll.all() });
    }
    if (req.method === 'DELETE') {
      if (b.confirm !== true) return json(res, 400, { error: 'Confirm first' });
      /* test addresses can never receive mail, so the smoke test may clean up after itself */
      if (!sessionOnly(req) && !isReservedAddress(email)) return json(res, 403, { error: 'Sign in to the admin panel in your browser to do that' });
      q.supDel.run(email); log(null, null, 'unsuppress', null, req, { email });
      return json(res, 200, { suppressions: q.supAll.all() });
    }
  }

  const st = path.match(/^\/api\/admin\/galleries\/(\d+)\/stats$/);
  if (st) {
    const g = q.gallById.get(Number(st[1]));
    if (!g) return json(res, 404, { error: 'not_found' });
    const counts = {}; for (const r of q.evCounts.all(g.id)) counts[r.type] = r.n;
    return json(res, 200, {
      gallery: gallDto(g), counts,
      registrations: q.regList.all(g.id),
      recent: q.evList.all(g.id, 150),
      invites: q.invList.all(g.id),
      reminders: q.remList.all(g.id),
      mail: q.mailFor.all(g.id),
      mailConfigured: mailReady(),
    });
  }

  return json(res, 404, { error: 'not_found' });
}

process.on('unhandledRejection', e => console.error('unhandledRejection:', e?.message || e));
process.on('uncaughtException',  e => console.error('uncaughtException:',  e?.stack || e));

syncAdminUser();
seedTemplates();
seedMailingTemplates();
if (!q.admAny.get().n) console.warn('WARNING: no admin account. Set ADMIN_EMAIL and ADMIN_PASSWORD.');

/* ------------------------------------------------------------------ mailings
   One template sent to many of the people in Contacts. Everything that can go wrong with a mass
   email is handled here on purpose: nobody is mailed without an unsubscribe link that works, a
   confirmation can only authorise the exact list it was shown, the sender survives a restart
   without mailing anyone twice, and a mailing can be stopped. */
const hiddenContacts = () => { try { return new Set(JSON.parse((q.setGet.get('hidden_contacts') || {}).value || '[]')); } catch { return new Set(); } };

/* one row per registration, newest first; the Contacts list and every mailing read from here */
function contactRows(gid) {
  return db.prepare(`
    SELECT r.email, r.name, r.created_at AS reg_at, g.id AS gid, g.title, g.subtitle, g.slug, g.expires_at, g.published_at,
           (SELECT MAX(e.created_at) FROM events e WHERE e.reg_id = r.id AND e.type IN ('download','download_all')) AS dl_at
      FROM registrations r JOIN galleries g ON g.id = r.gallery_id
     WHERE (? IS NULL OR g.id = ?)
     ORDER BY r.created_at DESC`).all(gid, gid);
}

/* an address that unsubscribed ('marketing') still gets the mail it asked for by registering;
   one that opted out of everything, bounced or complained gets nothing at all */
const suppressionMap = () => new Map(q.supAll.all().map(s => [s.email, s]));
function suppressedFor(email, purpose) {
  const s = q.supGet.get(String(email).trim().toLowerCase());
  return !!s && (purpose === 'marketing' || s.scope === 'all');
}

const parseDesign = v => { try { return cleanDesign(v ? JSON.parse(v) : null); } catch { return cleanDesign(null); } };
const tplList = kind => q.tplAll.all(kind).map(t => ({ ...t, design: kind === 'mailing' ? parseDesign(t.design) : null }));
const unsubUrl = (email, mailingId) => `${CFG.publicUrl}/unsubscribe/${unsubToken(email, mailingId, CFG.secret)}`;
const mailCtx = unsubscribe => ({ brand: CFG.brandName, site: CFG.brandUrl, address: CFG.brandAddress, unsubscribe, logo: `${CFG.publicUrl}/brand/logo`,
  social: CFG.brandSocial ? { url: CFG.brandSocial, label: CFG.brandSocialLabel } : null, replyTo: !!CFG.mailReplyTo, imageBase: `${CFG.publicUrl}/mail/img/` });
function recipientView(r) {
  const g = r.gallery_id ? q.gallById.get(r.gallery_id) : null;
  const live = g && g.published_at && !isExpired(g) ? g : null;
  return { name: r.name, gallery: live ? {
    title: live.title, subtitle: prettyDate(live.subtitle), link: galleryUrl(live), cover: `${CFG.publicUrl}/api/g/${encodeURIComponent(live.slug)}/cover`,
    expiry: live.expires_at ? new Date(live.expires_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null,
  } : null };
}

/* one call to the mail service; never throws */
async function resendSend({ to, subject, html, text, headers, idemKey }) {
  try {
    const r = await fetch(`${CFG.resendBase}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${CFG.resendKey}`, 'content-type': 'application/json', ...(idemKey ? { 'idempotency-key': idemKey } : {}) },
      body: JSON.stringify({ from: CFG.mailFrom, to: [to], subject, html, text, ...(headers ? { headers } : {}),
                             ...(CFG.mailReplyTo ? { reply_to: CFG.mailReplyTo } : {}) }),
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await r.text();
    let id = null; try { id = JSON.parse(raw).id || null; } catch {}
    return { ok: r.ok, status: r.status, id, retryAfter: r.headers.get('retry-after'), body: raw.slice(0, 300) };
  } catch (e) { return { ok: false, status: 0, id: null, retryAfter: null, body: String(e.message).slice(0, 300) }; }
}
const listHeaders = url => ({ 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });

/* work out who a request would mail, without mailing anyone */
function mailingPlan(b) {
  const tpl = b.templateId ? q.tplGet.get(Number(b.templateId)) : null;
  const subject = String(b.subject ?? tpl?.subject ?? '').trim();
  const body = String(b.body ?? tpl?.body ?? '');
  if (!subject || !body.trim()) return { error: 'Add a subject and a message' };
  if (subject.length > 200) return { error: 'The subject is too long' };
  const design = b.design !== undefined ? cleanDesign(b.design) : parseDesign(tpl?.design);
  const scan = scanVars(subject, body, design.title, design.preheader, design.button.text);
  if (scan.unknown.length) return { error: `Unknown placeholder${scan.unknown.length > 1 ? 's' : ''}: ${scan.unknown.map(u => `{{${u}}}`).join(', ')}` };
  const a = b.audience || {};
  const gallery = a.gallery && a.gallery !== 'all' ? Number(a.gallery) : null;
  const who = a.who === 'downloaded' ? 'downloaded' : 'any';
  const picked = Array.isArray(a.emails) ? a.emails.map(String) : null;
  const sel = selectRecipients({ rows: contactRows(gallery), hidden: hiddenContacts(), suppressed: suppressionMap(),
                                 gallery, who, picked, usesGallery: scan.usesGallery, needsExpiry: scan.used.includes('expiry') });
  const snapshot = { subject, body, design, name: tpl?.name || 'Untitled' };
  const skipped = {};
  for (const s of sel.skipped) skipped[s.reason] = (skipped[s.reason] || 0) + 1;
  return { snapshot, scan, audience: { gallery: gallery ?? 'all', who, emails: picked }, sel, skipped,
           count: sel.send.length, hash: planHash(snapshot, sel.send) };
}

const mailerState = { running: false, timer: null, fails: new Map() };
const sentLast24 = () => q.sentLast24h.get().n;
const mailingDto = m => {
  const counts = { queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, cancelled: 0, simulated: 0 };
  for (const c of q.mrCounts.all(m.id)) counts[c.status] = c.n;
  return { id: m.id, status: m.status, template: m.template_name, subject: m.subject, total: m.total, dryRun: !!m.dry_run,
           createdAt: m.created_at, startedAt: m.started_at, finishedAt: m.finished_at, error: m.error, counts,
           unsubscribed: q.supCount.get(m.id).n,
           waitingForDailyLimit: m.status === 'sending' && !m.dry_run && sentLast24() >= CFG.mailingDayMax };
};

function mailerStart(delay = 0) {
  clearTimeout(mailerState.timer);
  mailerState.timer = setTimeout(mailerTick, delay);
}
async function mailerTick() {
  if (mailerState.running) return;
  mailerState.running = true;
  let next = CFG.mailingIntervalMs;
  try {
    const m = q.mlActive.get();
    if (!m) { next = null; return; }
    if (m.status === 'queued') q.mlStatus.run('sending', null, m.id);
    q.mlStarted.run(m.id);
    if (!m.dry_run && sentLast24() >= CFG.mailingDayMax) { next = 300_000; return; }   /* the daily limit: carry on when it lifts */
    const r = q.mrNext.get(m.id, Date.now());
    if (!r) {
      const p = q.mrPending.get(m.id);
      if (!p.n) { await finishMailing(m); next = 0; return; }
      next = Math.min(300_000, Math.max(1000, (p.minNext || 0) - Date.now())); return;
    }
    await sendOne(m, r);
    if (m.dry_run) next = 20;
  } catch (e) { console.error('mailer:', e.message); next = 10_000; }
  finally { mailerState.running = false; if (next !== null) mailerStart(next); }
}

async function sendOne(m, r) {
  const mark = (status, o = {}) => q.mrSet.run(status, o.attempts ?? r.attempts, o.nextAt ?? 0, o.since ?? null, o.id ?? r.resend_id, o.error ?? null,
                                              status === 'sent' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, r.id);
  const log = (status, detail) => q.mailIns.run(r.gallery_id || null, r.email, 'mailing', status, detail ? `mailing ${m.id}: ${detail}` : `mailing ${m.id}`);
  if (suppressedFor(r.email, 'marketing')) return mark('skipped', { error: 'unsubscribed' });
  if (isReservedAddress(r.email)) return mark('skipped', { error: 'reserved' });
  const url = unsubUrl(r.email, m.id);
  const out = render({ subject: m.subject, body: m.body, design: parseDesign(m.design) }, recipientView(r), mailCtx(url));
  if (out.unresolved.length) return mark('skipped', { error: 'no_live_gallery' });
  if (m.dry_run || !CFG.mailSend) return mark('simulated');

  const attempts = r.attempts + 1;
  q.mrSet.run('sending', attempts, 0, Date.now(), r.resend_id, null, null, r.id);
  let res;
  try {
    res = await resendSend({ to: r.email, subject: out.subject, html: out.html, text: out.text,
                             headers: listHeaders(url), idemKey: `mailing-${m.id}-${r.id}` });
  } catch (e) { res = { ok: false, status: 0, body: e.message }; }
  const c = classify(res.status, res.retryAfter, attempts);
  if (c.action === 'sent') {
    mailerState.fails.set(m.id, 0);
    mark('sent', { attempts, id: res.id }); log('sent'); return;
  }
  if (c.action === 'retry') {
    mark('queued', { attempts: c.count ? attempts : r.attempts, nextAt: Date.now() + c.delayMs, error: res.body });
    return;
  }
  if (c.action === 'pause') {
    mark('queued', { attempts: r.attempts, error: res.body });
    q.mlStatus.run('paused', `The mail service refused the request (${res.status}). Check the Resend key, then resume.`, m.id);
    await tellAdmin('A mailing was paused', [`The mail service answered ${res.status} to "${m.template_name}", so it has been paused. Check the Resend API key and domain, then resume it from Contacts › Mailings.`]);
    return;
  }
  mark('failed', { attempts, error: res.body }); log('failed', res.body);
  const n = (mailerState.fails.get(m.id) || 0) + 1; mailerState.fails.set(m.id, n);
  if (n >= 10) {
    q.mlStatus.run('paused', 'Ten sends in a row failed, so this was paused.', m.id);
    await tellAdmin('A mailing was paused', [`Ten sends in a row failed for "${m.template_name}", so it has been paused. Last error: ${res.body}`]);
  }
}
async function finishMailing(m) {
  const c = {}; for (const x of q.mrCounts.all(m.id)) c[x.status] = x.n;
  q.mlStatus.run('done', null, m.id); q.mlFinished.run(m.id);
  console.log(`mailing ${m.id} done: ${c.sent || 0} sent, ${c.simulated || 0} simulated, ${c.failed || 0} failed, ${c.skipped || 0} skipped`);
  if (!m.dry_run) await tellAdmin(`Mailing finished: ${m.template_name}`, [
    `${c.sent || 0} sent, ${c.failed || 0} failed, ${c.skipped || 0} left out.` + (c.failed ? ' Open Contacts › Mailings to retry the failed ones.' : '')]);
}
/* after a restart: a send that was in flight is handed to the idempotency key if it is recent
   (the mail service will not send it twice), and flagged if it is too old to trust that */
function mailerRecover() {
  q.mrStaleSending.run(Date.now() - 23 * 3600_000);
  q.mrRecentSending.run(Date.now() - 23 * 3600_000);
  if (q.mlActive.get()) mailerStart(5000);
}

/* ---- pictures for mailings ----
   A mailing's image has to be reachable by anyone who opens the email, for as long as the email
   exists, so it lives in its own folder under an unguessable name and is never deleted. */
const MAIL_IMG_DIR = join(CFG.dataDir, 'mail-images');
if (!existsSync(MAIL_IMG_DIR)) mkdirSync(MAIL_IMG_DIR, { recursive: true });
const MAIL_IMG_MAX = 4 * 1024 * 1024;
const MAIL_IMG_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
function sniffImage(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
async function mailImageRoute(req, res, name) {
  if (!IMAGE_FILE.test(name)) return json(res, 404, { error: 'not_found' });
  const fp = join(MAIL_IMG_DIR, name);
  if (!existsSync(fp)) return json(res, 404, { error: 'not_found' });
  const buf = await readFile(fp);
  res.writeHead(200, { 'content-type': MAIL_IMG_MIME[name.split('.')[1]], 'content-length': buf.length,
                       'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

/* ---- the public unsubscribe page and the bounce webhook ---- */
const pageHtml = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>
body{margin:0;background:#f4f4f4;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a}main{max-width:440px;margin:12vh auto;background:#fff;padding:40px 32px;text-align:center}
h1{font-size:17px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 14px}p{font-size:14px;line-height:1.7;color:#444;margin:0 0 18px}
button{font:inherit;font-size:11px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;padding:14px 30px;background:#1a1a1a;color:#fff;border:0;cursor:pointer}
button.alt{background:none;color:#777;border:1px solid #ccc;margin-top:10px}</style></head><body><main>${inner}</main></body></html>`;
function sendPage(res, code, title, inner) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
  res.end(pageHtml(title, inner));
}
async function unsubscribeRoute(req, res, tok) {
  if (tooManyAttempts(`unsub:${clientIp(req)}`, 30)) return sendPage(res, 429, 'Slow down', '<h1>Too many tries</h1><p>Please wait a few minutes and try again.</p>');
  const info = readUnsubToken(tok, CFG.secret);
  const bad = () => sendPage(res, 400, 'Link not valid', `<h1>This link isn’t valid</h1><p>Reply to the email and ${esc(CFG.brandName || 'we')} will take you off the list by hand.</p>`);
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!info) return bad();
    return sendPage(res, 200, 'Unsubscribe', `<h1>Unsubscribe</h1><p>Stop emails from ${esc(CFG.brandName || 'us')} to <b>${esc(maskEmail(info.email))}</b>?</p>
      <form method="post" action="/unsubscribe/${esc(tok)}"><button type="submit" name="scope" value="marketing">Unsubscribe</button><br>
      <button type="submit" name="scope" value="all" class="alt">Stop all emails, including gallery notices</button></form>`);
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  if (!info) return bad();
  let scope = 'marketing';
  try { scope = new URLSearchParams((await readBuffer(req, 2048)).toString()).get('scope') === 'all' ? 'all' : 'marketing'; } catch {}
  q.supPut.run(info.email, scope, 'unsubscribed', info.mailing, null);
  console.log(`unsubscribed (${scope}) from mailing ${info.mailing || '-'}`);
  return sendPage(res, 200, 'Unsubscribed', `<h1>You’re unsubscribed</h1><p>${scope === 'all' ? 'You won’t get any more email from us, including gallery notices.' : 'You won’t get any more mailings from us. Gallery notices you ask for may still arrive.'}</p>`);
}
const webhookSeen = new Set();
async function mailWebhook(req, res) {
  if (!CFG.resendWebhookSecret) return json(res, 404, { error: 'not_found' });
  let raw;
  try { raw = (await readBuffer(req, 65536)).toString('utf8'); } catch { return json(res, 413, { error: 'too_large' }); }
  if (!verifySvix(req.headers, raw, CFG.resendWebhookSecret)) return json(res, 401, { error: 'bad_signature' });
  const id = req.headers['svix-id'];
  if (webhookSeen.has(id)) return json(res, 200, { ok: true, duplicate: true });
  webhookSeen.add(id); if (webhookSeen.size > 1000) webhookSeen.delete(webhookSeen.values().next().value);
  let ev; try { ev = JSON.parse(raw); } catch { return json(res, 400, { error: 'bad_json' }); }
  const d = ev.data || {}, to = (Array.isArray(d.to) ? d.to : [d.to]).filter(Boolean).map(x => String(x).toLowerCase());
  const permanent = !d.bounce?.type || /permanent|hard/i.test(String(d.bounce.type));
  if ((ev.type === 'email.bounced' && permanent) || ev.type === 'email.complained') {
    const reason = ev.type === 'email.complained' ? 'complained' : 'bounced';
    for (const e of to) { q.supPut.run(e, 'all', reason, null, String(d.bounce?.message || '').slice(0, 200) || null); console.log(`suppressed ${reason}: ${e}`); }
  }
  return json(res, 200, { ok: true });
}

/* ---- the watchdog: things worth an email when they stay wrong ---- */
const fmtGB = n => n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : `${(n / 1e9).toFixed(0)} GB`;
let backedUpSince = 0;
const watchdog = createWatchdog({
  notify: tellAdmin,
  checks: [
    { id: 'immich', title: 'Immich', hint: 'Galleries cannot load photos until this is fixed. Check that the NAS and the Immich container are running, and that the API key has not been revoked.',
      async run() {
        const lim = { signal: AbortSignal.timeout(8000) };
        let r;
        try { r = await immich('/api/server/ping', lim); } catch (e) { return { ok: false, detail: `Cannot reach Immich (${e.message})` }; }
        if (!r.ok) return { ok: false, detail: `Immich answered ${r.status}` };
        /* a quiet canary: the photo lists are the one thing every gallery depends on, and an Immich
           update is the likeliest thing to change their shape */
        const g = q.gallAll.all()[0], st = g && setsOf(g)[0];
        if (!st) return { ok: true, detail: 'Reachable' };
        const b = await immich(`/api/timeline/buckets?albumId=${encodeURIComponent(st.album_id)}`, lim).catch(e => ({ ok: false, status: e.message }));
        if (!b.ok) return { ok: false, detail: `Immich is up but "${g.title}" would not list (${b.status}); the API key may have lapsed` };
        const buckets = await b.json().catch(() => null);
        if (!Array.isArray(buckets)) return { ok: false, detail: 'Immich changed the format of its photo lists; galleries may stop loading' };
        if (buckets.length) {
          const d = await immich(`/api/timeline/bucket?albumId=${encodeURIComponent(st.album_id)}&timeBucket=${encodeURIComponent(buckets[0].timeBucket)}`, lim)
            .then(x => x.ok ? x.json() : null).catch(() => null);
          if (!d || !Array.isArray(d.id)) return { ok: false, detail: 'Immich changed the format of its photo lists; galleries may stop loading' };
        }
        return { ok: true, detail: 'Reachable, photo lists as expected' };
      } },
    { id: 'disk', title: 'Disk space', hint: 'Free some space, or lower ZIP_MAX_GB so prepared zips use less.',
      async run() {
        let free = Infinity;
        for (const d of new Set([CFG.dataDir, CFG.prezip ? ZIP_DIR : null].filter(Boolean))) {
          try { const f = statfsSync(d); free = Math.min(free, f.bavail * f.bsize); } catch {}
        }
        if (free === Infinity) return { ok: true, detail: 'Not measured' };
        return { ok: free >= CFG.healthMinFreeGb * 1e9, detail: `${fmtGB(free)} free` };
      } },
    { id: 'backups', title: 'Backups', hint: 'The nightly database copy has not been written. Check that the backup folder is mounted and writable.',
      async run() {
        if (!CFG.backupDir) return { ok: true, detail: 'Not set up' };
        const newest = backupList()[0];
        if (!newest) return { ok: false, detail: 'No backup found' };
        const hours = Math.floor((Date.now() - Date.parse(newest.at)) / 3600_000);
        return { ok: hours < 36, detail: hours < 1 ? 'Last backup under an hour ago' : `Last backup ${hours} hours ago` };
      } },
    { id: 'zips', title: 'Prepared zips', hint: 'Open the gallery\'s Downloads tab to see why, and Rebuild now once it is fixed.',
      async run() {
        if (!CFG.prezip) return { ok: true, detail: 'Off' };
        const bad = q.zipEvery.all().filter(z => z.status === 'failed');
        if (!bad.length) return { ok: true, detail: 'All building normally' };
        return { ok: false, detail: `${bad.length} failed to build: ` + bad.slice(0, 3).map(z => `${z.slug} / ${z.set_name} (${z.error || 'unknown'})`).join('; ') };
      } },
    { id: 'downloads', title: 'Downloads', hint: 'Your upload speed is probably the limit. The Downloads tab shows the numbers; moving big downloads off your home connection is the fix.',
      async run() {
        const waiting = zipQueue.tickets.filter(t => t.state === 'waiting').length;
        backedUpSince = !waiting ? 0 : backedUpSince || Date.now();
        const mins = backedUpSince ? Math.round((Date.now() - backedUpSince) / 60_000) : 0;
        return mins >= 30 ? { ok: false, detail: `People have been waiting in line for about ${mins} minutes (${waiting} now)` }
                          : { ok: true, detail: waiting ? `${waiting} waiting` : 'Flowing' };
      } },
  ],
});
/* only what has actually been measured is shown on Home */
function watchdogHealth() {
  const out = {};
  for (const [k, v] of Object.entries(watchdog.summary())) if (v.ok !== null) out[k] = { ok: v.ok, detail: v.detail };
  return out;
}

zipRecover();
mailerRecover();

server.listen(CFG.port, '0.0.0.0', () => {
  console.log(`gallery app listening on ${CFG.port}; immich=${CFG.immichUrl}`);
  console.log(CFG.prezip
    ? `downloads: zips kept in ${ZIP_DIR} (up to ${CFG.zipMaxGb} GB), ${CFG.zipMaxActive} at a time, ${CFG.zipTotalMbit || 'unlimited'} Mbit/s shared`
    : `downloads: prepared zips off, ${CFG.zipMaxActive} at a time`);
  console.log(`mailings: ${CFG.mailSend ? 'on' : 'OFF (MAIL_SEND=off, simulated)'}, up to ${CFG.mailingMax} per mailing and ${CFG.mailingDayMax} per day, `
    + `${CFG.brandAddress ? 'footer address set' : 'NO BRAND_ADDRESS (real sends refused)'}, bounce webhook ${CFG.resendWebhookSecret ? 'on' : 'off'}`);
  console.log(`backups: ${CFG.backupDir ? CFG.backupDir + ' (keep ' + CFG.backupKeep + ')' : 'off - set BACKUP_DIR'}`);
  console.log(`admin sign-in: ${CFG.adminEmail || '(none)'}${CFG.admin2fa ? ' + emailed code' : ''}`);
  console.log(mailReady()
    ? `email: on, from ${CFG.mailFrom}${CFG.mailReplyTo ? `, replies to ${CFG.mailReplyTo}` : ''}, reminders ${CFG.remindDays} days before expiry`
    : 'email: off (set RESEND_API_KEY, MAIL_FROM and PUBLIC_URL to enable)');
});

/* a backup at boot and hourly thereafter; runBackup no-ops if today's exists */
setTimeout(() => runBackup(), 20_000);
/* ------------------------------------------------------------- dynamic dns
   The galleries live on a home connection, so the A record is only true until the
   ISP hands out a different address. Nothing used to notice; the first sign was a
   client saying the link was dead. */
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function routable(ip) {
  const m = IPV4.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, Number(m[2]), Number(m[3]), Number(m[4])].some(n => n > 255)) return false;
  if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;   /* carrier NAT: forwarding would be broken anyway */
  return true;
}

/* Two independent answers must agree. One service having a bad day must not be able
   to repoint the domain. The v4-only hostnames matter: asked over a dual-stack
   connection, the ordinary ones answer with this machine's IPv6 address. */
const IP_SOURCES = ['https://api4.ipify.org', 'https://ipv4.icanhazip.com', 'https://checkip.amazonaws.com'];
async function publicIp() {
  const got = [];
  for (const u of IP_SOURCES) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const t = (await r.text()).trim();
      if (routable(t)) got.push(t);
      if (got.length === 2) break;            /* two is enough; the third is a spare */
    } catch { /* offline, or that service is down */ }
  }
  return got.length === 2 && got[0] === got[1] ? got[0] : null;
}

/* Each DNS host is a read and a write of the one A record. Both can be set at once:
   while a domain moves between them it is not obvious which one the world is asking,
   so both are kept right until the old token is removed. */
const hostinger = (path, init = {}) => fetch(`https://developers.hostinger.com/api/dns/v1${path}`, {
  ...init,
  signal: AbortSignal.timeout(20_000),
  headers: { authorization: `Bearer ${CFG.hostingerToken}`, accept: 'application/json', ...(init.headers || {}) },
});

const hostingerDns = {
  name: 'Hostinger',
  async read() {
    const r = await hostinger(`/zones/${encodeURIComponent(CFG.dnsDomain)}`);
    if (!r.ok) throw new Error(`zone read ${r.status}`);
    const zone = await r.json();
    const hit = zone.find(x => x.name === CFG.dnsHost && x.type === 'A');
    return hit?.records?.[0]?.content || null;
  },
  /* Only this one name and type is sent, and Hostinger replaces just the records that
     match - the SPF, DKIM and DMARC entries beside it are never in the payload. */
  async write(ip) {
    const r = await hostinger(`/zones/${encodeURIComponent(CFG.dnsDomain)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overwrite: true,
        zone: [{ name: CFG.dnsHost, type: 'A', ttl: 300, records: [{ content: ip }] }] }),
    });
    if (!r.ok) throw new Error(`zone write ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
  },
};

const cloudflare = async (path, init = {}) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${CFG.cfToken}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) {
    const why = (j.errors || []).map(e => e.message).join('; ') || `HTTP ${r.status}`;
    throw new Error(`Cloudflare ${init.method || 'GET'} ${r.status}: ${why.slice(0, 160)}`);
  }
  return j.result;
};

const cloudflareDns = {
  name: 'Cloudflare',
  zoneId: null, recordId: null,
  async read() {
    if (!this.zoneId) {
      const zones = await cloudflare(`/zones?name=${encodeURIComponent(CFG.dnsDomain)}`);
      if (!zones.length) throw new Error(`no Cloudflare zone for ${CFG.dnsDomain}`);
      this.zoneId = zones[0].id;
    }
    const name = `${CFG.dnsHost}.${CFG.dnsDomain}`;
    const hits = await cloudflare(`/zones/${this.zoneId}/dns_records?type=A&name=${encodeURIComponent(name)}`);
    this.recordId = hits[0]?.id || null;
    return hits[0]?.content || null;
  },
  /* PATCH changes only the address of that one record; its proxy setting and TTL stay
     as they are, and no other record in the zone is part of the request. */
  async write(ip) {
    if (!this.recordId) await this.read();
    if (!this.recordId) throw new Error('record disappeared before it could be updated');
    await cloudflare(`/zones/${this.zoneId}/dns_records/${this.recordId}`, {
      method: 'PATCH', body: JSON.stringify({ content: ip }),
    });
  },
};

const DNS_HOSTS = [CFG.hostingerToken && hostingerDns, CFG.cfToken && cloudflareDns].filter(Boolean);

async function tellAdmin(subject, lines) {
  if (!mailReady() || !CFG.adminEmail) return;
  try {
    const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;color:#1a1a1a">`
      + lines.map(l => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('') + `</div>`;
    const r = await fetch(`${CFG.resendBase}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${CFG.resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: CFG.mailFrom, to: [CFG.adminEmail], subject, html }),
    });
    if (!r.ok) console.error('admin notice failed', r.status);
  } catch (e) { console.error('admin notice failed', e.message); }
}

let dnsSeen = null, dnsTimes = 0, dnsActedAt = 0;
async function dnsCheck() {
  if (!DNS_HOSTS.length || !CFG.dnsDomain || !CFG.dnsHost) return;
  const ip = await publicIp();
  if (!ip) return console.warn('dns: no agreement on the public address, leaving it alone');
  const name = `${CFG.dnsHost}.${CFG.dnsDomain}`;

  /* A host that can't be read, or has no such record, is left alone - this only ever
     corrects an existing record, it never creates one. */
  const stale = [];
  for (const h of DNS_HOSTS) {
    let now;
    try { now = await h.read(); } catch (e) { console.error(`dns (${h.name}):`, e.message); continue; }
    if (now === null) { console.error(`dns (${h.name}): no A record for ${name}`); continue; }
    if (now !== ip) stale.push({ h, now });
  }
  if (!stale.length) { dnsSeen = null; dnsTimes = 0; return; }
  const now = stale.map(s => s.now).join(' / ');
  const where = stale.map(s => s.h.name).join(' and ');

  /* believed only after the same new address twice running */
  if (dnsSeen !== ip) { dnsSeen = ip; dnsTimes = 1;
    return console.warn(`dns: address looks like ${ip}, record says ${now} - waiting for a second reading`); }
  if (++dnsTimes < 2) return;
  if (Date.now() - dnsActedAt < 3600_000) return;            /* one change an hour at most */
  dnsActedAt = Date.now(); dnsSeen = null; dnsTimes = 0;

  if (!CFG.dnsApply) {
    console.warn(`dns: ${name} should be ${ip} but is ${now} in ${where} (DNS_APPLY is off)`);
    return tellAdmin(`Your galleries' address has changed`, [
      `${name} still points at ${now} in ${where}, but this connection is now on ${ip}.`,
      `Automatic updating is switched off, so nothing has been changed. Until the record is corrected in ${where}, gallery links may not work.`,
    ]);
  }
  const failed = [];
  for (const { h, now: was } of stale) {
    try {
      await h.write(ip);
      console.log(`dns (${h.name}): ${name} ${was} -> ${ip}`);
    } catch (e) {
      console.error(`dns write failed (${h.name}):`, e.message);
      failed.push(`${h.name}: ${e.message}`);
    }
  }
  if (!failed.length) {
    await tellAdmin(`Gallery address updated`, [
      `Your connection moved from ${now} to ${ip}, so ${name} has been repointed in ${where}.`,
      `Links should work again within five minutes. Nothing else in the DNS was touched.`,
    ]);
  } else {
    await tellAdmin(`Couldn't update your galleries' address`, [
      `${name} points at ${now} but this connection is now on ${ip}, and the update failed - ${failed.join('; ')}`,
      `Gallery links may not work until the record is corrected by hand.`,
    ]);
  }
}
if (DNS_HOSTS.length && CFG.dnsDomain && CFG.dnsHost) {
  console.log(`dynamic dns: ${CFG.dnsHost}.${CFG.dnsDomain} in ${DNS_HOSTS.map(h => h.name).join(' + ')}`
    + ` every ${CFG.dnsEvery} min` + (CFG.dnsApply ? '' : ' (watching only)'));
  setTimeout(() => dnsCheck().catch(e => console.error('dns:', e.message)), 20_000);
  setInterval(() => dnsCheck().catch(e => console.error('dns:', e.message)), CFG.dnsEvery * 60_000);
} else console.log('dynamic dns: off');

setInterval(() => runBackup(), 3600_000);

/* expiry reminders: shortly after boot, then hourly */
setTimeout(() => expirySweep().catch(e => console.error('sweep:', e.message)), 60_000);
setInterval(() => expirySweep().catch(e => console.error('sweep:', e.message)), 3600_000);

/* prepared zips: first look shortly after boot, then on a timer; a watchdog frees stuck download slots */
if (CFG.prezip) {
  setTimeout(() => zipSweep().catch(e => console.error('zip sweep:', e.message)), 90_000);
  setInterval(() => zipSweep().catch(e => console.error('zip sweep:', e.message)), CFG.zipSweepMin * 60_000);
}
setInterval(() => zipQueue.tick(), 15_000);
if (CFG.healthMinutes > 0) {
  setTimeout(() => watchdog.run().catch(e => console.error('watchdog:', e.message)), CFG.healthFirstSec * 1000);
  setInterval(() => watchdog.run().catch(e => console.error('watchdog:', e.message)), CFG.healthMinutes * 60_000);
}
/* old download figures are not worth keeping past a year */
setInterval(() => {
  try { q.mlPrune.run(); q.statsPrune.run(); q.peaksPrune.run(new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 13)); } catch {}
}, 6 * 3600_000);

site.startJobs();
