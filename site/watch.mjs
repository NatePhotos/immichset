/* Things that run on a timer: putting photos into Immich when it was unreachable, and
   checking the live site. Every problem emails once, reminds after a day, and says when
   it is fixed. */
const DAY = 86400_000;

export function createWatcher({ store, tellAdmin, sendToImmich, siteUrl, fetch: f = globalThis.fetch, now = Date.now }) {
  async function alert(kind, subject, lines) {
    const t = now(), open = store.alertGet(kind);
    if (!open) { store.alertOpen(kind, t); return tellAdmin(subject, lines); }
    if (t - open.last_sent_at >= DAY) { store.alertSent(kind, t); return tellAdmin(`Still happening: ${subject}`, lines); }
  }
  async function resolve(kind, subject, lines) {
    if (!store.alertGet(kind)) return;
    store.alertClose(kind);
    return tellAdmin(subject, lines);
  }

  let busy = false;
  async function immichTick() {
    if (busy) return;
    busy = true;
    try {
      for (const p of store.pendingImmich()) {
        const name = p.originalName || 'A photo';
        let assetId;
        try {
          assetId = await sendToImmich(p);
        } catch (e) {
          store.setPhotoImmich(p.id, 'pending', null, 1);
          if (now() - p.createdAt < DAY) continue;
          store.setPhotoImmich(p.id, 'failed', null, 0);
          const where = p.galleryId == null ? 'the About or Contact page' : `the ${store.gallery(p.galleryId)?.title || ''} gallery`;
          await alert(`immich:${p.id}`, 'A website photo is not in Immich', [
            `${name} in ${where} has been on your website for a day but could not be saved to Immich (${e.message}).`,
            'The website itself is fine. Open the Website section of the admin panel and press Retry on that photo.',
          ]);
          continue;
        }
        store.setPhotoImmich(p.id, 'ok', assetId, 1);
        await resolve(`immich:${p.id}`, 'A website photo is in Immich now', [`${name} was saved to Immich.`]);
      }
    } finally { busy = false; }
  }

  let fails = 0, last = null;
  async function siteTick() {
    if (!siteUrl) return;
    let ok = false, why = '';
    try {
      const r = await f(siteUrl, { signal: AbortSignal.timeout(15_000), redirect: 'follow' });
      ok = r.ok; why = `HTTP ${r.status}`;
    } catch (e) { why = e.message; }
    last = { ok, at: now(), why };
    if (ok) { fails = 0; return resolve('site-down', 'Your website is back', [`${siteUrl} is loading again.`]); }
    if (++fails < 2) return;
    return alert('site-down', 'Your website is not loading', [
      `${siteUrl} failed two checks in a row (${why}).`,
      'The gallery app checks every 30 minutes and will email you when it is back.',
    ]);
  }

  return { alert, resolve, immichTick, siteTick, lastCheck: () => last };
}
