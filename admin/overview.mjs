/* Everything the admin Home page shows, gathered from the database in one go.
   A pure function of the database and the context passed in: no network, no clock of its own. */
const DAY = 86400_000, HOUR = 3600_000;
/* created_at columns are SQLite 'YYYY-MM-DD HH:MM:SS' in UTC */
const sqlTime = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function overview(db, { now = Date.now(), site = null, mailReady = false, backups = [], publicUrl = '', extraHealth = {}, siteConfigured = true, getting = null } = {}) {
  const week = sqlTime(now - 7 * DAY), prev = sqlTime(now - 14 * DAY);
  const count = (sql, ...a) => db.prepare(sql).get(...a).n;

  const isLive = g => !!g.published_at && !(g.expires_at && Date.parse(g.expires_at) < now);
  const published = db.prepare('SELECT * FROM galleries WHERE published_at IS NOT NULL').all();

  const views = (from, to) => count(
    "SELECT COUNT(*) n FROM events WHERE type = 'view' AND created_at >= ? AND created_at < ?", from, to);
  const stats = {
    liveGalleries: published.filter(isLive).length,
    viewsWeek: views(week, sqlTime(now + DAY)),
    viewsPrevWeek: views(prev, week),
    downloadsWeek: count("SELECT COUNT(*) n FROM events WHERE type IN ('download','download_all') AND created_at >= ?", week),
    signupsWeek: count('SELECT COUNT(*) n FROM registrations WHERE created_at >= ?', week),
  };

  const attention = [];
  const noDownload = db.prepare(`SELECT COUNT(*) n FROM registrations r WHERE r.gallery_id = ? AND NOT EXISTS
    (SELECT 1 FROM events e WHERE e.reg_id = r.id AND e.type IN ('download','download_all'))`);
  const regs = db.prepare('SELECT COUNT(*) n FROM registrations WHERE gallery_id = ?');
  for (const g of published.filter(isLive)) {
    const left = g.expires_at ? Date.parse(g.expires_at) - now : NaN;
    if (!(left >= 0 && left <= 7 * DAY)) continue;
    const days = Math.max(0, Math.ceil(left / DAY));
    const total = regs.get(g.id).n, none = noDownload.get(g.id).n;
    attention.push({ kind: 'expiring', title: `${g.title} expires ${days <= 1 ? 'within a day' : `in ${days} days`}`,
      detail: total ? `${none} of ${plural(total, 'person', 'people')} registered have not downloaded` : 'Nobody has registered yet',
      galleryId: g.id, action: 'gallery' });
  }

  const favRows = db.prepare(`SELECT f.gallery_id gid, g.title, COUNT(*) n, COUNT(DISTINCT f.registration_id) people,
      MIN(r.name) name, MIN(r.email) email
    FROM favourites f JOIN galleries g ON g.id = f.gallery_id JOIN registrations r ON r.id = f.registration_id
    WHERE f.created_at >= ? GROUP BY f.gallery_id ORDER BY MAX(f.created_at) DESC, f.gallery_id`).all(week);
  for (const f of favRows) {
    const what = plural(f.n, 'favourite', 'favourites');
    attention.push({ kind: 'favourites', title: `New favourites in ${f.title}`,
      detail: f.people === 1 ? `${what} from ${f.name || f.email}` : what, galleryId: f.gid, action: 'gallery' });
  }

  /* the portfolio website is optional: until someone has set it up there is nothing to publish and nothing to nag about */
  if (siteConfigured && site?.dirty) attention.push({ kind: 'website', title: 'Website changes are not published',
    detail: 'You have edits that visitors cannot see yet', action: 'website' });
  if (siteConfigured && site?.pendingImmich > 0) attention.push({ kind: 'immich',
    title: `${plural(site.pendingImmich, 'website photo is', 'website photos are')} waiting for Immich`,
    detail: 'They will be saved automatically once Immich answers', action: 'website' });

  const activity = db.prepare(`SELECT e.created_at at, e.type, e.gallery_id galleryId, g.title galleryTitle, r.email
    FROM events e JOIN galleries g ON g.id = e.gallery_id LEFT JOIN registrations r ON r.id = e.reg_id
    WHERE e.type IN ('register','favourite','download','download_all')
    ORDER BY e.created_at DESC, e.id DESC LIMIT 8`).all().map(a => ({ ...a, email: a.email || undefined }));

  const recent = db.prepare(`SELECT g.id, g.title, g.slug, g.cover_asset_id, g.cover_file, g.expires_at, g.published_at,
      (SELECT COUNT(*) FROM events e WHERE e.gallery_id = g.id AND e.type = 'view') views
    FROM galleries g ORDER BY g.created_at DESC, g.id DESC LIMIT 4`).all().map(g => ({
      id: g.id, title: g.title, slug: g.slug,
      status: !g.published_at ? 'draft' : isLive(g) ? 'live' : 'expired',
      coverAssetId: g.cover_asset_id, coverFile: g.cover_file, views: g.views, expiresAt: g.expires_at }));

  const check = site?.check;
  const newest = backups.map(b => Date.parse(b.at)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const hours = newest == null ? null : Math.max(0, Math.floor((now - newest) / HOUR));
  const health = {
    ...(siteConfigured ? { site: check ? { ok: !!check.ok, detail: check.ok ? 'Loading normally' : `Not loading (${check.why})` }
                                       : { ok: null, detail: 'Not checked yet' } } : {}),
    nas: hours == null ? { ok: false, detail: 'No backup found' }
       : { ok: hours < 36, detail: hours < 1 ? 'Last backup under an hour ago' : `Last backup ${plural(hours, 'hour', 'hours')} ago` },
    email: { ok: !!mailReady, detail: mailReady ? 'Ready to send' : 'Not set up' },
    ...extraHealth,   /* the server's own checks: Immich, disk, zips, downloads */
  };

  /* A short list for a brand-new install, from "I have a server" to "my first client opened a gallery". It appears only
     after the setup page has finished (an install run from a compose file never shows it) and until it is dismissed. */
  let checklist = null;
  if (getting && getting.setupDone && !getting.dismissed) {
    const galleries = db.prepare('SELECT COUNT(*) n FROM galleries').get().n;
    const https = /^https:\/\//i.test(publicUrl || '');
    const items = [
      { id: 'photos', title: 'Put photos in an Immich album', done: (getting.albums ?? 0) > 0,
        detail: 'Immich keeps your photos. Add some to an album there (or upload them from New gallery).', doc: 'PHOTOS' },
      { id: 'gallery', title: 'Make your first gallery', done: galleries > 0, section: 'galleries', detail: 'Pick the album, give it a name, and publish.', doc: 'PHOTOS' },
      { id: 'brand', title: 'Add your name, address and logo', done: !!getting.brand, section: 'connections',
        detail: 'They go on every gallery cover and in the footer of every email. Your postal address is required by law before you can email your contacts.', doc: 'BRANDING' },
      { id: 'email', title: 'Set up email', done: !!mailReady, section: 'connections', detail: 'So you can send gallery links and reminders. It also turns on the emailed sign-in code.', doc: 'EMAIL' },
      { id: 'online', title: 'Put it online for your clients', done: https, section: 'connections', detail: 'Right now the address only works at home. A Cloudflare Tunnel gives it a real https address.', doc: 'ONLINE' },
      { id: 'backup', title: 'Check that backups are running', done: backups.length > 0, detail: 'A copy of your database is made every night.', doc: 'BACKUPS' },
      { id: 'offsite', title: 'Keep one copy somewhere else', done: !!getting.offsite, manual: true,
        detail: 'If the computer is lost or stolen, a copy in the same room is lost too. Copy your photos and the settings file to a drive or cloud you control.', doc: 'BACKUPS' },
    ];
    checklist = { items, doneCount: items.filter(i => i.done).length };
  }

  return { stats, attention, activity, health, recent, checklist };
}
