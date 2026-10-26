/* The tests behind every "Test" button on the setup page and the Connections screen. Each one takes
   an injected fetch, so the same code runs for real, in the admin, and against fakes in tests.

   A check returns { ok, checks: [{ id, label, ok, detail, fix?, permission?, warn? }] }. The point of
   every message is to say plainly what to do next, not to dump what the other server said. */

/* The permissions Immich asks an API key for, by the part of the API each one guards. */
export const PERMISSION = {
  albums: 'album.read', timeline: 'asset.read', thumbnail: 'asset.view', original: 'asset.download',
  archive: 'asset.download', search: 'asset.read', upload: 'asset.upload', albumCreate: 'album.create',
  albumAdd: 'albumAsset.create', albumRemove: 'albumAsset.delete', trash: 'asset.delete', restore: 'asset.delete',
};
/* What the keys this app makes for itself may do. Checked against Immich v3.3.5 (docs.immich.app, API spec): the
   read key needs these to list albums and photos, show thumbnails and download; `timeline.read` is harmless
   insurance for older versions. The write key is split so the owner can grant only what the admin will use. */
export const READ_PERMISSIONS = ['album.read', 'asset.read', 'asset.view', 'asset.download', 'timeline.read'];
export const WRITE_PERMISSIONS = {
  add: ['asset.upload', 'album.create', 'albumAsset.create'],
  remove: ['albumAsset.delete'],
  trash: ['asset.delete'],
};
export const KEY_NAMES = { read: 'immichset (read-only)', write: 'immichset (add and remove photos)' };
export const writePermissionsFor = level => level === 'add' ? WRITE_PERMISSIONS.add
  : level === 'addremove' ? [...WRITE_PERMISSIONS.add, ...WRITE_PERMISSIONS.remove]
  : level === 'all' ? [...WRITE_PERMISSIONS.add, ...WRITE_PERMISSIONS.remove, ...WRITE_PERMISSIONS.trash] : [];

const LABEL = {
  albums: 'list your albums', timeline: 'read an album\'s photo list', thumbnail: 'show thumbnails', original: 'download originals',
  archive: 'build zip downloads', search: 'read photo sizes',
};

/* Immich names the missing permission in its 403 answer; use that, and fall back to our own map */
export function missingPermission(body, endpoint) {
  const m = /Missing required permission:\s*([\w.]+)/i.exec(String(body || ''));
  return m ? m[1] : (PERMISSION[endpoint] || null);
}

const asJson = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const NIL_ID = '00000000-0000-4000-8000-000000000000';

/* What a key may do beyond reading. Immich answers the permission question before it checks the
   request, so a deliberately empty request asks without changing anything. `call(path, init)` returns
   a Response. A probe counts as allowed unless Immich says a permission is missing. */
export const WRITE_PROBES = {
  upload:      ['/api/assets', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: '--x--' }],
  albumCreate: ['/api/albums', asJson('POST', {})],
  albumAdd:    [`/api/albums/${NIL_ID}/assets`, asJson('PUT', { ids: [NIL_ID] })],
  albumRemove: [`/api/albums/${NIL_ID}/assets`, asJson('DELETE', { ids: [NIL_ID] })],
  trash:       ['/api/assets', asJson('DELETE', { ids: [NIL_ID], force: false })],
  restore:     ['/api/trash/restore/assets', asJson('POST', { ids: [NIL_ID] })],
};
export async function probeCaps(call, { detail = false } = {}) {
  const out = {}, why = {};
  await Promise.all(Object.entries(WRITE_PROBES).map(async ([k, [p, init]]) => {
    try {
      const r = await call(p, init);
      if (r.status !== 403) { out[k] = true; return; }
      const body = await r.text().catch(() => '');
      out[k] = !/Missing required permission/.test(body);
      if (!out[k]) why[k] = missingPermission(body, k);
    } catch { out[k] = true; }     /* unreachable: do not hide the buttons too */
  }));
  const ordered = Object.fromEntries(Object.keys(WRITE_PROBES).map(k => [k, out[k]]));
  return detail ? { caps: ordered, missing: why } : ordered;
}

const trim = u => String(u || '').trim().replace(/\/+$/, '');
const fail = (id, label, detail, extra = {}) => ({ id, label, ok: false, detail, ...extra });
const pass = (id, label, detail = '', extra = {}) => ({ id, label, ok: true, detail, ...extra });
const lim = () => ({ signal: AbortSignal.timeout(10_000) });

