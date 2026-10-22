/* Client gallery platform - Phase 1
   Node 24, no npm dependencies. Immich is the photo engine; this owns the
   client relationship: access gates, sessions and the activity log. */

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHmac, timingSafeEqual, scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readdirSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const CFG = {
  port:       Number(process.env.PORT || 3000),
  immichUrl:  (process.env.IMMICH_URL || '').replace(/\/+$/, ''),
  immichKey:   process.env.IMMICH_API_KEY || '',
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
  require_email   INTEGER NOT NULL DEFAULT 0,
  password_hash   TEXT,
  password_salt   TEXT,
  allow_download  INTEGER NOT NULL DEFAULT 1,
  expires_at      TEXT,
  published_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS registrations (
  id          INTEGER PRIMARY KEY,
  gallery_id  INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (gallery_id, email)
);

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

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

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
  evIns:      db.prepare('INSERT INTO events (gallery_id,reg_id,type,asset_id,ip,ua) VALUES (?,?,?,?,?,?)'),
  evList:     db.prepare('SELECT * FROM events WHERE gallery_id = ? ORDER BY created_at DESC LIMIT ?'),
  evCounts:   db.prepare(`SELECT type, COUNT(*) n FROM events WHERE gallery_id = ? GROUP BY type`),
  gallDel:    db.prepare('DELETE FROM galleries WHERE id = ?'),
  gallUpd:    db.prepare(`UPDATE galleries SET slug=?, title=?, subtitle=?, album_id=?, cover_asset_id=?,
                 require_email=?, allow_download=?, expires_at=?, published_at=? WHERE id=?`),
  gallPw:     db.prepare('UPDATE galleries SET password_hash=?, password_salt=? WHERE id=?'),
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
  tplAll:     db.prepare('SELECT * FROM email_templates ORDER BY built_in DESC, name'),
  tplGet:     db.prepare('SELECT * FROM email_templates WHERE id = ?'),
  tplIns:     db.prepare('INSERT INTO email_templates (name,subject,body,built_in) VALUES (?,?,?,?)'),
  tplUpd:     db.prepare('UPDATE email_templates SET name=?, subject=?, body=? WHERE id=?'),
  tplDel:     db.prepare('DELETE FROM email_templates WHERE id = ? AND built_in = 0'),
  tplCount:   db.prepare('SELECT COUNT(*) n FROM email_templates'),
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
    1);
  q.tplIns.run('Short and warm',
    '{{title}} \u2014 your gallery is live',
    "Hi,\n\nHere are your photos. I hope you love them as much as I enjoyed taking them.",
    0);
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
function adminOk(req) {
  const hdr = req.headers['x-admin-token'];
  if (hdr && constEq(hdr, CFG.adminToken)) return true;
  const p = unsign(cookies(req)['adm'] || '');
  return !!(p && p.adm === true);
}
const isExpired = g => !!g.expires_at && new Date(g.expires_at).getTime() < Date.now();

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

function log(gallery, regId, type, assetId, req) {
  try {
    q.evIns.run(gallery?.id ?? null, regId ?? null, type, assetId ?? null,
                clientIp(req), (req.headers['user-agent'] || '').slice(0, 300));
  } catch (e) { console.error('log failed', e.message); }
}

function json(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8',
                        'cache-control': 'no-store', ...headers });
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
    .replace(/\{\{\s*subtitle\s*\}\}/gi, g.subtitle || '')
    .replace(/\{\{\s*link\s*\}\}/gi, url)
    .replace(/\{\{\s*expiry\s*\}\}/gi, when)
    .replace(/\{\{\s*brand\s*\}\}/gi, CFG.brandName || '');
}

function galleryUrl(g) { return `${CFG.publicUrl}/g/${g.slug}`; }

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
        text-transform:uppercase;color:#8a8a8a;margin-top:9px">${esc(g.subtitle)}</div>` : ''}
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

