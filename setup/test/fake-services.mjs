/* Stand-ins for Immich and Resend, so a whole fresh install can be walked through without either. */
import { createServer } from 'node:http';

const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const body = req => new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => r(b)); });

export async function fakeImmich() {
  const st = { deny: null, key: 'IMMICH-READ-KEY-SECRET', hits: [] };
  const srv = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); await body(req);
    const j = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    st.hits.push(`${req.method} ${u.pathname}`);
    if (u.pathname === '/api/server/ping') return j(200, { res: 'pong' });
    if (u.pathname === '/api/server/version') return j(200, { major: 3, minor: 2, patch: 0 });
    if (req.headers['x-api-key'] !== st.key && req.headers['x-api-key'] !== 'IMMICH-WRITE-KEY-SECRET') return j(401, { message: 'Invalid API key' });
    if (st.deny && u.pathname.includes(st.deny.path)) return j(403, { message: `Missing required permission: ${st.deny.perm}` });
    if (req.method !== 'GET' && !/search|archive/.test(u.pathname)) return j(403, { message: 'Missing required permission: asset.upload' });
    if (u.pathname === '/api/albums') return j(200, [{ id: '00000000-0000-4000-8000-0000000000a1', albumName: 'Test', assetCount: 2, albumThumbnailAssetId: 'x' }]);
    if (u.pathname === '/api/timeline/buckets') return j(200, [{ timeBucket: '2024-01-01' }]);
    if (u.pathname === '/api/timeline/bucket') return j(200, { id: ['00000000-0000-4000-8000-0000000000b1'], ratio: [1.5], isImage: [true], fileCreatedAt: ['2024-01-01T00:00:00Z'] });
    res.writeHead(200); res.end('x');
  });
  const port = await listen(srv);
  return { url: `http://127.0.0.1:${port}`, st, close: () => srv.close() };
}

export async function fakeResend() {
  const st = { mails: [], mode: 'ok', key: 're_FAKE-RESEND-SECRET' };
  const srv = createServer(async (req, res) => {
    const raw = await body(req);
    const j = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== `Bearer ${st.key}`) return j(401, { name: 'invalid_api_key', message: 'API key is invalid' });
    if (req.url === '/domains') return j(401, { name: 'restricted_api_key', message: 'This API key is restricted to only send emails' });
    if (req.url === '/emails') {
      if (st.mode === 'unverified') return j(403, { name: 'validation_error', message: 'The studio.test domain is not verified.' });
      const m = JSON.parse(raw || '{}'); st.mails.push(m);
      return j(200, { id: 'e' + st.mails.length });
    }
    j(404, {});
  });
  const port = await listen(srv);
  return { url: `http://127.0.0.1:${port}`, st, close: () => srv.close() };
}

