/* Dropbox, for one job: keep a private copy of each gallery video, hand a client a download link that
   dies by itself after four hours, and remove the copy when it is no longer wanted.

   Nothing here is shared publicly. A temporary link is made per download from the app's own access, so
   there is no shared link to revoke. Everything is injectable (fetch, clock) so it can be tested without
   the network. */

const API = 'https://api.dropboxapi.com';
const CONTENT = 'https://content.dropboxapi.com';
const TOKEN_URL = 'https://api.dropbox.com/oauth2/token';
export const CHUNK = 16 * 1024 * 1024;        /* a multiple of 4 MiB, as upload sessions want */
const SINGLE_MAX = CHUNK;                     /* a file that fits in one chunk goes up in one call */

/* Dropbox-API-Arg travels in a header, so anything outside ASCII has to be written as \u escapes. */
export function headerArg(obj) {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/* A name that is safe as one path segment. */
export function safeName(name, fallback = 'video') {
  const n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 150);
  return n || fallback;
}

export class DropboxError extends Error {
  constructor(message, status, body) { super(message); this.name = 'DropboxError'; this.status = status; this.body = body; }
}

export function createDropbox({ key, secret, refresh, f = fetch, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  let cached = null;   /* { token, exp } */
  const configured = !!(key && secret && refresh);

  async function token() {
    if (!configured) throw new DropboxError('Dropbox is not set up', 0);
    if (cached && cached.exp - 60_000 > now()) return cached.token;
    const r = await f(TOKEN_URL, {
      method: 'POST',
      headers: { authorization: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }).toString(),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || !b.access_token) throw new DropboxError(b.error_description || b.error || `Dropbox sign-in failed (${r.status})`, r.status, b);
    cached = { token: b.access_token, exp: now() + (Number(b.expires_in) || 14400) * 1000 };
    return cached.token;
  }

  /* one call, retried when Dropbox says slow down or has a bad moment */
  async function call(url, init, tries = 4) {
    for (let i = 0; ; i++) {
      const r = await f(url, { ...init, headers: { ...(init.headers || {}), authorization: 'Bearer ' + await token() } });
      if (r.ok) return r;
      if (r.status === 401 && i === 0) { cached = null; continue; }
      if ((r.status === 429 || r.status >= 500) && i < tries - 1) {
        const wait = Number(r.headers?.get?.('retry-after')) || 2 ** i;
        await sleep(Math.min(60, wait) * 1000);
        continue;
      }
      const text = await r.text().catch(() => '');
      let body = null; try { body = JSON.parse(text); } catch {}
      throw new DropboxError(body?.error_summary || text.slice(0, 200) || `Dropbox answered ${r.status}`, r.status, body);
    }
  }

  /* a call with no argument must carry neither a body nor a content type */
  const rpc = (route, arg) => call(`${API}/2/${route}`, arg === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(arg) });
  const up = (route, arg, body) => call(`${CONTENT}/2/${route}`,
    { method: 'POST', headers: { 'dropbox-api-arg': headerArg(arg), 'content-type': 'application/octet-stream' }, body });

  /* Put a stream at `path`. `stream` is a web ReadableStream; it is cut into chunks so a 20 GB
     video never sits in memory. Returns the number of bytes stored. */
  async function upload(path, stream) {
    const reader = stream.getReader();
    let buf = [], have = 0, done = false;
    /* gather up to `want` bytes (or the end of the stream) */
    async function take(want) {
      while (have < want && !done) {
        const r = await reader.read();
        if (r.done) { done = true; break; }
        buf.push(Buffer.from(r.value)); have += r.value.length;
      }
      const all = Buffer.concat(buf, have);
      const out = all.subarray(0, Math.min(want, all.length));
      const rest = all.subarray(out.length);
      buf = rest.length ? [rest] : []; have = rest.length;
      return out;
    }
    try {
      const first = await take(SINGLE_MAX);
      const commit = { path, mode: 'overwrite', autorename: false, mute: true };
      if (done && have === 0) {                       /* it all fit in one go */
        await up('files/upload', commit, first);
        return first.length;
      }
      const s = await (await up('files/upload_session/start', { close: false }, first)).json();
      let offset = first.length;
      for (;;) {
        const chunk = await take(CHUNK);
        if (done && have === 0) {                     /* the last piece, possibly empty */
          await up('files/upload_session/finish', { cursor: { session_id: s.session_id, offset }, commit }, chunk);
          return offset + chunk.length;
        }
        await up('files/upload_session/append_v2', { cursor: { session_id: s.session_id, offset }, close: false }, chunk);
        offset += chunk.length;
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
  }

  /* a direct download address that stops working after four hours */
  async function tempLink(path) {
    const b = await (await rpc('files/get_temporary_link', { path })).json();
    return b.link;
  }

  /* a file that is already gone counts as removed */
  async function remove(path) {
    try { await rpc('files/delete_v2', { path }); return true; }
    catch (e) {
      if (e instanceof DropboxError && e.status === 409 && /not_found/.test(e.body?.error_summary || '')) return false;
      throw e;
    }
  }

  async function account() {
    return (await rpc('users/get_current_account')).json();
  }

  return { configured, token, upload, tempLink, remove, account };
}
