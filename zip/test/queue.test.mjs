import test from 'node:test';
import assert from 'node:assert/strict';
import { DownloadQueue } from '../queue.mjs';

const clock = () => { const c = { t: 1000 }; c.now = () => c.t; return c; };

test('free slots are granted in the order people asked', () => {
  const c = clock(), q = new DownloadQueue({ maxActive: 1, now: c.now });
  const a = q.request('a', { n: 1 }), b = q.request('b', { n: 2 }), d = q.request('c', { n: 3 });
  assert.equal(q.status(a.id, 'a').state, 'reserved');
  assert.equal(q.status(b.id, 'b').position, 1);
  assert.equal(q.status(d.id, 'c').position, 2);
  const s = q.claim(a.id, 'a');
  assert.ok(s);
  q.release(s);
  assert.equal(q.status(b.id, 'b').state, 'reserved');
  assert.equal(q.status(d.id, 'c').position, 1);
});

test('a status check with the wrong key reveals nothing', () => {
  const q = new DownloadQueue({ maxActive: 1 });
  const a = q.request('a', {});
  assert.equal(q.status(a.id, 'someone-else'), null);
  assert.equal(q.claim(a.id, 'someone-else'), null);
});

test('one client holds one slot; their second ticket waits even with room', () => {
  const q = new DownloadQueue({ maxActive: 3 });
  const a1 = q.request('a', {});
  const s = q.claim(a1.id, 'a');
  const a2 = q.request('a', {});
  assert.equal(q.status(a2.id, 'a').state, 'waiting');
  const b = q.request('b', {});
  assert.equal(q.status(b.id, 'b').state, 'reserved');   /* a's waiting ticket does not block b */
  q.release(s);
  assert.equal(q.status(a2.id, 'a').state, 'reserved');
});

test('asking twice keeps your place and updates what you want', () => {
  const q = new DownloadQueue({ maxActive: 1 });
  q.claim(q.request('x', {}).id, 'x');
  const b = q.request('b', { v: 1 }), c = q.request('c', {});
  const b2 = q.request('b', { v: 2 });
  assert.equal(b2.id, b.id);
  assert.equal(q.status(b.id, 'b').position, 1);
  assert.equal(q.status(b.id, 'b').spec.v, 2);
  assert.equal(q.status(c.id, 'c').position, 2);
});

test('a ticket that is not ready is skipped, not blocking', () => {
  const ready = new Set(['b']);
  const q = new DownloadQueue({ maxActive: 1, isReady: s => ready.has(s.k) });
  const a = q.request('a', { k: 'a' }), b = q.request('b', { k: 'b' });
  assert.equal(q.status(a.id, 'a').state, 'waiting');
  assert.equal(q.status(b.id, 'b').state, 'reserved');
  ready.add('a');
  q.release(q.claim(b.id, 'b'));
  assert.equal(q.status(a.id, 'a').state, 'reserved');
});

test('people who stop checking drop out; unclaimed reservations lapse', () => {
  const c = clock(), q = new DownloadQueue({ maxActive: 1, now: c.now, waitTtlMs: 180_000, reserveTtlMs: 120_000 });
  const a = q.request('a', {}), b = q.request('b', {});
  c.t += 119_000; assert.equal(q.status(b.id, 'b').position, 1);   /* b is still polling */
  c.t += 2_000;                                                      /* a never claimed */
  assert.equal(q.status(a.id, 'a'), null);
  assert.equal(q.status(b.id, 'b').state, 'reserved');
  c.t += 181_000;
  assert.equal(q.status(b.id, 'b'), null);
});

test('a download that stops moving loses its slot', () => {
  const c = clock(), q = new DownloadQueue({ maxActive: 1, now: c.now, stallMs: 120_000 });
  const s = q.claim(q.request('a', {}).id, 'a');
  const b = q.request('b', {});
  c.t += 60_000; q.progress(s); c.t += 100_000;
  assert.equal(q.status(b.id, 'b').state, 'waiting');
  c.t += 30_000;
  assert.equal(q.status(b.id, 'b').state, 'reserved');
  assert.equal(s.expired, true);
});

test('claimDirect only jumps in when nobody is waiting; resume skips the line', () => {
  const q = new DownloadQueue({ maxActive: 1 });
  const s = q.claimDirect('a', {});
  assert.ok(s);
  assert.equal(q.claimDirect('b', {}), null);
  assert.equal(q.resume('a', {}), null);          /* already running one */
  const r = q.resume('c', {});
  assert.ok(r);
  assert.equal(q.snapshot().active, 2);
  q.release(s); q.release(r);
  q.request('w', {});                              /* someone waiting, slots free -> they take it */
  assert.equal(q.claimDirect('z', {}), null);
});

test('cancel leaves the line', () => {
  const q = new DownloadQueue({ maxActive: 1 });
  q.claim(q.request('x', {}).id, 'x');
  const b = q.request('b', {}), c = q.request('c', {});
  assert.ok(q.cancel(b.id, 'b'));
  assert.equal(q.status(c.id, 'c').position, 1);
});
