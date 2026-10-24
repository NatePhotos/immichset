/* A tiny stand-in for Immich: enough of the API for the website section.
   node site/test/fake-immich.mjs 3997 [--fail]  (--fail answers 503 to uploads) */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export function startFakeImmich(port = 0, { fail = false } = {}) {
  const seen = { assets: 0, albums: [], added: [] };
  const srv = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c.length > 2e6 ? '' : c;
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'POST' && req.url === '/api/assets') {
      if (fail.value ?? fail) return send(503, { message: 'down' });
      seen.assets++; return send(201, { id: randomUUID(), status: 'created' });
    }
    if (req.method === 'POST' && req.url === '/api/albums') {
      const a = { id: randomUUID(), albumName: JSON.parse(body || '{}').albumName || '' };
      seen.albums.push(a); return send(201, a);
    }
    const add = req.url.match(/^\/api\/albums\/([^/]+)\/assets$/);
    if (add && req.method === 'PUT') { seen.added.push(add[1]); return send(200, [{ success: true }]); }
    return send(200, []);
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 3997);
  startFakeImmich(port, { fail: process.argv.includes('--fail') }).then(() => console.log(`fake immich on ${port}`));
}