async function sendMailKind(g, email, kind, logKind, extra) {
  if (!mailReady()) throw new Error('email is not configured');
  const t = tmpl(kind, g, extra);
  try {
    const r = await fetch('https://api.resend.com/emails', {
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

    const size = statSync(final).size;
    console.log(`backup written: ${final} (${(size / 1024).toFixed(0)} KB)`);
    return { file: final, size };
  } catch (e) {
    console.error('backup failed:', e.message);
    return { error: e.message };
  }
}

function backupList() {
  if (!CFG.backupDir || !existsSync(CFG.backupDir)) return [];
  return readdirSync(CFG.backupDir)
    .filter(f => /^gallery-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort().reverse()
    .map(f => { const st = statSync(join(CFG.backupDir, f)); return { file: f, size: st.size, at: st.mtime.toISOString() }; });
}

/* ------------------------------------------------------------------- immich */
async function immich(path, init = {}) {
  const r = await fetch(CFG.immichUrl + path, {
    ...init,
    headers: { 'x-api-key': CFG.immichKey, ...(init.headers || {}) },
  });
  return r;
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
    const list = await albumAssets(albumId);
    c = { ids: new Set(list.map(a => a.id)), at: Date.now() };
    albumSets.set(albumId, c);
    return c.ids.has(assetId);
  }
  return false;
}

async function albumAssets(albumId) {
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;

  try {
    /* ---- health ---- */
    if (path === '/healthz') return json(res, 200, { ok: true });

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
      res.writeHead(302, { location: '/g/' + encodeURIComponent(slug) });
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

    if (path === '/g' || path.startsWith('/g/')) return await serveStatic(res, 'index.html');
    if (path === '/') { res.writeHead(302, { location: '/g/' }); return res.end(); }

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
      subtitle: gallery.subtitle,
      cover: `/api/g/${gallery.slug}/cover`,
      allowDownload: !!gallery.allow_download,
      expiresAt: gallery.expires_at,
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
    let id = gallery.cover_asset_id;
    if (id && !(await albumHas(gallery.album_id, id))) id = null;   /* never serve outside the album */
    if (!id) {
      try { id = (await albumAssets(gallery.album_id)).find(a => a.isImage)?.id; } catch {}
    }
    if (!id) { res.writeHead(404); return res.end(); }
    return proxyImage(res, id, 'preview');
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
    const list = await albumAssets(gallery.album_id);
    log(gallery, who.r, 'view', null, req);
    return json(res, 200, { assets: list });
  }

  const img = rest.match(/^\/img\/([0-9a-f-]{36})$/i);
  if (img) {
    if (!(await albumHas(gallery.album_id, img[1]))) {
      log(gallery, who.r, 'asset_denied', img[1], req);
      return json(res, 404, { error: 'not_found' });
    }
    const size = url.searchParams.get('size') || 'thumbnail';
    if (size === 'original') {
      if (!gallery.allow_download) return json(res, 403, { error: 'download_disabled' });
      log(gallery, who.r, 'download', img[1], req);
    }
    return proxyImage(res, img[1], size);
  }

  if (rest === '/zip' && req.method === 'POST') {
    if (!gallery.allow_download) return json(res, 403, { error: 'download_disabled' });
    const list = await albumAssets(gallery.album_id);
    log(gallery, who.r, 'download_all', null, req);
    const up = await immich('/api/download/archive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetIds: list.map(a => a.id) }),
    });
    res.writeHead(up.status, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${gallery.slug}.zip"`,
      ...(up.headers.get('content-length') ? { 'content-length': up.headers.get('content-length') } : {}),
    });
    const reader = up.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); }
    return res.end();
  }

  return json(res, 404, { error: 'not_found' });
}

async function proxyImage(res, assetId, size) {
  const path = size === 'original'
    ? `/api/assets/${assetId}/original`
    : `/api/assets/${assetId}/thumbnail?size=${encodeURIComponent(size)}`;
  const up = await immich(path);
  if (!up.ok) { res.writeHead(up.status); return res.end(); }
  const headers = {
    'content-type': up.headers.get('content-type') || 'application/octet-stream',
    'cache-control': 'private, max-age=86400',
  };
  const cd = up.headers.get('content-disposition'); if (cd) headers['content-disposition'] = cd;
  const cl = up.headers.get('content-length');      if (cl) headers['content-length'] = cl;
  res.writeHead(200, headers);
  const reader = up.body.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); }
  res.end();
}

function gallDto(g) {
  return {
    id: g.id, slug: g.slug, title: g.title, subtitle: g.subtitle,
    albumId: g.album_id, coverAssetId: g.cover_asset_id,
    requireEmail: !!g.require_email, hasPassword: !!g.password_hash,
    allowDownload: !!g.allow_download, expiresAt: g.expires_at,
    publishedAt: g.published_at, expired: isExpired(g),
    registrations: q.regCount.get(g.id).n,
    views: q.evCount1.get(g.id, 'view').n,
    downloads: q.evCount1.get(g.id, 'download').n + q.evCount1.get(g.id, 'download_all').n,
  };
}

