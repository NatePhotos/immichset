import test from 'node:test';
import assert from 'node:assert/strict';
import { createDropbox, headerArg, safeName, CHUNK, DropboxError } from '../dropbox.mjs';

/* a fake Dropbox that records what it was asked */
function fake(handlers = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(url);
    const hdr = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ route: u.pathname, host: u.host, hdr, body: init.body, method: init.method });
    const h = handlers[u.pathname] || (() => ({ status: 200, json: {} }));
    const r = await h(calls[calls.length - 1], calls.length);
    return { ok: r.status < 400, status: r.status, headers: { get: k => (r.headers || {})[k] ?? null },
      json: async () => r.json ?? {}, text: async () => JSON.stringify(r.json ?? {}) };
  };
  return { f, calls };
}
const base = { '/oauth2/token': () => ({ status: 200, json: { access_token: 'tok', expires_in: 14400 } }) };
const mk = (h, extra = {}) => { const x = fake({ ...base, ...h }); return { ...x, dbx: createDropbox({ key: 'k', secret: 's', refresh: 'r', f: x.f, sleep: async () => {}, ...extra }) }; };
const stream = (...parts) => new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } });

test('it is configured only with a key, a secret and a refresh token', () => {
  assert.equal(createDropbox({ key: 'k', secret: 's', refresh: '' }).configured, false);
  assert.equal(createDropbox({ key: 'k', secret: 's', refresh: 'r' }).configured, true);
});

test('a header argument is plain ASCII', () => {
  assert.equal(headerArg({ path: '/é/日本' }), '{"path":"/\\u00e9/\\u65e5\\u672c"}');
  assert.equal(safeName('a/b:c?.mov'), 'a_b_c_.mov');
  assert.equal(safeName('..'), 'video');
});

test('the access token is fetched once and reused until it is about to expire', async () => {
  let t = 0;
  const { dbx, calls } = mk({ '/2/files/get_temporary_link': () => ({ status: 200, json: { link: 'https://x/y' } }) }, { now: () => t });
  assert.equal(await dbx.tempLink('/a'), 'https://x/y');
  await dbx.tempLink('/b');
  assert.equal(calls.filter(c => c.route === '/oauth2/token').length, 1);
  t = 14400 * 1000;   /* past expiry */
  await dbx.tempLink('/c');
  assert.equal(calls.filter(c => c.route === '/oauth2/token').length, 2);
});

test('a small file goes up in one call', async () => {
  const { dbx, calls } = mk();
  const n = await dbx.upload('/g/a.mov', stream(new Uint8Array(10), new Uint8Array(5)));
  assert.equal(n, 15);
  const u = calls.filter(c => c.route.startsWith('/2/files'));
  assert.deepEqual(u.map(c => c.route), ['/2/files/upload']);
  assert.match(u[0].hdr['dropbox-api-arg'], /"path":"\/g\/a.mov"/);
});

test('a big file goes up in a session, in order, and finishes with the rest', async () => {
  const { dbx, calls } = mk({ '/2/files/upload_session/start': () => ({ status: 200, json: { session_id: 'S' } }) });
  const total = CHUNK * 2 + 123;
  const big = new Uint8Array(total);
  /* feed it in odd-sized pieces */
  const parts = []; for (let o = 0; o < total; o += 5_000_000) parts.push(big.subarray(o, Math.min(total, o + 5_000_000)));
  const n = await dbx.upload('/g/b.mov', stream(...parts));
  assert.equal(n, total);
  const u = calls.filter(c => c.route.startsWith('/2/files'));
  assert.deepEqual(u.map(c => c.route), ['/2/files/upload_session/start', '/2/files/upload_session/append_v2', '/2/files/upload_session/finish']);
  assert.equal(JSON.parse(u[1].hdr['dropbox-api-arg']).cursor.offset, CHUNK);
  const fin = JSON.parse(u[2].hdr['dropbox-api-arg']);
  assert.equal(fin.cursor.offset, CHUNK * 2); assert.equal(fin.commit.path, '/g/b.mov');
  assert.equal(u[2].body.length, 123);
});

test('a file of exactly one chunk still finishes', async () => {
  const { dbx, calls } = mk({ '/2/files/upload_session/start': () => ({ status: 200, json: { session_id: 'S' } }) });
  const n = await dbx.upload('/g/c.mov', stream(new Uint8Array(CHUNK)));
  assert.equal(n, CHUNK);
  assert.equal(calls.filter(c => c.route.endsWith('/finish')).length, 1);
});

test('slow-down and server errors are retried; other errors are not', async () => {
  let n = 0;
  const a = mk({ '/2/files/get_temporary_link': () => (++n < 3 ? { status: 429, headers: { 'retry-after': '1' } } : { status: 200, json: { link: 'L' } }) });
  assert.equal(await a.dbx.tempLink('/x'), 'L');
  assert.equal(n, 3);
  const b = mk({ '/2/files/get_temporary_link': () => ({ status: 409, json: { error_summary: 'path/not_found/..' } }) });
  await assert.rejects(b.dbx.tempLink('/x'), e => e instanceof DropboxError && e.status === 409);
});

test('removing a file that is already gone is fine; other failures are raised', async () => {
  const a = mk({ '/2/files/delete_v2': () => ({ status: 409, json: { error_summary: 'path_lookup/not_found/.' } }) });
  assert.equal(await a.dbx.remove('/x'), false);
  const b = mk({ '/2/files/delete_v2': () => ({ status: 403, json: { error_summary: 'no_permission' } }) });
  await assert.rejects(b.dbx.remove('/x'));
});

test('a calls with no argument sends no body', async () => {
  const { dbx, calls } = mk({ '/2/users/get_current_account': () => ({ status: 200, json: { email: 'a@b.c' } }) });
  assert.equal((await dbx.account()).email, 'a@b.c');
  const c = calls.find(x => x.route === '/2/users/get_current_account');
  assert.equal(c.body, undefined); assert.equal(c.hdr['content-type'], undefined);
});
