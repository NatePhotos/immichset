import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBlock, validateBlock, validateBlocks, countBlocks, BLOCK_TYPES } from '../blocks/registry.mjs';
import { embedSrc } from '../blocks/embed.mjs';
import { blockCtx, mk } from './block-helpers.mjs';

const h = (id, t) => ({ id, type: 'heading', props: { text: t } });

test('columns hold blocks, checked like any others, and show only as many as chosen', () => {
  const b = mk('c1', 'columns', { count: 2, columns: [[h('k1', 'Left')], [h('k2', 'Right')], [h('k3', 'Kept for later')]] });
  assert.equal(countBlocks([b]), 4);
  assert.equal(renderBlock(b, blockCtx()),
    '<div class="cols cols-2 gap-normal"><div class="col"><h2 class="hd hd-medium">Left</h2></div><div class="col"><h2 class="hd hd-medium">Right</h2></div></div>');
  assert.match(renderBlock(b, blockCtx({ editor: true })), /<div class="col"><div class="blk" data-b="k1">/, 'blocks in columns are selectable');
});

test('columns refuse columns and photo grids inside, and share one set of block ids with the page', () => {
  const r = validateBlocks([h('d1', 'x'), { id: 'c2', type: 'columns', props: { columns: [
    [{ id: 'c3', type: 'columns' }, { id: 'g1', type: 'photo-grid' }, h('d1', 'dup')], [], []] } }], {});
  assert.equal(r.errors.length, 3);
  assert.match(r.errors.join('\n'), /Columns cannot go inside columns/);
  assert.match(r.errors.join('\n'), /Photo grid cannot go inside columns/);
  assert.match(r.errors.join('\n'), /"d1" is used twice/);
});

test('contact details are the old Contact section', () => {
  assert.equal(renderBlock(mk('t1', 'contact', { heading: 'Contact us', email: 'someone@example.com', phone: '555 0100' }), blockCtx()),
    '<section class="contact"><h2>Contact us</h2><div class="label">Email</div><a href="mailto:someone@example.com">someone@example.com</a>'
    + '<div class="label">Phone number</div><a href="tel:5550100">555 0100</a></section>');
  assert.equal(renderBlock(mk('t2', 'contact', { email: '' }), blockCtx()), '<section class="contact"><h2>Contact us</h2></section>');
  assert.match(validateBlock({ id: 't3', type: 'contact', props: { email: 'not an address' } }, {}).errors[0], /^Contact details, email:/);
});

test('embed: YouTube and Vimeo links become privacy-friendly players; a place becomes a map', () => {
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=3', 'https://youtube.com/shorts/dQw4w9WgXcQ'])
    assert.equal(embedSrc({ kind: 'video', url: u }), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', u);
  assert.equal(embedSrc({ kind: 'video', url: 'https://vimeo.com/123456' }), 'https://player.vimeo.com/video/123456');
  assert.equal(embedSrc({ kind: 'video', url: 'https://evil.example/watch?v=dQw4w9WgXcQ' }), '');
  assert.equal(embedSrc({ kind: 'map', place: 'Town Hall, Leeds & Co' }), 'https://maps.google.com/maps?q=Town%20Hall%2C%20Leeds%20%26%20Co&output=embed');
  assert.equal(renderBlock(mk('e1', 'embed', { url: 'https://vimeo.com/123456', title: 'Film' }), blockCtx()),
    '<div class="embed r-16x9"><iframe src="https://player.vimeo.com/video/123456" title="Film" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>');
  assert.match(validateBlock({ id: 'e2', type: 'embed', props: { url: 'https://example.com/x' } }, {}).errors[0], /^Video or map, url: paste a YouTube or Vimeo link/);
  assert.equal(renderBlock(mk('e3', 'embed'), blockCtx()), '');
});

test('custom HTML is sanitised, and its CSS only reaches inside the block', () => {
  const b = mk('x1', 'custom-html', { html: '<p onclick="a()">Hi</p><script>alert(1)</script>', css: 'p{color:red}' });
  assert.equal(b.props.html, '<p>Hi</p>');
  assert.equal(renderBlock(b, blockCtx()), '<style>#b-x1 p{color:red}</style><div class="custom-html" id="b-x1"><p>Hi</p></div>');
  assert.match(validateBlock({ id: 'x2', type: 'custom-html', props: { css: 'p{background:url(https://x)}' } }, {}).errors[0], /^Custom HTML, css: line 1, column/);
  b.props.css = 'p{background:url(https://x)}';   /* tampered after saving: nothing is written */
  assert.equal(renderBlock(b, blockCtx()), '<div class="custom-html" id="b-x1"><p>Hi</p></div>');
});

test('the full set of block types, in picker order', () => {
  assert.deepEqual([...BLOCK_TYPES.keys()], ['hero', 'heading', 'rich-text', 'image', 'image-text', 'gallery-cards', 'photo-grid',
    'button', 'spacer', 'columns', 'contact', 'embed', 'custom-html']);
});