async function adminRoutes(req, res, path, url) {
  if (path === '/api/admin/me') return json(res, 200, { ok: true, publicUrl: CFG.publicUrl || null });

  if (path === '/api/admin/albums') {
    const albums = await immichJson('/api/albums');
    return json(res, 200, albums.map(a => ({
      id: a.id, name: a.albumName, count: a.assetCount, thumb: a.albumThumbnailAssetId,
    })));
  }

  const am = path.match(/^\/api\/admin\/albums\/([0-9a-f-]{36})\/assets$/i);
  if (am) {
    const list = await albumAssets(am[1]);
    return json(res, 200, { assets: list.slice(0, 400) });
  }

  const im = path.match(/^\/api\/admin\/img\/([0-9a-f-]{36})$/i);
  if (im) return proxyImage(res, im[1], url.searchParams.get('size') || 'thumbnail');

  if (path === '/api/admin/galleries' && req.method === 'GET')
    return json(res, 200, q.gallAll.all().map(gallDto));

  if (path === '/api/admin/galleries' && req.method === 'POST') {
    const b = await readJson(req);
    if (!b.slug || !b.title || !b.albumId) return json(res, 400, { error: 'slug, title and albumId are required' });
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/i.test(b.slug)) return json(res, 400, { error: 'slug must be letters, numbers and dashes' });
    let hash = null, salt = null;
    if (b.password) { salt = randomBytes(16).toString('hex'); hash = hashPw(String(b.password), salt); }
    try {
      q.gallIns.run(String(b.slug).toLowerCase(), String(b.title), b.subtitle || null, String(b.albumId),
        b.coverAssetId || null, b.requireEmail ? 1 : 0, hash, salt,
        b.allowDownload === false ? 0 : 1, b.expiresAt || null,
        b.publish === false ? null : new Date().toISOString());
    } catch (e) { return json(res, 409, { error: 'That web address is already taken' }); }
    const created = q.gallBySlug.get(String(b.slug).toLowerCase());
    applyDefaultReminders(created.id);
    return json(res, 201, gallDto(created));
  }

  const one = path.match(/^\/api\/admin\/galleries\/(\d+)$/);
  if (one) {
    const g = q.gallById.get(Number(one[1]));
    if (!g) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET') return json(res, 200, gallDto(g));

    if (req.method === 'DELETE') { q.gallDel.run(g.id); return json(res, 200, { ok: true }); }

    if (req.method === 'PATCH') {
      const b = await readJson(req);
      const slug = (b.slug ?? g.slug).toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,60}$/i.test(slug)) return json(res, 400, { error: 'slug must be letters, numbers and dashes' });
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
      if (b.password !== undefined) {
        if (b.password) { const salt = randomBytes(16).toString('hex'); q.gallPw.run(hashPw(String(b.password), salt), salt, g.id); }
        else q.gallPw.run(null, null, g.id);
      }
      return json(res, 200, gallDto(q.gallById.get(g.id)));
    }
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
    return json(res, 200, { dir: CFG.backupDir || null, keep: CFG.backupKeep, backups: backupList() });
  }

  if (path === '/api/admin/mail-status')
    return json(res, 200, { configured: mailReady(), from: CFG.mailFrom || null, replyTo: CFG.mailReplyTo || null, remindDays: CFG.remindDays });

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
      return json(res, 200, { templates: q.tplAll.all(), lastUsed: row ? Number(row.value) : null });
    }
    if (req.method === 'POST') {
      const b = await readJson(req);
      const name = String(b.name || '').trim();
      if (!name) return json(res, 400, { error: 'Give the template a name' });
      try { q.tplIns.run(name, String(b.subject || ''), String(b.body || ''), 0); }
      catch { return json(res, 409, { error: 'A template with that name already exists' }); }
      return json(res, 201, { templates: q.tplAll.all() });
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
                     String(b.body ?? t.body), t.id);
      } catch { return json(res, 409, { error: 'A template with that name already exists' }); }
      return json(res, 200, { templates: q.tplAll.all() });
    }
    if (req.method === 'DELETE') {
      if (t.built_in) return json(res, 400, { error: 'The built-in template cannot be deleted' });
      q.tplDel.run(t.id);
      return json(res, 200, { templates: q.tplAll.all() });
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
      try { await sendMail(g, email, 'ready', extra); sent++; }
      catch (e) { failed.push({ email, error: String(e.message).slice(0, 160) }); }
    }
    let copy = null;
    if (b.sendCopy && CFG.adminEmail) {
      try { await sendMailKind(g, CFG.adminEmail, 'ready', 'copy', extra); copy = CFG.adminEmail; }
      catch (e) { failed.push({ email: CFG.adminEmail, error: String(e.message).slice(0, 160) }); }
    }
    return json(res, 200, { sent, copySentTo: copy, failed });
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
if (!q.admAny.get().n) console.warn('WARNING: no admin account. Set ADMIN_EMAIL and ADMIN_PASSWORD.');

server.listen(CFG.port, '0.0.0.0', () => {
  console.log(`gallery app listening on ${CFG.port}; immich=${CFG.immichUrl}`);
  console.log(`backups: ${CFG.backupDir ? CFG.backupDir + ' (keep ' + CFG.backupKeep + ')' : 'off - set BACKUP_DIR'}`);
  console.log(`admin sign-in: ${CFG.adminEmail || '(none)'}${CFG.admin2fa ? ' + emailed code' : ''}`);
  console.log(mailReady()
    ? `email: on, from ${CFG.mailFrom}${CFG.mailReplyTo ? `, replies to ${CFG.mailReplyTo}` : ''}, reminders ${CFG.remindDays} days before expiry`
    : 'email: off (set RESEND_API_KEY, MAIL_FROM and PUBLIC_URL to enable)');
});

/* a backup at boot and hourly thereafter; runBackup no-ops if today's exists */
setTimeout(() => runBackup(), 20_000);
setInterval(() => runBackup(), 3600_000);

/* expiry reminders: shortly after boot, then hourly */
setTimeout(() => expirySweep().catch(e => console.error('sweep:', e.message)), 60_000);
setInterval(() => expirySweep().catch(e => console.error('sweep:', e.message)), 3600_000);
