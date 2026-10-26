import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS, validate } from '../settings.mjs';
import { loadConfig, toCfg, saveFile, redact, needsSetup, FILE_NAME } from '../store.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'cfg-'));
const here = dirname(fileURLToPath(import.meta.url));

/* A frozen copy of how server.mjs built CFG before settings moved here. If the new code ever gives a
   different answer for the same environment, an install that has run for months would change under
   its owner, so this test is the guard. */
const legacy = e => ({
  port: Number(e.PORT || 3000), immichUrl: (e.IMMICH_URL || '').replace(/\/+$/, ''), immichKey: e.IMMICH_API_KEY || '',
  immichWriteKey: e.IMMICH_WRITE_KEY || '', uploadMaxMb: Number(e.UPLOAD_MAX_MB || 250), uploadMaxVideoMb: Number(e.UPLOAD_MAX_VIDEO_MB || 4096),
  secret: e.APP_SECRET || '', adminToken: e.ADMIN_TOKEN || '', dataDir: e.DATA_DIR || '/data', webDir: e.WEB_DIR || '/app/web',
  sessionDays: Number(e.SESSION_DAYS || 30), publicUrl: (e.PUBLIC_URL || '').replace(/\/+$/, ''), resendKey: e.RESEND_API_KEY || '',
  mailFrom: e.MAIL_FROM || '', remindDays: Number(e.REMIND_DAYS || 7), mailReplyTo: e.MAIL_REPLY_TO || '',
  adminEmail: (e.ADMIN_EMAIL || '').trim().toLowerCase(), adminPass: e.ADMIN_PASSWORD || '', admin2fa: (e.ADMIN_2FA || 'on').toLowerCase() !== 'off',
  backupDir: e.BACKUP_DIR || '', backupKeep: Number(e.BACKUP_KEEP || 14), brandName: e.BRAND_NAME || '', brandUrl: e.BRAND_URL || '',
  brandSocial: e.BRAND_SOCIAL || '', brandSocialLabel: e.BRAND_SOCIAL_LABEL || '', hostingerToken: e.HOSTINGER_TOKEN || '',
  cfToken: e.CLOUDFLARE_TOKEN || '', dnsDomain: e.DNS_DOMAIN || '', dnsHost: e.DNS_HOST || '', dnsApply: (e.DNS_APPLY || 'on').toLowerCase() !== 'off',
  dnsEvery: Number(e.DNS_CHECK_MINUTES || 10), cfAccountId: e.CF_ACCOUNT_ID || '', cfPagesToken: e.CF_PAGES_TOKEN || '',
  cfPagesProject: e.CF_PAGES_PROJECT || '', siteUrl: (e.SITE_URL || '').replace(/\/+$/, ''), prezip: (e.PREZIP || 'on').toLowerCase() !== 'off',
  zipDir: e.ZIP_DIR || '', zipMaxActive: Number(e.ZIP_MAX_ACTIVE || 3), zipTotalMbit: Number(e.ZIP_TOTAL_MBIT || 120), zipRateMbit: Number(e.ZIP_RATE_MBIT || 0),
  zipMaxGb: Number(e.ZIP_MAX_GB || 100), zipMinFreeGb: Number(e.ZIP_MIN_FREE_GB || 50), zipSweepMin: Number(e.ZIP_SWEEP_MINUTES || 60),
  zipSettleMin: Number(e.ZIP_SETTLE_MINUTES || 10), zipStallSec: Number(e.ZIP_STALL_SECONDS || 120), healthMinutes: Number(e.HEALTH_MINUTES || 30),
  brandAddress: e.BRAND_ADDRESS || '', mailingMax: Number(e.MAILING_MAX || 500), mailingDayMax: Number(e.MAILING_DAY_MAX || 500),
  mailingIntervalMs: Number(e.MAILING_INTERVAL_MS || 600), mailSend: (e.MAIL_SEND || 'on').toLowerCase() !== 'off',
  resendWebhookSecret: e.RESEND_WEBHOOK_SECRET || '', resendBase: (e.RESEND_API_URL || 'https://api.resend.com').replace(/\/+$/, ''),
  healthFirstSec: Number(e.HEALTH_FIRST_SECONDS || 120), healthMinFreeGb: Number(e.HEALTH_MIN_FREE_GB || 20),
});
const viaConfig = env => toCfg(loadConfig(env, tmp(), { generate: false }));
/* settings added later are new keys; what the server always read must come out exactly as before */
const legacyKeys = Object.keys(legacy({}));
const only = (cfg, keys = legacyKeys) => Object.fromEntries(keys.map(k => [k, cfg[k]]));

