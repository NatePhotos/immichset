import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_TYPES, listBlockTypes, validateBlock, validateBlocks, renderBlock } from '../blocks/registry.mjs';
import { STYLE_DEFAULTS, MOTION_DEFAULTS, cleanFields, wrap } from '../blocks/common.mjs';
import { blockCtx, mk } from './block-helpers.mjs';

test('every block module has the same shape', () => {
  for (const t of BLOCK_TYPES.values()) {
    for (const k of ['type', 'label', 'icon', 'sketch', 'defaults', 'fields']) assert.ok(t[k] !== undefined, `${t.type}.${k}`);
    assert.equal(typeof t.validate, 'function'); assert.equal(typeof t.render, 'function');
    assert.match(t.sketch, /^<svg viewBox="0 0 100 60">[\s\S]*<\/svg>$/);
    assert.doesNotMatch(t.sketch, /<path|script|on\w+=/i, `${t.type} sketch is plain shapes`);
    const r = validateBlock({ id: `d-${t.type}`, type: t.type, props: structuredClone(t.defaults) }, {});
    assert.deepEqual(r.errors, [], `${t.type} defaults are valid`);
  }
  assert.deepEqual(listBlockTypes().map(t => t.type), [...BLOCK_TYPES.keys()]);
});

test('a block gets default style and motion, and unknown keys are dropped', () => {
  const { block, errors } = validateBlock({ id: 'h1', type: 'heading', props: { text: 'Hi', extra: 1 } }, {});
  assert.deepEqual(errors, []);
  assert.deepEqual(block.style, STYLE_DEFAULTS);
  assert.deepEqual(block.motion, MOTION_DEFAULTS);
  assert.ok(!('extra' in block.props));
});

test('bad blocks are refused with a reason', () => {
  assert.match(validateBlock({ id: 'x1', type: 'nope' }, {}).errors[0], /unknown block type "nope"/);
  assert.match(validateBlock({ id: 'Bad Id', type: 'heading' }, {}).errors[0], /block id "Bad Id" is not valid/);
  const r = validateBlocks([{ id: 'a1', type: 'heading' }, { id: 'a1', type: 'spacer' }], {});
  assert.equal(r.blocks.length, 1); assert.match(r.errors[0], /used twice/);
  assert.match(validateBlock({ id: 'm1', type: 'heading', motion: { entrance: 'spin' } }, {}).errors[0], /^Heading, entrance: choose one of/);
  assert.match(validateBlock({ id: 'm2', type: 'heading', motion: { duration: 50 } }, {}).errors[0], /from 200 to 3000/);
  assert.match(validateBlock({ id: 's1', type: 'heading', style: { bgColor: 'red' } }, {}).errors[0], /six-digit colour/);
});

test('field kinds: text is trimmed and cut, photos must exist, links must be safe', () => {
  const fields = [{ key: 't', kind: 'text', max: 5 }, { key: 'p', kind: 'photo' }, { key: 'l', kind: 'link' }, { key: 'u', kind: 'url' }];
  const r = cleanFields({ t: '  abcdefgh ', p: 99, l: { kind: 'url', url: 'javascript:x' }, u: 'https://ok.example' }, fields,
    { t: '', p: null, l: { kind: 'url', url: '', pageId: '' }, u: '' }, { photoIds: new Set([1]) });
  assert.deepEqual(r.props, { t: 'abcde', p: null, l: { kind: 'url', url: '', pageId: '' }, u: 'https://ok.example' });
  assert.match(r.errors.l, /https:\/\/, http:\/\/, mailto: or tel:/);
});

test('heading: escaped, at the chosen level and size', () => {
  const b = mk('h1', 'heading', { text: 'A <b>&', level: 3, size: 'large' });
  assert.equal(renderBlock(b, blockCtx()), '<h3 class="hd hd-large">A &lt;b&gt;&amp;</h3>');
  assert.match(validateBlock({ id: 'h2', type: 'heading', props: { level: 7 } }, {}).errors[0], /^Heading, level:/);
});

