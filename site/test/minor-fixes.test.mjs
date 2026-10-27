import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { safeUrl } from '../sanitize.mjs';
import { validateBlock, renderBlock } from '../blocks/registry.mjs';
import { createStore } from '../store.mjs';
import { blockCtx, mk } from './block-helpers.mjs';

test('tel: links need at least one digit', () => {
  for (const bad of ['tel:-', 'tel:()', 'tel:+', 'tel:+()-', 'tel:.']) assert.equal(safeUrl(bad), '', bad);
  for (const good of ['tel:5', 'tel:+1(555)010-0100', 'tel:(0)']) assert.equal(safeUrl(good), good);
});

test('number fields accept only real numbers or numeric text; anything else is an error with the default', () => {
  const motion = delay => validateBlock({ id: 'm1', type: 'heading', props: { text: 'x' }, motion: { entrance: 'fade', delay } }, {});
  for (const bad of [null, '', '  ', false, true, [], [5], {}, NaN, Infinity, 1.5]) {
    const r = motion(bad);
    assert.ok(r.errors.some(e => /delay/i.test(e)), `${JSON.stringify(bad)} should be an error`);
    assert.equal(r.block.motion.delay, 0);
  }
  for (const [v, want] of [[300, 300], ['300', 300], [' 300 ', 300], [0, 0]]) {
    const r = motion(v); assert.deepEqual(r.errors, []); assert.equal(r.block.motion.delay, want);
  }
});

test('contact: an email that could carry mailto headers is refused and not kept', () => {
  for (const bad of ['a@b?cc=x%40evil.com&body=hi', 'a@b%0a.com', 'a@b&c.com', 'a b@c.com', 'a@b.com,c@d.com', 'a@b.com>', '"a"@b.com', 'a@b.com;x', 'not an address']) {
    const r = validateBlock({ id: 'c1', type: 'contact', props: { email: bad } }, {});
    assert.match(r.errors[0], /^Contact details, email:.*email address/, bad);
    assert.equal(r.block.props.email, '', bad);
    assert.doesNotMatch(renderBlock(r.block, blockCtx()), /mailto:/, bad);
  }
  const ok = validateBlock({ id: 'c2', type: 'contact', props: { email: 'someone@example.com' } }, {});
  assert.deepEqual(ok.errors, []);
  assert.match(renderBlock(ok.block, blockCtx()), /href="mailto:someone@example\.com"/);
  assert.match(renderBlock(mk('c3', 'contact', { phone: '(555) 010-0100' }), blockCtx()), /href="tel:5550100100"/);
});

test('block custom CSS cannot restyle the blocks after it', () => {
  const r = validateBlock({ id: 'x3', type: 'custom-html', props: { css: ':root ~ *{display:none}' } }, {});
  assert.match(r.errors[0], /^Custom HTML, css: line 1, column \d+/);
});

test('id marks first set up from published snapshots that mention higher ids', () => {
  const db = new DatabaseSync(':memory:');
  const s = createStore(db, { now: () => 1000 });
  s.addPhoto(null, null, { fileKey: 'a', width: 2, height: 2, originalName: 'a.jpg' });
  s.addGallery(null, 'One');
  db.exec("DELETE FROM site_settings WHERE key IN ('_photoSeq','_gallerySeq')");
  const ins = db.prepare('INSERT INTO site_publishes (created_at, deployment_id, rev, status, error, snapshot) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run(1, 'd1', 1, 'ok', null, 'not json');
  ins.run(2, 'd2', 2, 'ok', null, 'null');
  ins.run(3, 'd3', 3, 'ok', null, JSON.stringify({ photos: [{ id: 9 }, { id: 4 }], galleries: [{ id: 7 }], pages: [] }));
  assert.equal(s.addPhoto(null, null, { fileKey: 'b', width: 2, height: 2, originalName: 'b.jpg' }).id, 10);
  assert.equal(s.addGallery(null, 'Two').id, 8);
});
