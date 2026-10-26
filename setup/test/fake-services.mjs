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