test('rich text is sanitised when saved and again when built', () => {
  const b = mk('r1', 'rich-text', { html: '<p>Hi <script>x</script><a href="javascript:y">l</a></p>' });
  assert.equal(b.props.html, '<p>Hi <a>l</a></p>');
  b.props.html = '<p onclick="z">tampered</p><script>1</script>';
  assert.equal(renderBlock(b, blockCtx()), '<div class="rich"><p>tampered</p></div>');
});

test('button: links to a page or a safe address; a missing page hides it', () => {
  const ctx = blockCtx();
  assert.equal(renderBlock(mk('b1', 'button', { label: 'Say hi', link: { kind: 'page', pageId: 'contact' } }), ctx),
    '<p class="btn-row"><a class="sbtn sbtn-solid bh-fill" href="/contact/">Say hi</a></p>');
  assert.equal(renderBlock(mk('b2', 'button', { label: 'Mail', link: { kind: 'url', url: 'mailto:a@b.c' }, newTab: true, look: 'outline', hover: 'glow' }), ctx),
    '<p class="btn-row"><a class="sbtn sbtn-outline bh-glow" href="mailto:a@b.c" target="_blank" rel="noopener noreferrer">Mail</a></p>');
  assert.equal(renderBlock(mk('b3', 'button', { link: { kind: 'page', pageId: 'gone' } }), ctx), '');
  assert.match(validateBlock({ id: 'b4', type: 'button', props: { link: { kind: 'url', url: 'javascript:alert(1)' } } }, {}).errors[0], /^Button, link: links must start/);
  assert.match(validateBlock({ id: 'b5', type: 'button', props: { hover: 'none' } }, {}).errors[0], /^Button, hover:/, 'buttons offer fill, lift and glow');
});

test('spacer: a gap, with or without a line', () => {
  assert.equal(renderBlock(mk('s1', 'spacer', { height: 'large', line: true }), blockCtx()), '<div class="spacer sp-large" aria-hidden="true"><hr></div>');
  assert.equal(renderBlock(mk('s2', 'spacer'), blockCtx()), '<div class="spacer sp-medium" aria-hidden="true"></div>');
});

test('the wrapper: none for a plain block, classes and custom properties otherwise, always in the editor', () => {
  const plain = mk('w1', 'heading', { text: 'x' });
  assert.equal(wrap(plain, 'IN', blockCtx()), 'IN');
  assert.equal(wrap(plain, 'IN', blockCtx({ editor: true })), '<div class="blk" data-b="w1">IN</div>');
  const styled = mk('w2', 'heading', {}, { background: 'color', bgColor: '#112233', padding: 'small', width: 'contained', visible: 'phone' },
    { entrance: 'fade', duration: 500, delay: 100, repeat: 'once' });
  assert.equal(wrap(styled, 'IN', blockCtx()),
    '<div class="blk bg-color pad-s w-contained vis-phone m m-fade m-once" data-b="w2" style="--bg:#112233;--m-dur:500ms;--m-delay:100ms">IN</div>');
});

test('hidden blocks are left out, except in the editor where they show faded', () => {
  const b = mk('v1', 'heading', { text: 'x' }, { visible: 'none' });
  assert.equal(renderBlock(b, blockCtx()), '');
  assert.equal(renderBlock(b, blockCtx({ editor: true })), '<div class="blk blk-off" data-b="v1"><h2 class="hd hd-medium">x</h2></div>');
});

test('an empty block shows a note in the editor and nothing on the site', () => {
  const b = mk('e1', 'button', { link: { kind: 'page', pageId: 'gone' } });
  assert.equal(renderBlock(b, blockCtx({ editor: true })), '<div class="blk" data-b="e1"><p class="blk-empty">Button: nothing to show yet</p></div>');
});
