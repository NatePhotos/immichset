/* Everything the admin Home page shows, gathered from the database in one go.
   A pure function of the database and the context passed in: no network, no clock of its own. */
const DAY = 86400_000, HOUR = 3600_000;
/* created_at columns are SQLite 'YYYY-MM-DD HH:MM:SS' in UTC */
const sqlTime = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function overview(db, { now = Date.now(), site = null, mailReady = false, backups = [], publicUrl = '' } = {}) {
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

  if (site?.dirty) attention.push({ kind: 'website', title: 'Website changes are not published',
    detail: 'You have edits that visitors cannot see yet', action: 'website' });
  if (site?.pendingImmich > 0) attention.push({ kind: 'immich',
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
    site: check ? { ok: !!check.ok, detail: check.ok ? 'Loading normally' : `Not loading (${check.why})` }
                : { ok: null, detail: 'Not checked yet' },
    nas: hours == null ? { ok: false, detail: 'No backup found' }
       : { ok: hours < 36, detail: hours < 1 ? 'Last backup under an hour ago' : `Last backup ${plural(hours, 'hour', 'hours')} ago` },
    email: { ok: !!mailReady, detail: mailReady ? 'Ready to send' : 'Not set up' },
  };

  return { stats, attention, activity, health, recent };
}