/* ---------------------------------------------------------------------------------- Immich */
export async function checkImmich({ url, key, writeKey, f = fetch }) {
  const base = trim(url), checks = [];
  const done = () => ({ ok: checks.every(c => c.ok || c.warn), checks });
  const call = (k, w = false) => (p, init = {}) => f(base + p, { ...lim(), ...init, headers: { 'x-api-key': k, ...(init.headers || {}) } });
  if (!base) { checks.push(fail('reach', 'Immich address', 'Enter the address of your Immich server.')); return done(); }

  let r;
  try { r = await f(`${base}/api/server/ping`, lim()); }
  catch (e) {
    checks.push(fail('reach', 'Reach Immich', `Couldn't reach ${base}.`, {
      fix: 'From inside a container, "localhost" is the container itself. Use your computer\'s network address (for example http://192.168.1.20:2283), or the Immich container\'s name if both are on the same Docker network.' }));
    return done();
  }
  if (!r.ok) { checks.push(fail('reach', 'Reach Immich', `${base} answered ${r.status}, so it may not be Immich.`, { fix: 'Check the address and port. Immich usually listens on 2283.' })); return done(); }
  let version = '';
  try { const v = await (await f(`${base}/api/server/version`, lim())).json(); version = `${v.major}.${v.minor}.${v.patch}`; } catch {}
  checks.push(pass('reach', 'Reach Immich', version ? `Immich ${version}` : 'Answered'));

  if (!key) { checks.push(fail('key', 'Read key', 'Paste your Immich read-only API key.')); return done(); }
  const rd = call(key);
  let albums;
  try {
    r = await rd('/api/albums');
    if (r.status === 401) { checks.push(fail('key', 'Read key', 'Immich did not recognise that key.', { fix: 'Copy it again from Immich › Account Settings › API Keys. It is only shown once, when you create it.' })); return done(); }
    if (r.status === 403) {
      const p = missingPermission(await r.text(), 'albums');
      checks.push(fail('albums', 'List albums', `Immich refused to list albums.`, { permission: p, fix: `Edit the key in Immich › Account Settings › API Keys and tick ${p}.` })); return done();
    }
    if (!r.ok) { checks.push(fail('albums', 'List albums', `Immich answered ${r.status}.`)); return done(); }
    albums = await r.json();
  } catch (e) { checks.push(fail('albums', 'List albums', 'Immich stopped answering partway through.')); return done(); }
  checks.push(pass('key', 'Read key accepted', ''));
  checks.push(pass('albums', 'List albums', `${albums.length} album${albums.length === 1 ? '' : 's'}`));

  /* try each thing the app does, against the smallest album that has a photo in it */
  const withPhotos = albums.filter(a => a.assetCount > 0).sort((a, b) => a.assetCount - b.assetCount)[0];
  if (!withPhotos) {
    checks.push({ id: 'photos', label: 'Photos, thumbnails and downloads', ok: true, warn: true, detail: 'There are no photos in any album yet.', fix: 'Make an album with a photo in it in Immich, then test again.' });
  } else {
    const step = async (id, label, endpoint, run) => {
      try {
        const res = await run();
        if (res.ok) return pass(id, label);
        let p = null;
        if (res.status === 403) p = missingPermission(await res.text().catch(() => ''), endpoint);
        return fail(id, label, res.status === 403 ? `Immich refused to ${LABEL[endpoint]}.` : `Immich answered ${res.status}.`,
          p ? { permission: p, fix: `Edit the key in Immich › Account Settings › API Keys and tick ${p}.` } : {});
      } catch { return fail(id, label, 'Immich stopped answering.'); }
    };
    const aid = encodeURIComponent(withPhotos.id);
    const buckets = await step('timeline', 'Read an album\'s photo list', 'timeline', () => rd(`/api/timeline/buckets?albumId=${aid}`));
    checks.push(buckets);
    let firstAsset = null;
    if (buckets.ok) {
      try {
        const b = await (await rd(`/api/timeline/buckets?albumId=${aid}`)).json();
        if (!Array.isArray(b)) checks.push(fail('shape', 'Photo list format', 'Immich answered in a format this app does not understand.', { fix: 'This app was built against an Immich version that lists albums differently. Update this app, or check the Immich version.' }));
        else if (b.length) {
          const d = await (await rd(`/api/timeline/bucket?albumId=${aid}&timeBucket=${encodeURIComponent(b[0].timeBucket)}`)).json();
          if (!Array.isArray(d.id)) checks.push(fail('shape', 'Photo list format', 'Immich answered in a format this app does not understand.', { fix: 'Update this app, or check the Immich version.' }));
          else { firstAsset = d.id[0]; checks.push(pass('shape', 'Photo list format')); }
        }
      } catch {}
    }
    if (firstAsset) {
      checks.push(await step('thumbnail', 'Show thumbnails', 'thumbnail', () => rd(`/api/assets/${firstAsset}/thumbnail?size=thumbnail`)));
      checks.push(await step('original', 'Download originals', 'original', () => rd(`/api/assets/${firstAsset}/original`, { headers: { range: 'bytes=0-1023' } })));
      checks.push(await step('archive', 'Build zip downloads', 'archive', async () => {
        const ctl = new AbortController(); const res = await rd('/api/download/archive', { ...asJson('POST', { assetIds: [firstAsset] }), signal: ctl.signal });
        ctl.abort(); return res;
      }));
      checks.push(await step('search', 'Read photo sizes', 'search', () => rd('/api/search/metadata', asJson('POST', { albumIds: [withPhotos.id], size: 1 }))));
    }
  }

  /* a read-only key should not be able to change anything: warn if it can */
  try {
    const caps = await probeCaps(rd);
    const canChange = Object.entries(caps).filter(([, v]) => v).map(([k]) => k);
    if (canChange.length) checks.push({ id: 'readonly', label: 'Read key is read-only', ok: true, warn: true,
      detail: 'This key can also change your Immich library.', fix: 'Make a second key with only the read permissions and use that here. A bug or a leak could then never delete a photo.' });
    else checks.push(pass('readonly', 'Read key is read-only'));
  } catch {}

  if (writeKey) {
    try {
      const { caps, missing } = await probeCaps(call(writeKey), { detail: true });
      const ok = Object.values(caps).every(Boolean);
      const named = Object.keys(missing).map(k => missing[k]).filter((v, i, a) => v && a.indexOf(v) === i);
      checks.push({ id: 'write', label: 'Write key', ok: true, warn: !ok,
        detail: ok ? 'Can add, remove and restore photos.' : `Can't do everything yet: ${Object.entries(caps).filter(([, v]) => !v).map(([k]) => ({ upload: 'upload photos', albumCreate: 'create albums', albumAdd: 'add to albums', albumRemove: 'remove from albums', trash: 'move to trash', restore: 'undo' }[k])).join(', ')}.`,
        ...(named.length ? { fix: `Edit the key in Immich and tick ${named.join(', ')}. Only the buttons that will work are shown in the admin, so this is optional.` } : {}), caps });
    } catch { checks.push(fail('write', 'Write key', 'Immich stopped answering.')); }
  }
  return done();
}

