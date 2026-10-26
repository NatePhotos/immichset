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
import { makeCode, codeMatches, createLimiter, makeToken, checkToken, sameOrigin } from './claim.mjs';
import { checkImmich, checkResend, checkCloudflare, checkPublic } from './checks.mjs';

export const CODE_FILE = 'setup-code.txt';
const hash = s => createHash('sha256').update(String(s || '')).digest('hex').slice(0, 16);

export function runSetup({ db, env, dataDir, webDir, log = console, fetchImpl = fetch }) {
  const port = Number(env.PORT || 3000);
  const instance = randomBytes(8).toString('hex');
  const limiter = createLimiter();
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
  log.log(`\n${line}\n  FIRST-TIME SETUP\n  Open  http://<this computer>:${port}/setup\n  Setup code:  ${code}\n  (also in the file ${codePath})\n${line}\n`);

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
  const ipOf = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  const https = req => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const suggested = req => `${https(req) ? 'https' : (req.headers['x-forwarded-proto'] || 'http')}://${String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()}`;

  const WIZARD = new Set(SETTINGS.filter(s => s.wizard).map(s => s.env));
  const get = k => conf.raw[k] || '';
  const stateOf = req => {
    const c = toCfg(conf), emailOk = !!(conf.meta.emailVerified && conf.meta.emailVerified.key === hash(c.resendKey) && conf.meta.emailVerified.from === c.mailFrom);
    return { claimed: true, adminExists: adminExists(), suggestedPublicUrl: suggested(req), instance: undefined,
      emailVerified: emailOk, emailSkipped: !!conf.meta.emailSkipped, dataWritable: !bad, settings: redact(conf),
      envAdmin: !!(conf.raw.ADMIN_EMAIL && conf.raw.ADMIN_PASSWORD) };
  };

  return new Promise(resolve => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://x'), path = url.pathname;
        if (path === '/healthz') return send(res, 200, { ok: true, setup: true });
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
