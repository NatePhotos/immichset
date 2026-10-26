/* The first-run setup server. It runs instead of the app while the essentials (Immich's address and key)
   are missing, on the same port, and hands that port to the real app the moment setup finishes.

   Nothing here is reachable without the setup code printed in the container's log, and none of it
   exists once setup has finished: the real app does not serve /setup at all. */

import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync, createHash } from 'node:crypto';
import { SETTINGS, BY_ENV, validate } from '../config/settings.mjs';
import { loadConfig, saveFile, toCfg, redact, writeProblem } from '../config/store.mjs';
import { clientIp, isHttps, requestHost } from '../config/request.mjs';
import { makeCode, codeMatches, createLimiter, makeToken, checkToken, sameOrigin } from './claim.mjs';
import { checkImmich, checkResend, checkCloudflare, checkPublic } from './checks.mjs';
import { immichStatus, provisionImmich, ProvisionError } from './provision.mjs';

export const CODE_FILE = 'setup-code.txt';
const hash = s => createHash('sha256').update(String(s || '')).digest('hex').slice(0, 16);

export function runSetup({ db, env, dataDir, webDir, log = console, fetchImpl = fetch }) {
  const port = Number(env.PORT || 3000);
  const instance = randomBytes(8).toString('hex');
  const limiter = createLimiter();
  const loginLimiter = createLimiter();          /* wrong Immich passwords: 10 per address per 15 minutes */
  let provisioning = false;                      /* one run at a time, so two clicks cannot make two sets of keys */
  let conf = loadConfig(env, dataDir);
  const reload = () => { conf = loadConfig(env, dataDir, { generate: false }); return conf; };
  const secret = conf.raw.APP_SECRET;

  /* the code: kept across restarts so one printed earlier still works, removed when setup is done */
  const codePath = join(dataDir, CODE_FILE);
  let code;
  try { code = existsSync(codePath) ? readFileSync(codePath, 'utf8').trim() : ''; } catch { code = ''; }
  if (!/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code)) {
    code = makeCode();
    try { writeFileSync(codePath, code + '\n', { mode: 0o600 }); try { chmodSync(codePath, 0o600); } catch {} } catch (e) { log.error('could not write the setup code file:', e.message); }
  }
  const bad = writeProblem(dataDir);
  if (bad) log.error(`\nThe data folder (${dataDir}) is not writable: ${bad}\nFix it with:  chown -R 1000:1000 <that folder on your computer>   or give the container a "user:" that owns it.\n`);
  const line = '='.repeat(58);
  log.log(`\n${line}\n  FIRST-TIME SETUP\n\n  1. In a browser on your home network, open:  http://NAS-ADDRESS:${port}/setup\n     Swap NAS-ADDRESS for the address you type to open your NAS's own web page (like 192.168.1.20).\n     Not sure what it is? Sign in to your NAS in a browser and copy what's in the address bar.\n\n  2. When it asks, enter this code:\n     Setup code:  ${code}\n\n  (Running on your own computer? Use http://localhost:${port}/setup)\n  The code is also in the file ${codePath}\n${line}\n`);

  const adminExists = () => { try { return db.prepare('SELECT COUNT(*) n FROM admin_users').get().n > 0; } catch { return false; } };
  const page = () => readFileSync(join(webDir, 'setup.html'), 'utf8');

  const send = (res, code, body, headers = {}) => {
    const isStr = typeof body === 'string';
    res.writeHead(code, { 'content-type': isStr ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-immichset-instance': instance, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers });
    res.end(isStr ? body : JSON.stringify(body));
  };
  const readJson = async (req, limit = 64 * 1024) => {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > limit) throw new Error('too large'); chunks.push(c); }
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; }
  };
  const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(p => p.trim().split(/=(.*)/s)).filter(p => p[0]).map(p => [p[0], decodeURIComponent(p[1] || '')]));
  const ipOf = req => clientIp(req, env.CLIENT_IP_HEADER || '');
  const https = isHttps;
  const fromInternet = env.SETUP_FROM_INTERNET === 'on';
  const suggested = req => `${https(req) ? 'https' : (req.headers['x-forwarded-proto'] || 'http')}://${requestHost(req)}`;

  const WIZARD = new Set(SETTINGS.filter(s => s.wizard).map(s => s.env));
  const get = k => conf.raw[k] || '';
  const stateOf = req => {
    const c = toCfg(conf), emailOk = !!(conf.meta.emailVerified && conf.meta.emailVerified.key === hash(c.resendKey) && conf.meta.emailVerified.from === c.mailFrom);
    return { claimed: true, adminExists: adminExists(), suggestedPublicUrl: suggested(req), instance: undefined,
      emailVerified: emailOk, emailSkipped: !!conf.meta.emailSkipped, dataWritable: !bad, settings: redact(conf),
      bundled: c.immichBundled ? { url: c.immichBundled, ml: c.bundledMl, importPath: c.bundledImport || '' } : null,
      immichHint: c.immichHint || '', immichProvisioned: conf.meta.immichProvision || null,
      envAdmin: !!(conf.raw.ADMIN_EMAIL && conf.raw.ADMIN_PASSWORD) };
  };

  return new Promise(resolve => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://x'), path = url.pathname;
        if (path === '/healthz') return send(res, 200, { ok: true, setup: true, https: https(req) });
        /* A tunnel would put this page on the internet before an owner has made an account. Cloudflare marks its
           requests, so setup answers only on the home network unless the owner says otherwise. */
        if ((path === '/' || path === '/setup' || path === '/setup/' || path === '/setup.html' || path.startsWith('/api/setup/')) && !fromInternet && req.headers['cf-connecting-ip']) {
          return send(res, 403, path.startsWith('/api/') ? { error: 'Finish setup from your home network.' } : '<!doctype html><meta charset=utf-8><body style="font-family:system-ui;max-width:32em;margin:12vh auto;padding:0 1em;line-height:1.6"><h1>Finish setup from home</h1><p>For your safety, first-time setup only works from your home network. Open it at the address of this computer on your home Wi-Fi, for example <code>http://192.168.1.20:3000/setup</code>.</p>');
        }
        if (path === '/' || path === '/setup' || path === '/setup/' || path === '/setup.html') {
          if (path === '/') { res.writeHead(302, { location: '/setup' }); return res.end(); }
          return send(res, 200, page());
        }
        if (path === '/admin-theme.css' && existsSync(join(webDir, 'admin-theme.css'))) {
          res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'no-store' }); return res.end(readFileSync(join(webDir, 'admin-theme.css')));
        }

        if (path.startsWith('/api/setup/')) {
          const api = path.slice('/api/setup/'.length);
          if (req.method !== 'GET' && !/^application\/json/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Send JSON' });
          if (!sameOrigin(req.headers) && req.method !== 'GET') return send(res, 403, { error: 'This request did not come from the setup page' });

          if (api === 'claim' && req.method === 'POST') {
            const why = limiter.blocked(ipOf(req));
            if (why === 'locked') return send(res, 429, { error: 'Too many wrong codes. Restart the container to try again.' });
            if (why) return send(res, 429, { error: 'Too many wrong codes. Wait a few minutes.' });
            const b = await readJson(req);
            if (!codeMatches(b.code, code)) { limiter.fail(ipOf(req)); return send(res, 401, { error: 'That code is not right. Check the container log.' }); }
            return send(res, 200, { ok: true }, { 'set-cookie': `setup=${makeToken(secret)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${https(req) ? '; Secure' : ''}` });
          }
          if (!checkToken(secret, cookies(req).setup)) return send(res, 401, { error: 'claim' });

          if (api === 'state' && req.method === 'GET') { reload(); return send(res, 200, stateOf(req)); }

          if (api === 'settings' && req.method === 'PUT') {
            reload();
            const b = await readJson(req), patch = {}, errors = {};
            for (const [k, v] of Object.entries(b)) {
              const s = BY_ENV.get(k);
              if (!s || !WIZARD.has(k)) { errors[k] = 'That setting cannot be changed here'; continue; }
              if (conf.sources[k] === 'env') { errors[k] = 'Set in your compose file; edit it there'; continue; }
              if (s.secret && (v === '' || v === null || v === undefined)) continue;        /* blank keeps the saved key */
              const r = validate(k, v); if (!r.ok) { errors[k] = r.error; continue; }
              patch[k] = r.value;
            }
            if (Object.keys(errors).length) return send(res, 400, { error: Object.values(errors)[0], errors });
            saveFile(dataDir, patch); reload();
            return send(res, 200, stateOf(req));
          }

          if (api.startsWith('test/') && req.method === 'POST') {
            reload();
            const b = await readJson(req), c = toCfg(conf);
            const pick = (v, fallback) => (v === undefined || v === '' || v === null ? fallback : String(v).trim());
            let out;
            if (api === 'test/immich') out = await checkImmich({ url: pick(b.url, c.immichUrl), key: pick(b.key, c.immichKey), writeKey: pick(b.writeKey, c.immichWriteKey), f: fetchImpl });
            else if (api === 'test/email') {
              const key = pick(b.apiKey, c.resendKey), from = pick(b.from, c.mailFrom);
              out = await checkResend({ apiKey: key, from, replyTo: pick(b.replyTo, c.mailReplyTo), to: pick(b.to, ''), base: c.resendBase, f: fetchImpl });
              const sent = out.checks.find(x => x.id === 'send');
              if (sent && sent.ok && !sent.warn) saveFile(dataDir, {}, { emailVerified: { key: hash(key), from }, emailSkipped: false });
            }
            else if (api === 'test/public') out = await checkPublic({ url: pick(b.url, c.publicUrl), instance, f: fetchImpl });
            else if (api === 'test/cloudflare') out = await checkCloudflare({ kind: b.kind === 'dns' ? 'dns' : 'pages', token: pick(b.token, b.kind === 'dns' ? c.cfToken : c.cfPagesToken),
              accountId: pick(b.accountId, c.cfAccountId), project: pick(b.project, c.cfPagesProject), domain: pick(b.domain, c.dnsDomain), host: pick(b.host, c.dnsHost), f: fetchImpl });
            else return send(res, 404, { error: 'not_found' });
            return send(res, 200, out);
          }

          if (api === 'immich/status' && req.method === 'GET') {
            reload();
            const c = toCfg(conf), asked = url.searchParams.get('url');
            const target = c.immichBundled || (asked && validate('IMMICH_URL', asked).ok ? validate('IMMICH_URL', asked).value : '') || c.immichHint || c.immichUrl;
            return send(res, 200, { url: target, bundled: !!c.immichBundled, ...(await immichStatus({ url: target, f: fetchImpl })) });
          }

          /* Make the bundled Immich ready: its first account (or sign in to an existing one), then the two API keys this
             app needs. The password is used for this one request and never stored or logged. */
          if (api === 'immich/provision' && req.method === 'POST') {
            reload();
            const c = toCfg(conf);
            if (conf.sources.IMMICH_API_KEY === 'env') return send(res, 409, { state: 'locked', error: 'The Immich key is set in your compose file; change it there.' });
            if (provisioning) return send(res, 423, { state: 'busy', error: 'Already working on it. Give it a moment.' });
            const b = await readJson(req);
            let target = c.immichBundled;
            if (!target) { const v = validate('IMMICH_URL', b.url || c.immichHint || c.immichUrl); if (!v.ok || !v.value) return send(res, 400, { error: 'Enter the address of your Immich.' }); target = v.value; }
            const mode = b.mode === 'signin' ? 'signin' : 'create';
            const em = validate('ADMIN_EMAIL', b.email);
            if (!em.ok || !em.value) return send(res, 400, { error: 'Enter a valid email address.' });
            const pw = String(b.password || '');
            if (!pw) return send(res, 400, { error: 'Enter your password.' });
            if (mode === 'create' && (pw.length < 12 || pw.length > 200)) return send(res, 400, { error: 'Use 12 to 200 characters for the password.' });
            const why = loginLimiter.blocked(ipOf(req));
            if (why) return send(res, 429, { state: 'locked', error: 'Too many wrong passwords. Wait a few minutes.' });
            const write = ['add', 'addremove', 'all'].includes(b.write) ? b.write : 'none';
            const ml = (!c.bundledMl || b.ml === 'off') && c.immichBundled ? 'off' : 'keep';
            const prev = conf.meta.immichProvision || {};
            provisioning = true;
            try {
              const out = await provisionImmich({
                url: target, mode, email: em.value, password: pw, write, ml, f: fetchImpl,
                name: (c.brandName || em.value.split('@')[0]).slice(0, 60),
                importPath: c.immichBundled && c.bundledImport && b.importLibrary ? c.bundledImport : '',
                previousKeyIds: [prev.readKeyId, prev.writeKeyId].filter(Boolean),
                save: async (kind, k) => {
                  const cur = loadConfig(env, dataDir, { generate: false }).meta.immichProvision || {};
                  if (kind === 'read') saveFile(dataDir, { IMMICH_URL: target, IMMICH_API_KEY: k.secret }, { immichProvision: { readKeyId: k.id, writeKeyId: null, at: new Date().toISOString() } });
                  else saveFile(dataDir, { IMMICH_WRITE_KEY: k.secret }, { immichProvision: { ...cur, writeKeyId: k.id } });
                },
              });
              if (!out.writeKey && prev.writeKeyId && conf.sources.IMMICH_WRITE_KEY !== 'env') saveFile(dataDir, { IMMICH_WRITE_KEY: '' });
              reload();
              /* the keys were made with exactly the permissions chosen, so only the read side is tested: a write key without the trash
                 permission is not a problem here, it is what was asked for */
              const check = await checkImmich({ url: target, key: out.readKey.secret, f: fetchImpl });
              return send(res, 200, { ok: true, createdAccount: out.createdAccount, readKey: { id: out.readKey.id, name: out.readKey.name },
                writeKey: out.writeKey ? { id: out.writeKey.id, name: out.writeKey.name } : null, removedOldKeys: out.removedOldKeys,
                ml: out.ml, library: out.library, version: out.version, check, state: stateOf(req) });
            } catch (e) {
              if (e instanceof ProvisionError) {
                if (e.state === 'bad_login') loginLimiter.fail(ipOf(req));
                return send(res, e.status, { state: e.state, error: e.message }, e.state === 'starting' ? { 'retry-after': '5' } : {});
              }
              log.error('setup provision:', e.message);
              return send(res, 500, { state: 'immich_error', error: 'Something went wrong talking to Immich. Check the container log.' });
            } finally { provisioning = false; }
          }

          if (api === 'skip-email' && req.method === 'POST') { saveFile(dataDir, {}, { emailSkipped: true }); reload(); return send(res, 200, stateOf(req)); }

          if (api === 'admin' && req.method === 'POST') {
            if (adminExists()) return send(res, 409, { error: 'An admin account already exists.' });
            const b = await readJson(req);
            const em = validate('ADMIN_EMAIL', b.email);
            if (!em.ok || !em.value) return send(res, 400, { error: 'Enter a valid email address.' });
            const pw = String(b.password || '');
            if (pw.length < 12) return send(res, 400, { error: 'Use at least 12 characters for the password.' });
            if (pw.length > 200) return send(res, 400, { error: 'That password is too long.' });
            if (pw.toLowerCase() === em.value) return send(res, 400, { error: 'The password cannot be your email address.' });
            const salt = randomBytes(16).toString('hex');
            db.prepare('INSERT INTO admin_users (email,password_hash,password_salt) VALUES (?,?,?)').run(em.value, scryptSync(pw, salt, 32).toString('hex'), salt);
            saveFile(dataDir, { ADMIN_EMAIL: em.value }); reload();
            return send(res, 200, stateOf(req));
          }

          if (api === 'finish' && req.method === 'POST') {
            reload();
            const c = toCfg(conf), missing = [];
            if (!c.immichUrl || !c.immichKey) missing.push('Immich address and key');
            if (!c.publicUrl) missing.push('Public address');
            if (!adminExists() && !(c.adminEmail && c.adminPass)) missing.push('Your admin account');
            if (missing.length) return send(res, 400, { error: `Still needed: ${missing.join(', ')}.`, missing });
            /* the emailed sign-in code is only switched on once email has been proven to work, or the
               owner could be locked out of their own admin */
            const verified = conf.meta.emailVerified && conf.meta.emailVerified.key === hash(c.resendKey) && conf.meta.emailVerified.from === c.mailFrom;
            if (conf.sources.ADMIN_2FA !== 'env') saveFile(dataDir, { ADMIN_2FA: verified ? 'on' : 'off' });
            saveFile(dataDir, {}, { setupCompletedAt: new Date().toISOString() });
            try { unlinkSync(codePath); } catch {}
            send(res, 200, { ok: true });
            setImmediate(() => { server.close(); server.closeAllConnections?.(); resolve(reload()); });
            return;
          }
          return send(res, 404, { error: 'not_found' });
        }

        /* everything else: a holding page, so nobody sees a half-started app */
        if (path.startsWith('/api/')) return send(res, 503, { error: 'setup' }, { 'retry-after': '30' });
        return send(res, 503, '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Setting up</title>'
          + '<body style="font-family:system-ui;max-width:30em;margin:12vh auto;padding:0 1em;line-height:1.6"><h1>This gallery server is being set up</h1><p>Please check back soon.</p><p><a href="/setup">Owner? Continue setup</a></p>',
          { 'retry-after': '30' });
      } catch (e) {
        log.error('setup:', e.message);
        try { send(res, 500, { error: 'Something went wrong. Check the container log.' }); } catch {}
      }
    });
    server.listen(port, '0.0.0.0');
  });
}