/* ---------------------------------------------------------------------------------- Resend */
export function translateResend(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  const name = (body && body.name) || '';
  const msg = (body && body.message) || text;
  const domain = /(?:domain|from)[^"]*?([a-z0-9.-]+\.[a-z]{2,})/i.exec(msg)?.[1];
  if (name === 'missing_api_key' || name === 'invalid_api_key' || status === 401 && !/restricted/i.test(name + msg))
    return { detail: 'Resend did not accept that key.', fix: 'Copy it again from resend.com/api-keys. Resend only shows a key once, when you create it.' };
  if (/not verified/i.test(msg) || /domain/i.test(msg) && /verif/i.test(msg))
    return { detail: `The domain${domain ? ` ${domain}` : ''} isn't verified in Resend yet.`, fix: 'Open resend.com/domains, add the records Resend lists (SPF, DKIM and MX) at wherever your domain\'s DNS is kept, and wait for it to say Verified. Then test again.' };
  if (/only send testing emails to your own/i.test(msg))
    return { detail: 'Resend only lets an unverified account send to your own address.', fix: 'Verify your domain at resend.com/domains and send from an address on it.' };
  if (name === 'invalid_from_address' || /invalid.*from/i.test(msg))
    return { detail: 'The "send from" address is not in a form Resend accepts.', fix: 'Use the form: Your Studio <hello@yourdomain.com>' };
  if (/invalid.*to|to.*invalid/i.test(msg)) return { detail: 'That recipient address is not valid.', fix: 'Check the address you typed.' };
  if (name === 'rate_limit_exceeded' || status === 429) return { detail: 'Resend says to slow down.', fix: 'Wait a minute and test again.' };
  if (/quota/i.test(name + msg)) return { detail: 'You have reached your Resend sending limit.', fix: 'The free plan allows 100 emails a day. Wait for it to reset, or upgrade.' };
  return { detail: `Resend answered ${status}${msg ? `: ${String(msg).slice(0, 160)}` : ''}.`, fix: '' };
}

export async function checkResend({ apiKey, from, replyTo, to, base = 'https://api.resend.com', f = fetch }) {
  const checks = [];
  const done = () => ({ ok: checks.every(c => c.ok || c.warn), checks });
  if (!apiKey) { checks.push(fail('key', 'Resend key', 'Paste your Resend API key.')); return done(); }
  if (!from) { checks.push(fail('from', 'Send from', 'Enter the address mail will come from.')); return done(); }
  const hdr = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  const j = async r => { try { return await r.json(); } catch { return null; } };

  /* a key that can list domains has full access; one that cannot is sending-only, which is what we want */
  try {
    const r = await f(`${base}/domains`, { headers: hdr, ...lim() });
    const body = await j(r);
    if (r.ok) checks.push({ id: 'scope', label: 'Key type', ok: true, warn: true, detail: 'This key has full access to your Resend account.', fix: 'It works, but a key limited to Sending access is safer. Create one at resend.com/api-keys.' });
    else if (r.status === 401 && /restricted/i.test(JSON.stringify(body))) checks.push(pass('scope', 'Key type', 'Sending-only key. That is the safe choice.'));
    else if (r.status === 401 || r.status === 403) { const t = translateResend(r.status, body); if (/did not accept/.test(t.detail)) { checks.push(fail('key', 'Resend key', t.detail, { fix: t.fix })); return done(); } }
  } catch { checks.push(fail('reach', 'Reach Resend', 'This computer could not reach resend.com.', { fix: 'Check that the container has internet access.' })); return done(); }

  if (!to) { checks.push({ id: 'send', label: 'Send a test email', ok: true, warn: true, detail: 'Enter an address to send a test to.' }); return done(); }
  try {
    const r = await f(`${base}/emails`, { method: 'POST', headers: hdr, ...lim(),
      body: JSON.stringify({ from, to: [to], subject: 'Your gallery server can send email', ...(replyTo ? { reply_to: replyTo } : {}),
        html: '<p>This is a test from your new gallery server. If you can read it, email is working.</p>', text: 'This is a test from your new gallery server. If you can read it, email is working.' }) });
    const body = await j(r);
    if (r.ok) checks.push(pass('send', 'Send a test email', `Sent to ${to}. Check your inbox, and the spam folder.`));
    else { const t = translateResend(r.status, body); checks.push(fail('send', 'Send a test email', t.detail, t.fix ? { fix: t.fix } : {})); }
  } catch { checks.push(fail('send', 'Send a test email', 'Resend stopped answering.')); }
  return done();
}

/* ------------------------------------------------------------------------------ Cloudflare */
export async function checkCloudflare({ kind, token, accountId, project, domain, host, f = fetch }) {
  const checks = [];
  const done = () => ({ ok: checks.every(c => c.ok || c.warn), checks });
  if (!token) { checks.push(fail('token', 'Cloudflare token', 'Paste the token.')); return done(); }
  const cf = async p => { const r = await f(`https://api.cloudflare.com/client/v4${p}`, { headers: { authorization: `Bearer ${token}` }, ...lim() }); return { r, j: await r.json().catch(() => null) }; };
  try {
    const v = await cf(accountId ? `/accounts/${encodeURIComponent(accountId)}/tokens/verify` : '/user/tokens/verify');
    if (!v.r.ok || v.j?.success === false) { checks.push(fail('token', 'Cloudflare token', 'Cloudflare did not accept that token.', { fix: 'Create it at dash.cloudflare.com › My Profile › API Tokens, and copy it when it is shown.' })); return done(); }
    checks.push(pass('token', 'Cloudflare token accepted'));
    if (kind === 'pages') {
      if (!accountId || !project) { checks.push(fail('project', 'Pages project', 'Enter the account ID and the project name.')); return done(); }
      const p = await cf(`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(project)}`);
      if (p.r.status === 404) checks.push(fail('project', 'Pages project', `There is no Pages project called ${project}.`, { fix: 'Create the project in Cloudflare › Workers & Pages first.' }));
      else if (p.r.status === 403) checks.push(fail('project', 'Pages project', 'The token cannot see Pages.', { fix: 'Give it Account › Cloudflare Pages › Edit.' }));
      else checks.push(p.r.ok ? pass('project', 'Pages project found') : fail('project', 'Pages project', `Cloudflare answered ${p.r.status}.`));
    } else if (kind === 'dns') {
      if (!domain || !host) { checks.push(fail('record', 'DNS record', 'Enter the domain and the host name.')); return done(); }
      const z = await cf(`/zones?name=${encodeURIComponent(domain)}`);
      const zone = z.j?.result?.[0];
      if (!zone) { checks.push(fail('zone', 'DNS zone', `That token cannot see ${domain}.`, { fix: 'Give it Zone › DNS › Edit for that one domain.' })); return done(); }
      const rec = await cf(`/zones/${zone.id}/dns_records?type=A&name=${encodeURIComponent(`${host}.${domain}`)}`);
      checks.push(rec.j?.result?.length ? pass('record', 'DNS record found') : fail('record', 'DNS record', `There is no A record for ${host}.${domain}.`, { fix: 'Create it once in Cloudflare (any address). The app only keeps an existing record up to date; it never creates one.' }));
    }
  } catch { checks.push(fail('reach', 'Reach Cloudflare', 'Could not reach Cloudflare.')); }
  return done();
}

/* ---------------------------------------------------------------------------- public address */
/* Does this address lead back to this very server? The server carries a random id in a header. */
export async function checkPublic({ url, instance, f = fetch }) {
  const checks = [];
  const u = trim(url);
  if (!u) { checks.push(fail('url', 'Public address', 'Enter the address your clients will use.')); return { ok: false, checks }; }
  try {
    const x = new URL(u);
    if (x.protocol === 'http:' && !/^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.hostname) && !x.hostname.endsWith('.local'))
      checks.push({ id: 'https', label: 'Secure address', ok: true, warn: true, detail: 'This address is http, not https.', fix: 'Client sign-in cookies and links should use https. Put a reverse proxy or a Cloudflare Tunnel in front, and use its https address here.' });
  } catch { checks.push(fail('url', 'Public address', 'That is not a web address.')); return { ok: false, checks }; }
  try {
    const r = await f(`${u}/healthz`, lim());
    const id = r.headers.get('x-immichset-instance');
    /* the address is https but this server was told visitors came in over http: the proxy is not passing that on,
       so sign-in cookies would not be marked secure */
    if (r.ok && /^https:/i.test(u) && id === instance) {
      const body = await r.clone().json().catch(() => null);
      if (body && body.https === false) checks.push({ id: 'secure', label: 'Sign-in cookies are secure', ok: true, warn: true,
        detail: 'Your proxy is not telling this server that visitors use https.',
        fix: 'Make it send the X-Forwarded-Proto header (Cloudflare Tunnel and Caddy do this by default; nginx needs proxy_set_header X-Forwarded-Proto $scheme;).' });
    }
    if (r.headers.get('cf-ray')) checks.push(pass('cloudflare', 'Arrives through Cloudflare', 'Your tunnel is working.'));
    checks.push(id && id === instance ? pass('reach', 'Reaches this server') : r.ok
      ? { id: 'reach', label: 'Reaches this server', ok: true, warn: true, detail: 'Something answered, but it may not be this server.', fix: 'Check the address points at port 3000 of this container.' }
      : fail('reach', 'Reaches this server', `${u} answered ${r.status}.`));
  } catch {
    checks.push({ id: 'reach', label: 'Reaches this server', ok: true, warn: true, detail: 'This server could not reach that address from the inside.',
      fix: 'That is normal if the address only works from outside your network. Check it from your phone on mobile data.' });
  }
  return { ok: checks.every(c => c.ok || c.warn), checks };
}
