/* Making the bundled Immich ready for this app without the owner touching Immich: create its first account,
   make the two API keys the app needs, and tidy. Pure apart from the injected fetch.

   Order matters, because this must never leave an owner locked out or with duplicate keys:
   sign up (if asked) -> sign in -> make the read key and SAVE IT AT ONCE -> make the write key and save it ->
   only then remove older keys this app made -> small optional tweaks -> sign out. The password is used for
   this one run and never stored or logged. */

import { READ_PERMISSIONS, KEY_NAMES, writePermissionsFor } from './checks.mjs';

export class ProvisionError extends Error {
  constructor(state, message, status = 502) { super(message); this.state = state; this.status = status; }
}

const trim = u => String(u || '').trim().replace(/\/+$/, '');
const lim = ms => ({ signal: AbortSignal.timeout(ms) });
const jsonInit = (method, body, token) => ({ method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

/* is Immich up, and has anyone made an account on it yet? */
export async function immichStatus({ url, f = fetch }) {
  const base = trim(url);
  if (!base) return { reachable: false };
  try {
    const ping = await f(`${base}/api/server/ping`, lim(6000));
    if (!ping.ok) return { reachable: false };
    let version = '', initialized = null, onboarded = null;
    try { const v = await (await f(`${base}/api/server/version`, lim(6000))).json(); version = `${v.major}.${v.minor}.${v.patch}`; } catch {}
    try { const c = await (await f(`${base}/api/server/config`, lim(6000))).json(); initialized = !!c.isInitialized; onboarded = !!c.isOnboarded; } catch {}
    return { reachable: true, version, initialized, onboarded };
  } catch { return { reachable: false }; }
}

const messageOf = async r => { try { const j = await r.clone().json(); return String(j.message || j.error || ''); } catch { return (await r.text().catch(() => '')).slice(0, 160); } };

/* keys this app made earlier are found by their exact names, so someone's own keys are never touched */
export const ourKeys = list => (Array.isArray(list) ? list : []).filter(k => k && (k.name === KEY_NAMES.read || k.name === KEY_NAMES.write));

export async function provisionImmich({ url, mode, email, password, name, write = 'none', ml = 'keep', importPath = '', previousKeyIds = [], save = async () => {}, f = fetch }) {
  const base = trim(url);
  const st = await immichStatus({ url: base, f });
  if (!st.reachable) throw new ProvisionError('starting', 'Immich is still starting.', 503);

  let createdAccount = false;
  if (mode === 'create') {
    if (st.initialized) throw new ProvisionError('initialized', 'Immich already has an account. Sign in with it instead.', 409);
    const r = await f(`${base}/api/auth/admin-sign-up`, { ...jsonInit('POST', { email, name, password }), ...lim(15000) });
    if (r.status === 400) throw new ProvisionError('initialized', 'Immich already has an account. Sign in with it instead.', 409);
    if (!r.ok) throw new ProvisionError('immich_error', `Immich could not create the account (${r.status}): ${await messageOf(r)}`);
    createdAccount = true;
  }

  const login = await f(`${base}/api/auth/login`, { ...jsonInit('POST', { email, password }), ...lim(15000) });
  if (login.status === 401 || login.status === 400) throw new ProvisionError('bad_login', 'Immich did not accept that email and password.', 401);
  if (!login.ok) throw new ProvisionError('immich_error', `Immich would not sign in (${login.status}): ${await messageOf(login)}`);
  const sess = await login.json();
  const token = sess.accessToken;
  if (!token) throw new ProvisionError('immich_error', 'Immich did not return a sign-in token.');
  const call = (method, path, body) => f(`${base}${path}`, { ...jsonInit(method, body, token), ...lim(20000) });

  const make = async (label, key, permissions) => {
    const r = await call('POST', '/api/api-keys', { name: KEY_NAMES[key], permissions });
    if (r.status === 400) throw new ProvisionError('permissions_mismatch', `Immich would not make the ${label} key: ${await messageOf(r)}`);
    if (!r.ok) throw new ProvisionError('immich_error', `Immich would not make the ${label} key (${r.status}): ${await messageOf(r)}`);
    const j = await r.json();
    const secret = j.secret || j.apiKey?.secret || (typeof j.apiKey === 'string' ? j.apiKey : '');
    const id = j.id || j.apiKey?.id || '';
    if (!secret) throw new ProvisionError('immich_error', `Immich did not hand back the ${label} key.`);
    const made = { id, secret, name: KEY_NAMES[key] };
    await save(key, made);                      /* kept on disk before anything else can go wrong */
    return made;
  };

  const readKey = await make('read-only', 'read', READ_PERMISSIONS);
  const perms = writePermissionsFor(write);
  const writeKey = perms.length ? await make('add-and-remove', 'write', perms) : null;

  /* only now is it safe to retire older keys of ours */
  let removedOldKeys = 0;
  try {
    const list = await (await call('GET', '/api/api-keys')).json();
    const mine = new Set([readKey.id, writeKey?.id].filter(Boolean));
    const retire = (Array.isArray(list) ? list : []).filter(k => !mine.has(k.id) && (previousKeyIds.includes(k.id) || ourKeys([k]).length));
    for (const k of retire) { const d = await call('DELETE', `/api/api-keys/${encodeURIComponent(k.id)}`); if (d.ok) removedOldKeys++; }
  } catch { /* tidying is optional */ }

  let mlResult = 'unchanged';
  if (ml === 'off' && sess.isAdmin !== false) {
    try {
      const cfg = await (await call('GET', '/api/system-config')).json();
      if (cfg?.machineLearning?.enabled !== false) {
        cfg.machineLearning = { ...cfg.machineLearning, enabled: false };
        const put = await call('PUT', '/api/system-config', cfg);
        if (put.ok) mlResult = 'off';
      } else mlResult = 'off';
    } catch { /* leave it as it was */ }
  }

  let library = null;
  if (importPath && sess.isAdmin !== false) {
    try {
      const have = await (await call('GET', '/api/libraries')).json();
      const existing = (Array.isArray(have) ? have : []).find(l => (l.importPaths || []).includes(importPath));
      if (existing) library = { id: existing.id, existing: true };
      else {
        const r = await call('POST', '/api/libraries', { ownerId: sess.userId, name: 'Imported folder', importPaths: [importPath] });
        if (r.ok) { const l = await r.json(); library = { id: l.id }; await call('POST', `/api/libraries/${encodeURIComponent(l.id)}/scan`, {}); }
      }
    } catch { /* the owner can add the folder in Immich */ }
  }

  try { await call('POST', '/api/auth/logout', {}); } catch {}
  return { createdAccount, readKey, writeKey, removedOldKeys, ml: mlResult, library, version: st.version };
}
