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

test('discarding to a snapshot checks its pages against today: clashes fall back, dead links are dropped', () => {
  const s = fresh();
  s.putPages(null, [...migrated(s), news({ slug: 'x' })]);
  const snap = s.snapshot();
  s.discardPages(null);
  assert.equal(s.addGallery(null, 'x').slug, 'x');
  s.discardPages(snap);
  assert.equal(s.getPages(), null, 'a page clashing with a gallery address is not stored');
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
