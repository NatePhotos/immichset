import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStore, StaleError, InputError } from '../store.mjs';
import { migratePages, resolvePages } from '../pages.mjs';
import { migrateSite } from '../sitewide.mjs';

const fresh = () => createStore(new DatabaseSync(':memory:'), { now: () => 1000 });
const pagesOf = s => { const st = s.getState(); return resolvePages(st.pages ?? migratePages(st.settings, st.galleries), st.galleries); };
const siteOf = s => { const st = s.getState(); return st.site ?? migrateSite(st.settings); };
const named = (s, name) => ({ ...siteOf(s), name });

test('the site starts unsaved and is saved with the pages, under one revision bump', () => {
  const s = fresh();
  assert.equal(s.getSite(), null);
  assert.equal(s.getState().site, null);
  assert.deepEqual(s.putPages(0, pagesOf(s), named(s, 'Studio')), { pagesRev: 1 });
  assert.equal(s.getSite().name, 'Studio');
  assert.equal(s.rev(), 1);
  assert.throws(() => s.putPages(0, pagesOf(s), named(s, 'Late')), StaleError);
});

test('a save without the site keeps the saved one; a bad site is refused with every reason and nothing is stored', () => {
  const s = fresh();
  s.putPages(null, pagesOf(s), named(s, 'Kept'));
  s.putPages(null, pagesOf(s));
  assert.equal(s.getSite().name, 'Kept');
  const bad = named(s, 'Nope'); bad.theme.page = 'red'; bad.footer.style.padding = 'huge';
  assert.throws(() => s.putPages(null, pagesOf(s), bad), e => e instanceof InputError && e.errors.length === 2 && /Footer, padding/.test(e.message));
  assert.equal(s.getSite().name, 'Kept');
  assert.equal(s.pagesRev(), 2);
});

test('snapshots carry the site; restoring a version from before it existed goes back to the one made from the settings', () => {
  const s = fresh();
  s.putPages(null, pagesOf(s), named(s, 'Published'));
  const snap = s.snapshot();
  assert.equal(JSON.parse(snap).site.name, 'Published');
  s.putPages(null, pagesOf(s), named(s, 'Draft'));
  s.restoreSnapshot(snap);
  assert.equal(s.getSite().name, 'Published');
  const old = JSON.parse(snap); delete old.site;
  s.restoreSnapshot(JSON.stringify(old));
  assert.equal(s.getSite(), null);
  assert.ok(s.getPages(), 'the pages of that version are kept');
});

test('discard goes back to the published site, and refuses one that no longer passes the checks', () => {
  const s = fresh();
  s.putPages(null, pagesOf(s), named(s, 'Live'));
  const snap = s.snapshot();
  s.putPages(null, pagesOf(s), named(s, 'Draft'));
  s.discardPages(snap);
  assert.equal(s.getSite().name, 'Live');
  const broken = JSON.parse(snap); broken.site.header.elements.push({ id: 'hd-logo', type: 'logo' });
  s.putPages(null, pagesOf(s), named(s, 'Draft again'));
  assert.throws(() => s.discardPages(JSON.stringify(broken)), e => e instanceof InputError && /can’t be restored as they are: Header: Logo: the element id "hd-logo" is used twice/.test(e.message));
  assert.equal(s.getSite().name, 'Draft again', 'the draft is left alone');
  s.discardPages(null);
  assert.equal(s.getSite(), null, 'never published: back to the site made from the settings');
});

test('saving the site needs no new ids from the database', () => {
  const s = fresh();
  const before = ['_photoSeq', '_gallerySeq'].map(k => s.meta(k));
  s.putPages(null, pagesOf(s), named(s, 'x'));
  assert.deepEqual(['_photoSeq', '_gallerySeq'].map(k => s.meta(k)), before);
});

test('a stored site that fails the checks is treated as unsaved, and a snapshot with one is restored as unsaved', () => {
  const s = fresh();
  s.setMeta('s:site', JSON.stringify({ name: 5, header: 'x' }));
  assert.equal(s.getSite(), null);
  assert.equal(s.getState().site, null);
  s.setMeta('s:site', '{not json');
  assert.equal(s.getSite(), null);
  const snap = JSON.parse(s.snapshot()); snap.site = { nonsense: true };
  s.restoreSnapshot(JSON.stringify(snap));
  assert.equal(s.getSite(), null);
});

test('discard refuses a published site that is invalid, even when the pages are fine', () => {
  const s = fresh();
  s.putPages(null, pagesOf(s), named(s, 'Live'));
  const snap = JSON.parse(s.snapshot()); snap.site = { nonsense: true };
  const rev = s.pagesRev();
  assert.throws(() => s.discardPages(JSON.stringify(snap)), InputError);
  assert.equal(s.pagesRev(), rev);
});

test('hostile input is refused as an InputError and nothing is stored', () => {
  const s = fresh();
  s.putPages(null, pagesOf(s), named(s, 'Kept'));
  const rev = s.pagesRev();
  const hostile = named(s, { toString: 1 });
  assert.throws(() => s.putPages(null, pagesOf(s), hostile), InputError);
  assert.throws(() => s.putPages(null, pagesOf(s), { url: { toString: 1 } }), InputError);
  assert.equal(s.getSite().name, 'Kept');
  assert.equal(s.pagesRev(), rev);
});

test('a failed site check leaves the pages unchanged too', () => {
  const s = fresh();
  const pages = pagesOf(s);
  const bad = named(s, 'x'); bad.theme.page = 'red';
  const changed = structuredClone(pages); changed[0].title = 'Changed';
  assert.throws(() => s.putPages(null, changed, bad), InputError);
  assert.equal(s.getPages(), null);
});
