import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStore, StaleError, InputError, DEFAULT_STYLE } from '../store.mjs';

const fresh = () => createStore(new DatabaseSync(':memory:'), { now: () => 1000 });
const photo = (k = 'aa') => ({ fileKey: k, width: 2048, height: 1365, originalName: `${k}.jpg` });

test('starts with defaults and revision 0', () => {
  const s = fresh();
  assert.equal(s.rev(), 0);
  assert.deepEqual(s.getSettings().style, DEFAULT_STYLE);
  assert.deepEqual(s.getState().galleries, []);
});

test('galleries get unique slugs from their titles and keep order', () => {
  const s = fresh();
  const a = s.addGallery(null, 'Camp/Events');
  const b = s.addGallery(null, 'Camp Events');
  const c = s.addGallery(null, 'About');
  assert.equal(a.slug, 'Camp-Events');
  assert.equal(b.slug, 'Camp-Events-2');
  assert.equal(c.slug, 'About-2');            /* "about" is a site page */
  s.reorderGalleries(null, [c.id, a.id, b.id]);
  assert.deepEqual(s.getState().galleries.map(g => g.id), [c.id, a.id, b.id]);
});

test('a stale revision is refused and nothing changes', () => {
  const s = fresh();
  s.addGallery(null, 'One');
  assert.throws(() => s.addGallery(0, 'Two'), StaleError);
  assert.equal(s.getState().galleries.length, 1);
  s.addGallery(s.rev(), 'Two');
  assert.equal(s.getState().galleries.length, 2);
});

test('photos: add, reorder, cover, remove clears references', () => {
  const s = fresh();
  const g = s.addGallery(null, 'Portraits');
  const p1 = s.addPhoto(null, g.id, photo('a1'));
  const p2 = s.addPhoto(null, g.id, photo('a2'));
  const pg = s.addPhoto(null, null, photo('p1'));
  s.reorderPhotos(null, g.id, [p2.id, p1.id]);
  s.updateGallery(null, g.id, { coverPhotoId: p1.id });
  s.patchSettings(null, { about: { photoId: pg.id } });
  let st = s.getState();
  assert.deepEqual(st.galleries[0].photos.map(p => p.id), [p2.id, p1.id]);
  assert.equal(st.galleries[0].coverPhotoId, p1.id);
  assert.equal(st.pagePhotos[0].id, pg.id);
  s.removePhoto(null, p1.id);
  s.removePhoto(null, pg.id);
  st = s.getState();
  assert.equal(st.galleries[0].coverPhotoId, null);
  assert.equal(st.settings.about.photoId, null);
});

test('cover must belong to the gallery', () => {
  const s = fresh();
  const a = s.addGallery(null, 'A'), b = s.addGallery(null, 'B');
  const p = s.addPhoto(null, b.id, photo());
  assert.throws(() => s.updateGallery(null, a.id, { coverPhotoId: p.id }), InputError);
});

test('style is validated field by field', () => {
  const s = fresh();
  s.patchSettings(null, { style: { page: '#ffffff', ink: 'red', headingFont: 'Comic Sans', colsDesktop: 9, gap: 'roomy' } });
  const st = s.getSettings().style;
  assert.equal(st.page, '#ffffff');
  assert.equal(st.ink, DEFAULT_STYLE.ink);
  assert.equal(st.headingFont, DEFAULT_STYLE.headingFont);
  assert.equal(st.colsDesktop, DEFAULT_STYLE.colsDesktop);
  assert.equal(st.gap, 'roomy');
});

test('text is trimmed and an Instagram link must be https', () => {
  const s = fresh();
  s.patchSettings(null, { contact: { email: '  someone@example.com ' }, footer: { instagram: 'javascript:alert(1)' } });
  assert.equal(s.getSettings().contact.email, 'someone@example.com');
  assert.equal(s.getSettings().footer.instagram, '');
});

test('deleting a gallery deletes its photos', () => {
  const s = fresh();
  const g = s.addGallery(null, 'Gone');
  s.addPhoto(null, g.id, photo());
  s.deleteGallery(null, g.id);
  const st = s.getState();
  assert.equal(st.galleries.length, 0);
  assert.equal(st.pagePhotos.length, 0);
});

test('deleting a gallery clears page references to its photos', () => {
  const s = fresh();
  const g = s.addGallery(null, 'G');
  const p = s.addPhoto(null, g.id, photo('gp'));
  s.updateGallery(null, g.id, { coverPhotoId: p.id });
  s.patchSettings(null, { about: { photoId: p.id } });
  s.deleteGallery(null, g.id);
  assert.equal(s.getSettings().about.photoId, null);
});

test('publishes keep a snapshot, restore puts the state back, only 10 kept', () => {
  const s = fresh();
  const g = s.addGallery(null, 'Keep');
  s.addPhoto(null, g.id, photo('k1'));
  const id = s.recordPublish({ status: 'ok', deploymentId: 'd1', rev: s.rev() });
  s.addGallery(null, 'Later');
  s.removePhoto(null, s.getState().galleries[0].photos[0].id);
  s.restoreSnapshot(s.getPublish(id).snapshot);
  const st = s.getState();
  assert.deepEqual(st.galleries.map(x => x.title), ['Keep']);
  assert.equal(st.galleries[0].photos[0].fileKey, 'k1');
  for (let i = 0; i < 12; i++) s.recordPublish({ status: 'ok', deploymentId: `d${i + 2}`, rev: s.rev() });
  assert.equal(s.listPublishes().filter(p => p.status === 'ok').length, 10);
});

test('referenced file keys include kept snapshots', () => {
  const s = fresh();
  const g = s.addGallery(null, 'G');
  const p = s.addPhoto(null, g.id, photo('old'));
  s.recordPublish({ status: 'ok', deploymentId: 'd', rev: s.rev() });
  s.removePhoto(null, p.id);
  s.addPhoto(null, g.id, photo('new'));
  assert.deepEqual([...s.referencedFileKeys()].sort(), ['new', 'old']);
});

test('immich status and pending list', () => {
  const s = fresh();
  const g = s.addGallery(null, 'G');
  const p = s.addPhoto(null, g.id, photo());
  assert.deepEqual(s.pendingImmich().map(x => x.id), [p.id]);
  s.setPhotoImmich(p.id, 'ok', 'asset-1', 1);
  assert.deepEqual(s.pendingImmich(), []);
  assert.equal(s.photo(p.id).immichStatus, 'ok');
});

test('alerts open, send, close', () => {
  const s = fresh();
  assert.equal(s.alertGet('x'), null);
  s.alertOpen('x', 5);
  assert.equal(s.alertGet('x').last_sent_at, 5);
  s.alertSent('x', 9);
  assert.equal(s.alertGet('x').last_sent_at, 9);
  s.alertClose('x');
  assert.equal(s.alertGet('x'), null);
});