/* A fake Immich that behaves like the real one where it matters for first-time setup: it has to be signed up to
   before anything works, keys are made with chosen permissions (the secret is shown once), and each endpoint
   enforces the permission Immich really asks for, so a key this app made is exercised for real.
   Options: initialized (an account already exists), allowSetup, startDelayMs (not answering yet), failOn
   ({ path: /regex/, status, times }), admin: { email, password } for an existing account. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const FIX = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'immich-permissions.json'), 'utf8'));

export async function fakeImmichFull({ initialized = false, allowSetup = true, startDelayMs = 0, failOn = null, admin = null, slowLoginMs = 0 } = {}) {
  const st = { users: [], sessions: new Map(), keys: [], config: { machineLearning: { enabled: true, urls: ['http://x'] } }, libraries: [], hits: [], up: startDelayMs === 0,
               calls: { signUp: 0, login: 0, keys: 0 }, fails: failOn ? { ...failOn } : null };
  if (initialized || admin) { st.users.push({ id: 'u-admin', email: admin?.email || 'owner@studio.test', password: admin?.password || 'pw-owner-1234', isAdmin: true }); }
  if (startDelayMs) setTimeout(() => { st.up = true; }, startDelayMs).unref();
  let n = 0; const id = () => `k${++n}`;
  const need = (req, perm) => {
    const secret = req.headers['x-api-key'];
    const k = st.keys.find(x => x.secret === secret);
    if (!k) return { code: 401, body: { message: 'Invalid API key' } };
    if (!k.permissions.includes(perm)) return { code: 403, body: { message: `Missing required permission: ${perm}` } };
    return null;
  };
  const srv = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); const raw = await body(req); let b = {}; try { b = JSON.parse(raw || '{}'); } catch {}
    const j = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    st.hits.push(`${req.method} ${u.pathname}`);
    if (!st.up) { if (u.pathname === '/api/server/ping') return j(503, { message: 'starting' }); res.destroy(); return; }
    if (st.fails && st.fails.path.test(u.pathname) && st.fails.times-- > 0) return j(st.fails.status || 500, { message: 'boom' });
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    const user = st.sessions.get(bearer);

    if (u.pathname === '/api/server/ping') return j(200, { res: 'pong' });
    if (u.pathname === '/api/server/version') return j(200, { major: 3, minor: 3, patch: 5 });
    if (u.pathname === '/api/server/config') return j(200, { isInitialized: st.users.length > 0, isOnboarded: false });
    if (u.pathname === '/api/auth/admin-sign-up' && req.method === 'POST') {
      st.calls.signUp++;
      if (!allowSetup || st.users.length) return j(400, { message: 'The server already has an admin' });
      if (!b.email || !b.name || !b.password) return j(400, { message: 'bad body' });
      st.users.push({ id: 'u-admin', email: b.email, password: b.password, isAdmin: true });
      return j(201, { id: 'u-admin', email: b.email });
    }
    if (u.pathname === '/api/auth/login' && req.method === 'POST') {
      st.calls.login++;
      if (slowLoginMs) await new Promise(r => setTimeout(r, slowLoginMs));
      const found = st.users.find(x => x.email === b.email && x.password === b.password);
      if (!found) return j(401, { message: 'Incorrect email or password' });
      const t = 'tok-' + id(); st.sessions.set(t, found);
      return j(201, { accessToken: t, userId: found.id, isAdmin: true, isOnboarded: false });
    }
    if (u.pathname === '/api/auth/logout' && req.method === 'POST') { st.sessions.delete(bearer); return j(200, { successful: true }); }

    if (u.pathname.startsWith('/api/api-keys') || u.pathname.startsWith('/api/system-config') || u.pathname.startsWith('/api/libraries')) {
      if (!user) return j(401, { message: 'Not signed in' });
      if (u.pathname === '/api/api-keys' && req.method === 'POST') {
        st.calls.keys++;
        const bad = (b.permissions || []).filter(p => !FIX.permissions.includes(p));
        if (!Array.isArray(b.permissions) || bad.length) return j(400, { message: `Unknown permission: ${bad[0]}` });
        const k = { id: id(), name: b.name || 'key', permissions: b.permissions, secret: 'sec_' + Math.random().toString(36).slice(2) + n };
        st.keys.push(k);
        return j(201, { id: k.id, name: k.name, permissions: k.permissions, secret: k.secret, apiKey: { id: k.id, name: k.name } });
      }
      if (u.pathname === '/api/api-keys' && req.method === 'GET') return j(200, st.keys.map(({ secret, ...k }) => k));
      const del = u.pathname.match(/^\/api\/api-keys\/([\w-]+)$/);
      if (del && req.method === 'DELETE') { st.keys = st.keys.filter(k => k.id !== del[1]); return j(200, {}); }
      if (u.pathname === '/api/system-config' && req.method === 'GET') return j(200, st.config);
      if (u.pathname === '/api/system-config' && req.method === 'PUT') { st.config = b; return j(200, st.config); }
      if (u.pathname === '/api/libraries' && req.method === 'GET') return j(200, st.libraries);
      if (u.pathname === '/api/libraries' && req.method === 'POST') { const l = { id: 'lib' + (st.libraries.length + 1), name: b.name, importPaths: b.importPaths || [] }; st.libraries.push(l); return j(201, l); }
      if (/^\/api\/libraries\/[\w-]+\/scan$/.test(u.pathname)) return j(204, {});
      return j(404, {});
    }

    /* keys at work: each endpoint asks for the permission Immich really asks for */
    const route = `${req.method} ${u.pathname.replace(/\/[0-9a-f-]{36}(?=\/|$)/g, '/:id').replace(/^\/api/, '')}`;
    const perm = FIX.endpoints[route];
    if (perm) { const e = need(req, perm); if (e) return j(e.code, e.body); }
    else if (u.pathname.startsWith('/api/')) { const e = need(req, 'asset.read'); if (e) return j(e.code, e.body); }
    if (u.pathname === '/api/albums' && req.method === 'GET') return j(200, [{ id: '00000000-0000-4000-9000-000000000001', albumName: 'Sample', assetCount: 2, albumThumbnailAssetId: 'x' }]);
    if (u.pathname === '/api/timeline/buckets') return j(200, [{ timeBucket: '2024-01-01' }]);
    if (u.pathname === '/api/timeline/bucket') return j(200, { id: ['00000000-0000-4000-8000-0000000000b1'], ratio: [1.5], isImage: [true], fileCreatedAt: ['2024-01-01T00:00:00Z'] });
    if (req.method !== 'GET' && !/search|archive/.test(u.pathname)) return j(400, { message: 'validation' });
    res.writeHead(200); res.end('x');
  });
  const port = await listen(srv);
  return { url: `http://127.0.0.1:${port}`, st, close: () => srv.close() };
}
