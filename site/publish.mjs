/* Cloudflare Pages Direct Upload - the same requests Wrangler makes, without Wrangler.
   Cloudflare switches the live site only when the final deployment request succeeds,
   so a failure anywhere before it leaves the site as it was. */
import { extname } from 'node:path';
import { pagesHash } from './blake3.mjs';

const API = 'https://api.cloudflare.com/client/v4';
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'application/javascript; charset=utf-8',
                jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml' };
const BUCKET_BYTES = 40 * 1024 * 1024, BUCKET_FILES = 2000;   /* Wrangler's limits */

export function createPublisher({ accountId, token, project, fetch: f = globalThis.fetch }) {
  const proj = `/accounts/${accountId}/pages/projects/${project}`;

  async function call(path, init = {}, bearer = token) {
    const r = await f(API + path, { ...init, signal: AbortSignal.timeout(120_000),
      headers: { authorization: `Bearer ${bearer}`, ...(init.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const why = (j.errors || []).map(e => e.message).join('; ') || `HTTP ${r.status}`;
      throw new Error(`Cloudflare: ${why}`.slice(0, 300));
    }
    return j.result;
  }
  const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  async function deploy(files, hashOf = pagesHash) {
    const list = [];
    for (const [path, buf] of files) {
      if (path === '_headers') continue;
      list.push({ path, buf, hash: hashOf(buf, path), type: TYPES[extname(path).slice(1).toLowerCase()] || 'application/octet-stream' });
    }
    const { jwt } = await call(`${proj}/upload-token`);
    const missing = new Set(await call('/pages/assets/check-missing', post({ hashes: list.map(x => x.hash) }), jwt));

    let bucket = [], size = 0;
    const flush = async () => {
      if (!bucket.length) return;
      await call('/pages/assets/upload', post(bucket), jwt);
      bucket = []; size = 0;
    };
    const sent = new Set();
    for (const x of list) {
      if (!missing.has(x.hash) || sent.has(x.hash)) continue;
      sent.add(x.hash);
      const value = x.buf.toString('base64');
      if (size + value.length > BUCKET_BYTES || bucket.length >= BUCKET_FILES) await flush();
      bucket.push({ key: x.hash, value, metadata: { contentType: x.type }, base64: true });
      size += value.length;
    }
    await flush();
    await call('/pages/assets/upsert-hashes', post({ hashes: list.map(x => x.hash) }), jwt);

    const form = new FormData();
    form.append('manifest', JSON.stringify(Object.fromEntries(list.map(x => ['/' + x.path, x.hash]))));
    form.append('branch', 'main');
    if (files.has('_headers')) form.append('_headers', new File([files.get('_headers')], '_headers'));
    const d = await call(`${proj}/deployments`, { method: 'POST', body: form });
    return { id: d.id, url: d.url };
  }

  const rollback = id => call(`${proj}/deployments/${encodeURIComponent(id)}/rollback`, { method: 'POST' });
  return { ready: !!(accountId && token && project), deploy, rollback };
}