const FULL = { PORT: '8080', IMMICH_URL: 'http://immich:2283///', IMMICH_API_KEY: 'k', IMMICH_WRITE_KEY: 'w', UPLOAD_MAX_MB: '10', APP_SECRET: 's', ADMIN_TOKEN: 't',
  DATA_DIR: '/x', WEB_DIR: '/w', SESSION_DAYS: '7', PUBLIC_URL: 'https://g.test/', RESEND_API_KEY: 'r', MAIL_FROM: 'A <a@b.co>', REMIND_DAYS: '3',
  MAIL_REPLY_TO: 'r@b.co', ADMIN_EMAIL: '  Me@Example.COM ', ADMIN_PASSWORD: 'pw', ADMIN_2FA: 'OFF', BACKUP_DIR: '/b', BACKUP_KEEP: '5', BRAND_NAME: 'N',
  DNS_APPLY: 'off', PREZIP: 'Off', MAIL_SEND: 'off', SITE_URL: 'https://s.test//', ZIP_MAX_GB: '0', HEALTH_MINUTES: '0', RESEND_API_URL: 'http://127.0.0.1:2998/' };

test('golden: the same environment gives exactly the CFG the server always built', () => {
  assert.deepEqual(only(viaConfig(FULL)), legacy(FULL));
  assert.deepEqual(only(viaConfig({})), legacy({}));
  const odd = { PORT: '', IMMICH_URL: '', ADMIN_2FA: '', UPLOAD_MAX_MB: 'abc', MAIL_SEND: 'On', DNS_APPLY: 'OFF', REMIND_DAYS: '0' };
  assert.deepEqual(only(viaConfig(odd)), legacy(odd));   /* includes NaN from a nonsense number, exactly as before */
});

test('the live install\'s shape: the four essentials from env and nothing else', () => {
  const env = { IMMICH_URL: 'http://nas:2283', IMMICH_API_KEY: 'k', APP_SECRET: 's', ADMIN_TOKEN: 't', DATA_DIR: '/data' };
  const dir = tmp();
  const conf = loadConfig(env, dir);
  assert.deepEqual(only(toCfg(conf)), legacy(env));
  assert.equal(needsSetup(conf), false);
  assert.deepEqual(readdirSync(dir), [], 'no settings file is written when the environment is complete');
});

test('env beats the file, which beats the default, key by key', () => {
  const dir = tmp();
  saveFile(dir, { IMMICH_URL: 'http://file:1', BRAND_NAME: 'From File', MAIL_FROM: 'A <a@b.co>' });
  const conf = loadConfig({ IMMICH_URL: 'http://env:2', MAIL_FROM: 'B <b@b.co>' }, dir);
  assert.equal(conf.raw.IMMICH_URL, 'http://env:2'); assert.equal(conf.sources.IMMICH_URL, 'env');
  assert.equal(conf.raw.BRAND_NAME, 'From File'); assert.equal(conf.sources.BRAND_NAME, 'file');
  assert.equal(conf.raw.MAIL_FROM, 'B <b@b.co>');
  assert.equal(conf.sources.PUBLIC_URL, 'default');
  assert.equal(toCfg(conf).mailSend, true);
});

test('env-only settings are never read from the file', () => {
  const dir = tmp();
  saveFile(dir, { PORT: '1', ADMIN_PASSWORD: 'nope', DATA_DIR: '/elsewhere' });
  const cfg = toCfg(loadConfig({}, dir, { generate: false }));
  assert.equal(cfg.port, 3000); assert.equal(cfg.adminPass, ''); assert.equal(cfg.dataDir, '/data');
});

test('the app makes its own secrets once, never overwrites them, and does not make what env supplies', () => {
  const dir = tmp();
  const a = loadConfig({}, dir);
  assert.ok(a.raw.APP_SECRET.length >= 40 && a.raw.ADMIN_TOKEN.length >= 40);
  assert.equal(a.sources.APP_SECRET, 'generated');
  const b = loadConfig({}, dir);
  assert.equal(b.raw.APP_SECRET, a.raw.APP_SECRET); assert.equal(b.sources.APP_SECRET, 'file');
  const dir2 = tmp();
  const c = loadConfig({ APP_SECRET: 'mine' }, dir2);
  assert.equal(c.raw.APP_SECRET, 'mine'); assert.notEqual(c.raw.ADMIN_TOKEN, undefined);
  assert.equal(JSON.parse(readFileSync(join(dir2, FILE_NAME), 'utf8')).settings.APP_SECRET, undefined, 'a secret from env is not copied to disk');
});

test('the settings file is private and written whole', () => {
  const dir = tmp();
  const r = saveFile(dir, { BRAND_NAME: 'X' }, { setupCompletedAt: 'now' });
  assert.equal(r.mode, 0o600); assert.equal(r.private, true);
  assert.equal(statSync(join(dir, FILE_NAME)).mode & 0o777, 0o600);
  assert.ok(!existsSync(join(dir, FILE_NAME + '.tmp')));
  assert.equal(JSON.parse(readFileSync(join(dir, FILE_NAME), 'utf8')).meta.setupCompletedAt, 'now');
  saveFile(dir, { BRAND_NAME: '' });
  assert.equal(JSON.parse(readFileSync(join(dir, FILE_NAME), 'utf8')).settings.BRAND_NAME, undefined, 'an empty value clears the setting');
});

