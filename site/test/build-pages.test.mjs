import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../build.mjs';
import { migratePages } from '../pages.mjs';
import { state } from './fixtures.mjs';
import { mk } from './block-helpers.mjs';

const asset = n => readFileSync(new URL(`../assets/${n}`, import.meta.url), 'utf8');
const saved = () => { const s = state(); s.pages = migratePages(s.settings, s.galleries); return s; };

test('saved pages made from the old settings build the same pages; only the stylesheet and script grow', () => {
  const old = build(state()), now = build(saved());
  assert.deepEqual([...now.files.keys()].sort(), [...old.files.keys()].sort());
  for (const [k, v] of old.files) {
    if (k === 'style.css') assert.equal(now.files.get(k), v + asset('blocks.css'));
    else if (k === 'site.js') assert.equal(now.files.get(k), v + asset('motion.js'));
    else assert.equal(now.files.get(k), v, k);
  }
  assert.deepEqual([...now.images].sort(), [...old.images].sort());
});

test('a site that never saved pages gets no block CSS or motion script', () => {
  const { files } = build(state());
  assert.equal(files.get('site.js'), asset('site.js'));
  assert.ok(!files.get('style.css').includes('.blk-bg'));
});

test('the menu lists the pages marked for it, in page order; a new page gets its own address and SEO fields', () => {
  const s = saved();
  s.pages.splice(1, 0, { id: 'pwork', title: 'Work & Play', slug: 'work', inMenu: true, seoTitle: 'Our work', seoDescription: 'What we made',
    galleryId: null, blocks: [mk('bw1', 'heading', { text: 'Hello <there>' })] });
  s.pages.find(p => p.id === 'contact').inMenu = false;
  const { files } = build(s);
  assert.match(files.get('index.html'), /<nav><a href="\/">Home<\/a><a href="\/work\/">Work &amp; Play<\/a><a href="\/about\/">About<\/a><\/nav>/);
  const work = files.get('work/index.html');
  assert.match(work, /<title>Our work - Example Studio<\/title>/);
  assert.match(work, /<meta name="description" content="What we made">/);
  assert.match(work, /<main>\n<h2 class="hd hd-medium">Hello &lt;there&gt;<\/h2>\n<\/main>/);
  assert.ok(files.has('contact/index.html'), 'off the menu is not off the site');
});

test('motion and style become classes and custom properties on a wrapper', () => {
  const s = saved();
  s.pages[0].blocks.push(mk('bm1', 'heading', { text: 'Moving' }, { padding: 'large', align: 'center' },
    { entrance: 'slide-up', duration: 900, delay: 150, repeat: 'every' }));
  assert.ok(build(s).files.get('index.html').includes(
    '<div class="blk pad-l al-center m m-slide-up" data-b="bm1" style="--m-dur:900ms;--m-delay:150ms"><h2 class="hd hd-medium">Moving</h2></div>'));
});

test('a parallax background photo is its own layer, and is published', () => {
  const s = saved();
  s.pages[0].blocks.push(mk('bp1', 'spacer', {}, { background: 'photo', bgPhotoId: 90 }, { background: 'parallax' }));
  const { files, images } = build(s);
  assert.ok(files.get('index.html').includes(`<div class="blk bg-photo px" data-b="bp1"><div class="blk-bg" style="background-image:url('/img/pfp-full.jpg')"></div><div class="spacer sp-medium" aria-hidden="true"></div></div>`));
  assert.ok(images.has('img/pfp-full.jpg'));
});

test('hidden blocks are left out of the site', () => {
  const s = saved();
  s.pages[0].blocks.push(mk('bh1', 'heading', { text: 'Secret words' }, { visible: 'none' }));
  assert.ok(!build(s).files.get('index.html').includes('Secret words'));
});

test('the editor build is self-contained, marks every block, and shows hidden ones', () => {
  const s = saved();
  s.pages[0].blocks.push(mk('bh2', 'heading', { text: 'Secret words' }, { visible: 'none' }));
  const html = build(s, { base: '/admin/site-preview/', editor: true }).files.get('index.html');
  assert.ok(!html.includes('<link rel="stylesheet"'));
  assert.ok(!html.includes('<script src='));
  assert.ok(html.includes('data-b="home-cards"'));
  assert.ok(html.includes('<div class="blk blk-off" data-b="bh2">'));
  assert.ok(html.includes('wb-select'), 'the editor bridge is inlined');
  assert.ok(html.includes('.blk-bg'), 'block CSS is inlined even before the first save');
  assert.equal((html.match(/<script>/g) || []).length, 2);
  assert.equal((html.match(/<\/script>/g) || []).length, 2, 'nothing inlined closes a script early');
  assert.ok(build(s, { editor: true }).files.has('Secret/index.html'), 'a hidden gallery’s page can still be edited');
  assert.ok(!build(s).files.has('Secret/index.html'));
});

test('an unsaved site in the editor uses the pages made from its settings', () => {
  const html = build(state(), { base: '/admin/site-preview/', editor: true }).files.get('about/index.html');
  assert.match(html, /<div class="blk" data-b="about-main"><section class="about">/);
});

test('the editor shows hidden blocks faded and selectable; the published site is unchanged', () => {
  const s = saved();
  s.pages[0].blocks.push(mk('bh3', 'heading', { text: 'Secret words' }, { visible: 'none' }));
  const html = build(s, { base: '/admin/site-preview/', editor: true }).files.get('index.html');
  assert.ok(html.includes('.blk-off{display:revert;opacity:.35}'));
  assert.ok(html.indexOf('.blk-off{display:none') < html.indexOf('.blk-off{display:revert'), 'the editor rule comes after the block rule');
  const pub = build(s);
  assert.ok(!pub.files.get('style.css').includes('display:revert'));
  assert.ok(pub.files.get('style.css').includes('.blk-off { display: none; }'));
});
