#!/usr/bin/env node
/* A smoke test for a running immichset.
 *
 *   ADMIN_TOKEN=... node smoke.mjs https://your-domain            read-only-ish
 *   ADMIN_TOKEN=... node smoke.mjs https://your-domain --write    also uploads and trashes
 *
 * It builds a throwaway gallery called smoke-check, walks it the way a client
 * would, and removes it again — including when something fails along the way.
 * Nothing it touches outlives the run except photos it uploaded with --write,
 * which it puts in Immich's trash.
 *
 * Exit code 0 means every check passed.
 */
import { argv, env, exit } from 'node:process';

const BASE  = (argv[2] && !argv[2].startsWith('--') ? argv[2] : env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const TOKEN = env.ADMIN_TOKEN || '';
const WRITE = argv.includes('--write');
const SLUG  = 'smoke-check';

if (!TOKEN) { console.error('ADMIN_TOKEN is not set'); exit(2); }

let pass = 0, fail = 0, skip = 0;
const failures = [];

async function check(name, fn) {
  try {
    const note = await fn();
    pass++;
    console.log(`  ✓ ${name}${note ? `  ${note}` : ''}`);
  } catch (e) {
    fail++;
    failures.push(`${name}: ${e.message}`);
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
function skipped(name, why) { skip++; console.log(`  - ${name}  (${why})`); }
function section(t) { console.log(`\n${t}`); }

function is(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/* ---- plumbing ---- */
const jar = new Map();                       /* a client's cookies, kept apart from the admin's */
function cookieHeader() {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}
function remember(res) {
  for (const c of (res.headers.getSetCookie?.() || [])) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
async function adminFetch(path, init = {}) {
  return fetch(BASE + path, { ...init, headers: { 'x-admin-token': TOKEN, ...(init.headers || {}) } });
}
async function adminJson(path, init) {
  const r = await adminFetch(path, init);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(body)}`);
  return body;
}
async function clientFetch(path, init = {}) {
  const r = await fetch(BASE + path, {
    ...init,
    headers: { ...(init.headers || {}), ...(jar.size ? { cookie: cookieHeader() } : {}) },
    redirect: 'manual',
  });
  remember(r);
  return r;
}
async function clientJson(path, init) {
  const r = await clientFetch(path, init);
  return { status: r.status, body: await r.json().catch(() => null), res: r };
}
const post = (path, data) => adminFetch(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data || {}),
});
const patch = (path, data) => adminFetch(path, {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data || {}),
});

/* a real, tiny JPEG, so Immich has something it will actually accept */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAQABABAREA/8QAHwAAAQUBAQEB' +
  'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
  'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
  'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiigD//Z', 'base64');

let galleryId = null;

async function teardown() {
  if (galleryId == null) return;
  try {
    const r = await adminFetch(`/api/admin/galleries/${galleryId}`, { method: 'DELETE' });
    console.log(r.ok ? '\n  cleaned up the smoke gallery' : `\n  WARNING: could not remove gallery ${galleryId}`);
  } catch { console.log(`\n  WARNING: could not remove gallery ${galleryId}`); }
}

/* ---- the run ---- */
console.log(`immichset smoke test\n  target: ${BASE}\n  mode:   ${WRITE ? 'read and write' : 'read only (pass --write to include uploads)'}`);

try {
  section('service');
  await check('health endpoint answers', async () => {
    const r = await fetch(`${BASE}/healthz`);
    is(r.status, 200, 'status');
  });
  await check('admin page is served', async () => {
    const r = await fetch(`${BASE}/admin`);
    is(r.status, 200, 'status');
  });
  await check('admin api refuses an anonymous caller', async () => {
    const r = await fetch(`${BASE}/api/admin/galleries`);
    is(r.status, 401, 'status');
  });

  let me, albums;
  await check('admin api accepts the token', async () => {
    me = await adminJson('/api/admin/me');
    ok(me.ok, 'me did not report ok');
    return `upload=${me.canUpload} caps=${Object.entries(me.caps || {}).filter(([, v]) => v).map(([k]) => k).join(',') || 'none'}`;
  });
  await check('immich is reachable through the app', async () => {
    albums = await adminJson('/api/admin/albums');
    ok(Array.isArray(albums) && albums.length, 'no albums came back');
    return `${albums.length} albums`;
  });

  const album = (albums || []).filter(a => a.count > 0).sort((a, b) => a.count - b.count)[0];
  if (!album) throw new Error('no album with photos to test against');

  section('galleries');
  await check('rejects a malformed web address', async () => {
    const r = await post('/api/admin/galleries', { slug: 'Not A Slug!', title: 'x', albumId: album.id });
    is(r.status, 400, 'status');
  });
  await check('rejects a reserved web address', async () => {
    const r = await post('/api/admin/galleries', { slug: 'admin', title: 'x', albumId: album.id });
    is(r.status, 400, 'status');
  });
  await check('creates a gallery', async () => {
    const r = await post('/api/admin/galleries', {
      slug: SLUG, title: 'Smoke Check', subtitle: '2026-01-02', albumId: album.id,
      requireEmail: true, allowDownload: true, publish: true,
    });
    const b = await r.json();
    if (r.status === 409) throw new Error('a smoke-check gallery already exists; remove it and run again');
    is(r.status, 201, 'status');
    galleryId = b.id;
    return `id ${b.id}, ${album.count} photos in "${album.name}"`;
  });
  await check('refuses a duplicate web address', async () => {
    const r = await post('/api/admin/galleries', { slug: SLUG, title: 'x', albumId: album.id });
    is(r.status, 409, 'status');
  });
  await check('writes the date out in long form', async () => {
    const g = await adminJson(`/api/admin/galleries/${galleryId}`);
    is(g.subtitleText, 'January 2nd, 2026', 'subtitleText');
  });
  await check('starts with one set', async () => {
    const g = await adminJson(`/api/admin/galleries/${galleryId}`);
    is(g.sets.length, 1, 'set count');
  });

  section('sets');
  let sets;
  await check('adds a second set from an existing album', async () => {
    const r = await post(`/api/admin/galleries/${galleryId}/sets`, { name: 'Second', albumId: album.id });
    is(r.status, 201, 'status');
    sets = (await r.json()).sets;
    is(sets.length, 2, 'set count');
  });
  await check('renames a set', async () => {
    const r = await patch(`/api/admin/galleries/${galleryId}/sets/${sets[0].id}`, { name: 'Renamed' });
    is(r.status, 200, 'status');
    is((await r.json()).sets[0].name, 'Renamed', 'name');
  });
  await check('reorders sets', async () => {
    const r = await patch(`/api/admin/galleries/${galleryId}/sets/${sets[1].id}`, { move: 'up' });
    const after = (await r.json()).sets;
    is(after[0].id, sets[1].id, 'first set after moving up');
  });
  await check('removes a set', async () => {
    const r = await adminFetch(`/api/admin/galleries/${galleryId}/sets/${sets[1].id}`, { method: 'DELETE' });
    is(r.status, 200, 'status');
    is((await r.json()).sets.length, 1, 'set count');
  });
  await check('refuses to remove the last set', async () => {
    const left = (await adminJson(`/api/admin/galleries/${galleryId}`)).sets;
    const r = await adminFetch(`/api/admin/galleries/${galleryId}/sets/${left[0].id}`, { method: 'DELETE' });
    is(r.status, 400, 'status');
  });

  section('what a client sees');
  await check('the page is served for the slug', async () => {
    const r = await fetch(`${BASE}/${SLUG}`);
    is(r.status, 200, 'status');
  });
  await check('the page carries link-preview tags', async () => {
    const html = await (await fetch(`${BASE}/${SLUG}`)).text();
    ok(html.includes('og:title') && html.includes('og:image'), 'og tags missing');
  });
  await check('the lightbox can always be closed', async () => {
    const html = await (await fetch(`${BASE}/${SLUG}`)).text();
    // A phone browser's chrome can leave the visible area offset inside the viewport that
    // `position:fixed` measures against, which once put the close button off the top of the
    // screen. The overlay follows the visible area now, and there are two other ways out.
    ok(html.includes('--lbt'), 'the lightbox is pinned to the top of the layout viewport again');
    ok(html.includes('vv.offsetTop'), 'nothing reads visualViewport.offsetTop');
    ok(html.includes('e.key==="Escape"'), 'Escape no longer closes the lightbox');
    ok(html.includes('e.target.id==="lbStage"'), 'a tap on the surround no longer closes the lightbox');
  });
  await check('a slug that does not exist is a 404', async () => {
    const r = await fetch(`${BASE}/definitely-not-a-gallery-here`);
    is(r.status, 404, 'status');
  });
  await check('the descriptor asks for an email', async () => {
    const { status, body } = await clientJson(`/api/g/${SLUG}`);
    is(status, 200, 'status');
    is(body.gate, 'email', 'gate');
    is(body.subtitle, 'January 2nd, 2026', 'subtitle');
  });
  await check('the cover is visible before the gate', async () => {
    const r = await clientFetch(`/api/g/${SLUG}/cover`);
    is(r.status, 200, 'status');
    /* measured, not taken from a header: not every upstream sends a length */
    const n = (await r.arrayBuffer()).byteLength;
    ok(n > 0, 'cover was empty');
    return `${(n / 1024).toFixed(0)} KB`;
  });
  await check('photos are refused before registering', async () => {
    const r = await clientFetch(`/api/g/${SLUG}/assets`);
    is(r.status, 401, 'status');
  });
  await check('a bad email address is refused', async () => {
    const r = await clientFetch(`/api/g/${SLUG}/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nope' }),
    });
    is(r.status, 400, 'status');
  });

  let assets = [];
  await check('registering opens the gallery', async () => {
    const r = await clientFetch(`/api/g/${SLUG}/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'smoke@example.invalid', name: 'Smoke' }),
    });
    is(r.status, 200, 'status');
    const got = await clientJson(`/api/g/${SLUG}/assets`);
    is(got.status, 200, 'assets status');
    assets = got.body.assets;
    ok(assets.length > 0, 'no photos came back');
    return `${assets.length} photos`;
  });
  await check('the asset list is compressed when it is worth it', async () => {
    const plain = await clientFetch(`/api/g/${SLUG}/assets`, { headers: { 'accept-encoding': 'identity' } });
    const raw = (await plain.arrayBuffer()).byteLength;
    const r = await clientFetch(`/api/g/${SLUG}/assets`, { headers: { 'accept-encoding': 'gzip' } });
    const gz = /gzip/.test(r.headers.get('content-encoding') || '');
    /* below an MTU there is nothing to gain, and the app deliberately leaves it alone */
    if (raw <= 1400) return `${raw} B, under the threshold`;
    ok(gz, `${raw} B went out uncompressed`);
    return `${raw} B compressed`;
  });

  section('photos');
  const first = () => assets[0].id;
  for (const [size, label] of [['thumbnail', 'grid'], ['preview', 'viewer'], ['web', 'web download'], ['original', 'full download']]) {
    await check(`serves the ${label} size`, async () => {
      /* ask for the first kilobyte: an original can be a gigabyte of video, and
         pulling it down every run would make this unrunnable */
      const r = await clientFetch(`/api/g/${SLUG}/img/${first()}?size=${size}`, { headers: { range: 'bytes=0-1023' } });
      ok(r.status === 206 || r.status === 200, `status ${r.status}`);
      const got = (await r.arrayBuffer()).byteLength;
      ok(got > 0, 'empty body');
      /* a 206 says how big the whole thing is; a server that ignored the range
         just sent all of it, which is equally proof the URL works */
      const total = Number((/\/(\d+)$/.exec(r.headers.get('content-range') || '') || [])[1] || got);
      return total > 1048576 ? `${(total / 1048576).toFixed(1)} MB` : `${(total / 1024).toFixed(0)} KB`;
    });
  }
  await check('photos are marked immutable', async () => {
    const r = await clientFetch(`/api/g/${SLUG}/img/${first()}?size=thumbnail`);
    ok(/immutable/.test(r.headers.get('cache-control') || ''), 'cache-control lacks immutable');
  });
  await check('the cover is not marked immutable', async () => {
    const r = await clientFetch(`/api/g/${SLUG}/cover`);
    ok(!/immutable/.test(r.headers.get('cache-control') || ''), 'a changed cover would be stuck in caches');
  });
  await check('a photo from outside the gallery is refused', async () => {
    const r = await clientFetch(`/api/g/${SLUG}/img/00000000-0000-4000-8000-000000000000?size=thumbnail`);
    is(r.status, 404, 'status');
  });

  section('order, favourites, downloads');
  await check('oldest first reverses the run', async () => {
    const newest = (await clientJson(`/api/g/${SLUG}/assets`)).body.assets.map(a => a.id);
    await patch(`/api/admin/galleries/${galleryId}`, { sortOrder: 'oldest' });
    const oldest = (await clientJson(`/api/g/${SLUG}/assets`)).body.assets.map(a => a.id);
    ok(newest.length === oldest.length, 'different counts');
    if (newest.length > 1) ok(newest[0] !== oldest[0], 'the order did not change');
    await patch(`/api/admin/galleries/${galleryId}`, { sortOrder: 'newest' });
  });
  await check('the order choice is remembered', async () => {
    await patch(`/api/admin/galleries/${galleryId}`, { sortOrder: 'oldest' });
    const after = await adminJson('/api/admin/me');
    is(after.defaultSort, 'oldest', 'remembered order');
    await patch(`/api/admin/galleries/${galleryId}`, { sortOrder: 'newest' });
  });
  await check('a nonsense focal point falls back to the centre', async () => {
    const r = await patch(`/api/admin/galleries/${galleryId}`, { coverFocus: '900 nonsense' });
    is((await r.json()).coverFocus, '50 50', 'coverFocus');
  });
  await check('a good focal point is kept', async () => {
    const r = await patch(`/api/admin/galleries/${galleryId}`, { coverFocus: '20 80' });
    is((await r.json()).coverFocus, '20 80', 'coverFocus');
  });
  await check('a favourite is saved and listed', async () => {
    const r = await clientFetch(`/api/g/${SLUG}/favourites`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: first(), on: true }),
    });
    is(r.status, 200, 'status');
    const seen = await adminJson(`/api/admin/galleries/${galleryId}/favourites`);
    is(seen.distinct, 1, 'distinct favourites');
    is(seen.people.length, 1, 'clients with favourites');
  });
  await check('a download is attributed to the client who made it', async () => {
    const r = await clientFetch(`/api/g/${SLUG}/img/${first()}?size=web`);
    is(r.status, 200, 'status');
    await r.arrayBuffer();
    const seen = await adminJson(`/api/admin/galleries/${galleryId}/downloads`);
    ok(seen.people.some(p => p.email && p.ids.includes(first())), 'download listed under a client');
  });
  await check('a favourite outside the gallery is refused', async () => {
    const r = await clientFetch(`/api/g/${SLUG}/favourites`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: '00000000-0000-4000-8000-000000000000', on: true }),
    });
    is(r.status, 404, 'status');
  });
  await check('a favourite can be taken back', async () => {
    const r = await clientFetch(`/api/g/${SLUG}/favourites`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: first(), on: false }),
    });
    is((await r.json()).count, 0, 'remaining favourites');
  });
  await check('downloads can be switched off', async () => {
    await patch(`/api/admin/galleries/${galleryId}`, { allowDownload: false });
    const r = await clientFetch(`/api/g/${SLUG}/img/${first()}?size=original`);
    is(r.status, 403, 'status');
    await patch(`/api/admin/galleries/${galleryId}`, { allowDownload: true });
  });

  section('visibility');
  await check('an unpublished gallery is not found', async () => {
    await patch(`/api/admin/galleries/${galleryId}`, { published: false });
    const r = await clientFetch(`/api/g/${SLUG}`);
    is(r.status, 404, 'status');
    await patch(`/api/admin/galleries/${galleryId}`, { published: true });
  });
  await check('an expired gallery is gone', async () => {
    await patch(`/api/admin/galleries/${galleryId}`, { expiresAt: '2020-01-01T00:00:00.000Z' });
    const r = await clientFetch(`/api/g/${SLUG}`);
    is(r.status, 410, 'status');
    await patch(`/api/admin/galleries/${galleryId}`, { expiresAt: null });
  });
  await check('a password gate asks for a password', async () => {
    await patch(`/api/admin/galleries/${galleryId}`, { password: 'smoke-secret', requireEmail: false });
    const fresh = await fetch(`${BASE}/api/g/${SLUG}`);
    is((await fresh.json()).gate, 'password', 'gate');
    await patch(`/api/admin/galleries/${galleryId}`, { password: '', requireEmail: true });
  });

  section('housekeeping');
  await check('backups are configured and recent', async () => {
    const b = await adminJson('/api/admin/backups');
    ok(b.dir, 'no BACKUP_DIR set');
    if (!b.backups.length) {
      /* a fresh install has not reached its first run yet; make one and judge that */
      await post('/api/admin/backups', {});
    }
    const again = await adminJson('/api/admin/backups');
    Object.assign(b, again);
    ok(b.backups.length > 0, 'a backup was asked for and none appeared');
    const newest = b.backups[0];
    const age = (Date.now() - new Date(newest.at).getTime()) / 86400_000;
    ok(age < 2, `newest snapshot is ${age.toFixed(1)} days old`);
    return `${b.backups.length} snapshots, ${b.covers} cover files, newest ${age.toFixed(1)} days old`;
  });
  await check('email is configured', async () => {
    const m = await adminJson('/api/admin/mail-status');
    ok(m.configured, 'email is not configured');
    return `from ${m.from}`;
  });

  section('uploads');
  if (!WRITE) skipped('upload a photo and trash it', 'pass --write to include this');
  else if (!me?.caps?.upload) skipped('upload a photo and trash it', 'the Immich key cannot upload');
  else {
    let uploadedId = null, setAlbum = null;
    await check('uploads a photo into the set', async () => {
      setAlbum = (await adminJson(`/api/admin/galleries/${galleryId}`)).sets[0].albumId;
      const r = await adminFetch(
        `/api/admin/upload?albumId=${setAlbum}&name=smoke-check.jpg&created=${new Date().toISOString()}`,
        { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: TINY_JPEG });
      is(r.status, 200, 'status');
      const b = await r.json();
      uploadedId = b.id;
      ok(b.added, 'it was not added to the album');
      return b.status;
    });
    await check('refuses a file that is not a photo or video', async () => {
      const r = await adminFetch(`/api/admin/upload?albumId=${setAlbum}&name=notes.pdf`,
        { method: 'POST', body: Buffer.from('x') });
      is(r.status, 415, 'status');
    });
    if (me.caps.trash) {
      await check('trashes the uploaded photo again', async () => {
        const r = await post(`/api/admin/photos/trash`, { albumId: setAlbum, ids: [uploadedId] });
        is(r.status, 200, 'status');
        is((await r.json()).n, 1, 'photos trashed');
      });
    } else skipped('trash the uploaded photo again', 'the Immich key cannot delete');
  }
} catch (e) {
  fail++;
  failures.push(`run aborted: ${e.message}`);
  console.log(`\n  ✗ run aborted: ${e.message}`);
} finally {
  await teardown();
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
if (failures.length) {
  console.log('\nfailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
exit(fail ? 1 : 0);