test('what a browser may see never includes a secret value', () => {
  const dir = tmp();
  const conf = loadConfig({ IMMICH_URL: 'http://i:1', IMMICH_API_KEY: 'SECRET-KEY-123', RESEND_API_KEY: 're_SECRET', BRAND_NAME: 'Studio' }, dir);
  const out = JSON.stringify(redact(conf));
  assert.ok(!out.includes('SECRET-KEY-123') && !out.includes('re_SECRET') && !out.includes(conf.raw.APP_SECRET) && !out.includes(conf.raw.ADMIN_TOKEN));
  assert.equal(redact(conf).IMMICH_API_KEY.set, true); assert.equal(redact(conf).IMMICH_API_KEY.locked, true);
  assert.equal(redact(conf).BRAND_NAME.value, 'Studio');
});

test('setup is needed until Immich is configured, from either source', () => {
  const dir = tmp();
  assert.equal(needsSetup(loadConfig({}, dir)), true);
  assert.equal(needsSetup(loadConfig({ IMMICH_URL: 'http://i' }, dir)), true);
  saveFile(dir, { IMMICH_URL: 'http://i:1', IMMICH_API_KEY: 'k' });
  assert.equal(needsSetup(loadConfig({}, dir)), false);
});

test('validation catches the mistakes people really make', () => {
  assert.equal(validate('IMMICH_URL', 'immich:2283').ok, false);
  assert.equal(validate('IMMICH_URL', 'http://192.168.1.2:2283/').value, 'http://192.168.1.2:2283');
  assert.equal(validate('ADMIN_EMAIL', 'me@x').ok, false);
  assert.equal(validate('ADMIN_EMAIL', ' Me@X.com ').value, 'me@x.com');
  assert.equal(validate('MAIL_FROM', 'Studio <hello@x.com>').ok, true);
  assert.equal(validate('MAIL_FROM', 'hello').ok, false);
  assert.equal(validate('MAILING_MAX', '-5').ok, false);
  assert.equal(validate('ADMIN_2FA', 'maybe').ok, false);
  assert.equal(validate('BRAND_NAME', 'a\nb').ok, false);
  assert.equal(validate('NOPE', 'x').ok, false);
});

test('drift: every environment variable the server reads is described here, and documented', () => {
  const known = new Set(SETTINGS.map(s => s.env));
  const root = join(here, '..', '..');
  const src = readFileSync(join(root, 'server.mjs'), 'utf8');
  const used = new Set([...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map(m => m[1]));
  for (const u of used) assert.ok(known.has(u) || ['NODE_ENV', 'IMMICHSET_VERSION', 'TZ'].includes(u), `server.mjs reads ${u} but it is not in config/settings.mjs`);
  const compose = readFileSync(join(root, 'docker-compose.example.yml'), 'utf8');
  for (const s of SETTINGS) if (!s.hidden && !s.envOnly || ['PORT', 'DATA_DIR'].includes(s.env)) assert.ok(compose.includes(s.env), `${s.env} is not in docker-compose.example.yml`);
});

test('settings added for the bundled install are off or empty unless set, and never touch an existing install', () => {
  const c = viaConfig({});
  assert.equal(c.clientIpHeader, ''); assert.equal(c.setupFromInternet, false); assert.equal(c.immichBundled, '');
  assert.equal(c.immichHint, ''); assert.equal(c.bundledImport, ''); assert.equal(c.bundledMl, true);
  const on = viaConfig({ SETUP_FROM_INTERNET: 'on', IMMICHSET_BUNDLED_IMMICH: 'http://immich-server:2283/', IMMICHSET_BUNDLED_ML: 'off', CLIENT_IP_HEADER: 'cf-connecting-ip' });
  assert.equal(on.setupFromInternet, true); assert.equal(on.immichBundled, 'http://immich-server:2283'); assert.equal(on.bundledMl, false);
  assert.equal(on.clientIpHeader, 'cf-connecting-ip');
});

test('the visitor-address header can only be one the app knows how to use', () => {
  assert.equal(validate('CLIENT_IP_HEADER', 'cf-connecting-ip').ok, true);
  assert.equal(validate('CLIENT_IP_HEADER', 'none').ok, true);
  assert.equal(validate('CLIENT_IP_HEADER', 'x-anything').ok, false);
  assert.equal(validate('CLIENT_IP_HEADER', '').ok, true, 'empty means the default');
});

test('the time zone: real names pass, nonsense is refused, env beats the saved value, and nothing is set by default', () => {
  assert.equal(validate('TZ', 'America/Chicago').ok, true);
  assert.equal(validate('TZ', 'UTC').ok, true);
  assert.equal(validate('TZ', 'Mars/Olympus').ok, false);
  assert.equal(validate('TZ', '').value, '');
  const dir = tmp();
  saveFile(dir, { TZ: 'America/Denver' });
  assert.equal(toCfg(loadConfig({ PORT: '3000' }, dir, { generate: false })).timeZone, 'America/Denver');
  assert.equal(toCfg(loadConfig({ TZ: 'Europe/Paris' }, dir, { generate: false })).timeZone, 'Europe/Paris');
  assert.equal(toCfg(loadConfig({}, tmp(), { generate: false })).timeZone, '');
});
