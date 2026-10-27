import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStore, StaleError, InputError } from '../store.mjs';
import { migratePages, resolvePages } from '../pages.mjs';

const fresh = () => createStore(new DatabaseSync(':memory:'), { now: () => 1000 });
const photo = (k = 'aa') => ({ fileKey: k, width: 2048, height: 1365, originalName: `${k}.jpg` });
const migrated = s => { const st = s.getState(); return resolvePages(migratePages(st.settings, st.galleries), st.galleries); };
const news = (over = {}) => ({ id: 'pnews', title: 'News', slug: 'news', inMenu: true, seoTitle: '', seoDescription: '', galleryId: null, blocks: [], ...over });

test('pages start unsaved; saving bumps the site revision and the pages revision', () => {
  const s = fresh();
  assert.equal(s.getPages(), null);
  assert.equal(s.getState().pages, null);
  assert.equal(s.pagesRev(), 0);
  assert.deepEqual(s.putPages(0, [...migrated(s), news()]), { pagesRev: 1 });
  assert.equal(s.rev(), 1);
  assert.deepEqual(s.getPages().map(p => p.id), ['home', 'about', 'contact', 'pnews']);
});

test('a save made from an older copy is refused; photo uploads do not make the pages stale', () => {
  const s = fresh();
  s.putPages(null, migrated(s));
  s.addPhoto(null, null, photo('p1'));
  assert.equal(s.pagesRev(), 1);
  s.putPages(1, migrated(s));
  assert.throws(() => s.putPages(1, migrated(s)), StaleError);
});

test('bad pages are refused with every reason, and nothing is stored', () => {
  const s = fresh();
  const bad = [...migrated(s), news({ slug: 'img' }), news({ id: 'pnews2', slug: 'about' })];
  assert.throws(() => s.putPages(null, bad), e => e instanceof InputError && e.errors.length === 2 && /\/img\//.test(e.message));
  assert.equal(s.getPages(), null);
  assert.equal(s.rev(), 0);
});

test('photos used by blocks are checked, kept and never pruned', () => {
  const s = fresh();
  const p = s.addPhoto(null, null, photo('blk'));
  s.putPages(null, [...migrated(s), news({ blocks: [
    { id: 'bimg', type: 'image', props: { photoId: p.id } }, { id: 'bgone', type: 'image', props: { photoId: 999 } }] })]);
  const blocks = s.getPages()[3].blocks;
  assert.equal(blocks[0].props.photoId, p.id);
  assert.equal(blocks[1].props.photoId, null);
  assert.ok(s.referencedFileKeys().has('blk'));
});

test('snapshots carry the pages; a version from before pages existed restores to the old fixed pages', () => {
  const s = fresh();
  const before = JSON.parse(s.snapshot());
  delete before.pages;                                   /* what every publish made before this change looks like */
  s.putPages(null, [...migrated(s), news()]);
  const id = s.recordPublish({ status: 'ok', deploymentId: 'd1', rev: s.rev() });
  assert.equal(JSON.parse(s.getPublish(id).snapshot).pages.length, 4);
  const r0 = s.pagesRev();
  s.restoreSnapshot(JSON.stringify(before));
  assert.equal(s.getPages(), null);
  assert.equal(s.pagesRev(), r0 + 1, 'an open editor learns its draft is stale');
  s.restoreSnapshot(s.getPublish(id).snapshot);
  assert.deepEqual(s.getPages().map(p => p.id), ['home', 'about', 'contact', 'pnews']);
});

test('new galleries avoid the addresses pages use', () => {
  const s = fresh();
  s.putPages(null, [...migrated(s), news({ slug: 'weddings' })]);
  assert.equal(s.addGallery(null, 'Weddings').slug, 'Weddings-2');
  assert.equal(s.addGallery(null, 'About').slug, 'About-2');
});

test('discarding puts back the pages of a snapshot, or the old fixed pages when there is none', () => {
  const s = fresh();
  s.putPages(null, [...migrated(s), news()]);
  const snap = s.snapshot();
  s.putPages(null, migrated(s));
  assert.deepEqual(s.discardPages(snap), { pagesRev: 3 });
  assert.equal(s.getPages().length, 4);
  s.discardPages(null);
  assert.equal(s.getPages(), null);
});

test('discarding to a snapshot whose pages clash with today is refused and leaves the draft alone', () => {
  const s = fresh();
  s.putPages(null, [...migrated(s), news({ slug: 'x' })]);
  const snap = s.snapshot();
  s.putPages(null, migrated(s));
  assert.equal(s.addGallery(null, 'x').slug, 'x');
  const before = JSON.stringify(s.getPages()), rev = s.pagesRev();
  assert.throws(() => s.discardPages(snap), e => e instanceof InputError
    && /The published pages can't be restored as they are: .*Fix the clash and try again\./.test(e.message) && e.errors.length >= 1);
  assert.equal(JSON.stringify(s.getPages()), before, 'the draft is untouched');
  assert.equal(s.pagesRev(), rev);
});

test('discarding drops pages of deleted galleries and photos that no longer exist', () => {
  const s = fresh();
  const g = s.addGallery(null, 'Trips');
  const p = s.addPhoto(null, null, photo('gone'));
  s.putPages(null, [...migrated(s), news({ blocks: [{ id: 'bimg', type: 'image', props: { photoId: p.id } }] })]);
  assert.ok(s.getPages().some(x => x.galleryId === g.id), 'the gallery has its page');
  const snap = s.snapshot();
  s.deleteGallery(null, g.id);
  s.removePhoto(null, p.id);
  s.discardPages(snap);
  const pages = s.getPages();
  assert.ok(!pages.some(x => x.galleryId === g.id));
  assert.equal(pages.find(x => x.id === 'pnews').blocks[0].props.photoId, null);
});

test('photo and gallery ids are never reused after a delete', () => {
  const s = fresh();
  const g1 = s.addGallery(null, 'One'), g2 = s.addGallery(null, 'Two');
  const p1 = s.addPhoto(null, null, photo('a')), p2 = s.addPhoto(null, null, photo('b'));
  s.removePhoto(null, p2.id); s.deleteGallery(null, g2.id);
  assert.equal(s.addPhoto(null, null, photo('c')).id, p2.id + 1);
  assert.equal(s.addGallery(null, 'Three').id, g2.id + 1);
  assert.ok(p1.id < p2.id && g1.id < g2.id);
});

test('a fresh store starts ids at 1', () => {
  const s = fresh();
  assert.equal(s.addGallery(null, 'First').id, 1);
  assert.equal(s.addPhoto(null, null, photo('a')).id, 1);
});

test('an existing database whose newest rows are deleted still does not reuse their ids', () => {
  const db = new DatabaseSync(':memory:');
  const s = createStore(db, { now: () => 1000 });
  s.addPhoto(null, null, photo('a')); const p = s.addPhoto(null, null, photo('b'));
  db.exec("DELETE FROM site_settings WHERE key IN ('_photoSeq','_gallerySeq')"); /* as before the marks existed */
  s.removePhoto(null, p.id);
  assert.equal(s.addPhoto(null, null, photo('c')).id, p.id + 1);
});

test('restoring an older version never lowers the id marks', () => {
  const s = fresh();
  s.addPhoto(null, null, photo('a'));
  const snap = s.snapshot();
  const later = s.addPhoto(null, null, photo('b'));
  s.removePhoto(null, later.id);
  s.restoreSnapshot(snap);
  assert.equal(s.addPhoto(null, null, photo('c')).id, later.id + 1);
});
