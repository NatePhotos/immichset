/* Where settings come from. The settings file (written by the setup page and the admin panel) wins;
   then environment variables; then the defaults. Nothing here touches the network or the database.

   The file is not encrypted, on purpose: the key to decrypt it would have to sit beside it, which
   protects nothing against anyone who can read the data folder. It is kept mode 0600 and is never
   copied into the backup folder, because that may be a shared drive. */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { SETTINGS, BY_ENV, normalise } from './settings.mjs';

export const FILE_NAME = 'immichset.json';
const GENERATED = ['APP_SECRET', 'ADMIN_TOKEN'];
const fileOf = dir => join(dir, FILE_NAME);

function readFileSafe(dir) {
  try {
    const j = JSON.parse(readFileSync(fileOf(dir), 'utf8'));
    return { settings: j && typeof j.settings === 'object' && j.settings ? j.settings : {}, meta: j && typeof j.meta === 'object' && j.meta ? j.meta : {} };
  } catch { return { settings: {}, meta: {} }; }
}

/* mode 0600, written whole or not at all. A network share may ignore the mode; say so. */
export function saveFile(dir, patch = {}, meta = {}) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cur = readFileSafe(dir);
  const settings = { ...cur.settings };
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v === null || v === undefined) delete settings[k]; else settings[k] = String(v); }
  const out = { settings, meta: { ...cur.meta, ...meta } };
  const tmp = fileOf(dir) + '.tmp';
  writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch {}
  renameSync(tmp, fileOf(dir));
  let mode = null; try { mode = statSync(fileOf(dir)).mode & 0o777; } catch {}
  return { path: fileOf(dir), mode, private: mode === 0o600 };
}

/* file > env > default, one setting at a time.
   `generate: false` is for tests and dry runs: it never writes the file. */
export function loadConfig(env, dataDir, { generate = true } = {}) {
  const file = readFileSafe(dataDir);
  const raw = {}, sources = {};
  for (const s of SETTINGS) {
    const fromEnv = env[s.env];
    const fromFile = s.envOnly ? undefined : file.settings[s.env];
    /* a value saved from the panel beats the compose file's; clearing it there goes back to the compose file's */
    if (fromFile !== undefined && fromFile !== '') { raw[s.env] = fromFile; sources[s.env] = 'file'; }
    else if (fromEnv !== undefined && fromEnv !== '') { raw[s.env] = fromEnv; sources[s.env] = 'env'; }
    else sources[s.env] = 'default';
  }
  /* the two secrets the app can make for itself, once, and only when nobody supplied them */
  const need = GENERATED.filter(k => raw[k] === undefined);
  if (need.length && generate) {
    const made = {};
    for (const k of need) { made[k] = randomBytes(32).toString('base64url'); raw[k] = made[k]; sources[k] = 'generated'; }
    saveFile(dataDir, made);
  }
  return { raw, sources, meta: file.meta, dataDir };
}

/* the CFG object the server reads, built the way the server always built it */
export function toCfg(conf) {
  const cfg = {};
  for (const s of SETTINGS) cfg[s.key] = normalise(s, conf.raw[s.env]);
  return cfg;
}

/* Does this install still need the setup page? It does not when the essentials are all present
   (the usual case for an install driven by environment variables), and it always does while the
   essentials are missing. A finished setup is remembered in the file. */
export function needsSetup(conf) {
  const have = k => conf.raw[k] !== undefined && conf.raw[k] !== '';
  if (have('IMMICH_URL') && have('IMMICH_API_KEY')) return false;
  return true;
}

/* what may be shown to a browser: whether a setting is set, where it came from, and its value only
   if it is not a secret */
export function redact(conf) {
  const out = {};
  for (const s of SETTINGS) {
    if (s.hidden) continue;
    const set = conf.raw[s.env] !== undefined && conf.raw[s.env] !== '';
    out[s.env] = { set, source: conf.sources[s.env], secret: s.secret, locked: false, fromEnv: conf.sources[s.env] === 'env',
                   ...(s.secret ? {} : { value: set ? conf.raw[s.env] : '' }) };
  }
  return out;
}

export function startupSummary(conf) {
  const where = group => {
    const src = new Set(SETTINGS.filter(s => s.group === group && conf.raw[s.env] !== undefined).map(s => conf.sources[s.env]));
    return src.size ? [...src].join('+') : 'off';
  };
  return ['immich', 'email', 'brand', 'public', 'dns', 'website'].map(g => `${g}: ${where(g)}`).join(' | ');
}

export function writeProblem(dir) {
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); const t = join(dir, '.w'); writeFileSync(t, 'x'); return null; }
  catch (e) { return e.message; }
}
