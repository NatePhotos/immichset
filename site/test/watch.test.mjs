import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../store.mjs';
import { createWatcher } from '../watch.mjs';

const HOUR = 3600_000;
function setup({ send, site = [] } = {}) {
  let t = 0;
  const now = () => t;
  const store = createStore(new DatabaseSync(':memory:'), { now });
  const mails = [];
  const answers = [...site];
  const w = createWatcher({
    store, now, siteUrl: 'https://example.com',
    tellAdmin: async (subject, lines) => { mails.push(subject); },
    sendToImmich: send || (async () => 'asset-1'),
    fetch: async () => { const a = answers.shift(); if (a instanceof Error) throw a; return new Response('', { status: a }); },
  });
  return { w, store, mails, at: ms => { t = ms; } };
}

test('one email per problem, a reminder after a day, one when fixed', async () => {
  const { w, mails, at } = setup();
  await w.alert('publish', 'Publish failed', ['x']);
  at(2 * HOUR); await w.alert('publish', 'Publish failed', ['x']);
  assert.deepEqual(mails, ['Publish failed']);
  at(25 * HOUR); await w.alert('publish', 'Publish failed', ['x']);
  assert.deepEqual(mails, ['Publish failed', 'Still happening: Publish failed']);
  await w.resolve('publish', 'Publishing works again', ['y']);
  await w.resolve('publish', 'Publishing works again', ['y']);
  assert.deepEqual(mails.at(-1), 'Publishing works again');
  assert.equal(mails.length, 3);
});

test('pending photos are retried and marked ok', async () => {
  const { w, store } = setup();
  const g = store.addGallery(null, 'G');
  const p = store.addPhoto(null, g.id, { fileKey: 'k', width: 1, height: 1, originalName: 'k.jpg' });
  await w.immichTick();
  assert.equal(store.photo(p.id).immichStatus, 'ok');
});

test('a photo still failing after a day is marked failed and emailed once', async () => {
  const { w, store, mails, at } = setup({ send: async () => { throw new Error('down'); } });
  const g = store.addGallery(null, 'Autumn Wedding');
  const p = store.addPhoto(null, g.id, { fileKey: 'k', width: 1, height: 1, originalName: 'k.jpg' });
  await w.immichTick();
  assert.equal(store.photo(p.id).immichStatus, 'pending');
  assert.equal(mails.length, 0);
  at(25 * HOUR); await w.immichTick();
  assert.equal(store.photo(p.id).immichStatus, 'failed');
  assert.equal(mails.length, 1);
  assert.match(mails[0], /Immich/);
  await w.immichTick();
  assert.equal(mails.length, 1);
});

test('site check emails after two failures in a row and again on recovery', async () => {
  const { w, mails } = setup({ site: [500, 200, 500, new Error('timeout'), 200] });
  await w.siteTick(); await w.siteTick();
  assert.equal(mails.length, 0);                    /* one failure, then fine */
  await w.siteTick(); await w.siteTick();
  assert.deepEqual(mails, ['Your website is not loading']);
  await w.siteTick();
  assert.deepEqual(mails, ['Your website is not loading', 'Your website is back']);
});

test('a photo whose alert is open emails once more when it finally saves', async () => {
  let down = true;
  const { w, store, mails, at } = setup({ send: async () => { if (down) throw new Error('down'); return 'asset-9'; } });
  const g = store.addGallery(null, 'G');
  const p = store.addPhoto(null, g.id, { fileKey: 'k', width: 1, height: 1, originalName: 'k.jpg' });
  await w.immichTick();
  at(25 * HOUR); await w.immichTick();
  assert.equal(mails.length, 1);
  down = false;
  store.setPhotoImmich(p.id, 'pending', null, 0);
  await w.immichTick();
  assert.equal(store.photo(p.id).immichStatus, 'ok');
  assert.equal(mails.length, 2);
  assert.match(mails[1], /in Immich now/);
});
