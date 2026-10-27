import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBlock, validateBlock } from '../blocks/registry.mjs';
import { blockCtx, mk } from './block-helpers.mjs';

test('hero with a photo is the old Contact banner, and becomes the share image and a preload', () => {
  const ctx = blockCtx();
  assert.equal(renderBlock(mk('h1', 'hero', { photoId: 91, heading: 'Contact' }), ctx),
    `<section class="banner" style="background-image:url('/img/ban-full.jpg')"><h1>Contact</h1></section>`);
  assert.equal(ctx.og.id, 91);
  assert.equal(ctx.head, '<link rel="preload" as="image" href="/img/ban-full.jpg">');
});

test('hero without a photo is the old plain Contact title', () => {
  const ctx = blockCtx();
  assert.equal(renderBlock(mk('h2', 'hero', { heading: 'Contact' }), ctx), '<h1 class="page-title">Contact</h1>');
  assert.equal(ctx.og, null);
});

test('hero with a line, a button, a taller size and a shade', () => {
  const html = renderBlock(mk('h3', 'hero', { photoId: 91, heading: 'Hi', subheading: 'There', buttonLabel: 'Go',
    buttonLink: { kind: 'page', pageId: 'about' }, height: 'tall', shade: 30 }), blockCtx());
  assert.equal(html, `<section class="banner hero-tall" style="background-image:url('/img/ban-full.jpg')"><span class="hero-shade" style="opacity:0.3"></span>`
    + '<div class="hero-in"><h1>Hi</h1><p class="hero-sub">There</p><a class="sbtn sbtn-solid bh-fill" href="/about/">Go</a></div></section>');
});

test('image: framed, captioned, linked, with its hover effect; small sizes use the grid copy', () => {
  const ctx = blockCtx();
  assert.equal(renderBlock(mk('i1', 'image', { photoId: 90, alt: 'Me', caption: 'At work', hover: 'caption', link: { kind: 'url', url: 'https://e.com' } }), ctx),
    '<figure class="img-block size-large hv-caption"><span class="frame"><a href="https://e.com"><img src="/img/pfp-full.jpg" width="2048" height="1365" alt="Me" loading="lazy" decoding="async"></a></span>'
    + '<figcaption class="cap">At work</figcaption></figure>');
  assert.match(renderBlock(mk('i2', 'image', { photoId: 90, size: 'small' }), ctx), /src="\/img\/pfp-grid\.jpg" width="800" height="533"/);
  assert.equal(renderBlock(mk('i3', 'image', { photoId: null }), ctx), '');
});

test('image and text is the old About section', () => {
  const ctx = blockCtx();
  assert.equal(renderBlock(mk('a1', 'image-text', { photoId: 90, heading: 'About', text: 'Hello <script>x</script>\n\nSecond' }), ctx),
    '<section class="about"><img class="about-photo" src="/img/pfp-full.jpg" width="2048" height="1365" alt="Example Studio">'
    + '<div class="about-card"><h1>About</h1><p>Hello &lt;script&gt;x&lt;/script&gt;</p><p>Second</p></div></section>');
  assert.equal(ctx.og.id, 90);
  assert.match(renderBlock(mk('a2', 'image-text', { photoId: 90, photoSide: 'right', hover: 'zoom', alt: 'Me' }), ctx),
    /^<section class="about about-right hv-zoom"><img class="about-photo" [^>]*alt="Me">/);
  assert.match(validateBlock({ id: 'a3', type: 'image-text', props: { hover: 'darken' } }, {}).errors[0], /^Image and text, hover:/);
});

test('gallery cards are the old home page cards, for every visible gallery or a chosen few', () => {
  const ctx = blockCtx();
  assert.equal(renderBlock(mk('c1', 'gallery-cards'), ctx),
    '<section class="cards"><a class="card" href="/Autumn-Wedding/"><img src="/img/bbb-grid.jpg" alt="Autumn Wedding" width="800" height="533" fetchpriority="high">'
    + '<span class="card-title">Autumn Wedding</span><span class="card-sub">Click For More!</span></a></section>');
  assert.equal(ctx.og.id, 2);
  assert.equal(renderBlock(mk('c2', 'gallery-cards', { galleryIds: [2] }), blockCtx()), '<section class="cards"></section>', 'a hidden gallery is never shown');
  assert.match(renderBlock(mk('c3', 'gallery-cards', { hover: 'caption', subtitle: '' }), blockCtx()),
    /<section class="cards hv-caption">.*<span class="card-title cap">Autumn Wedding<\/span><\/a>/);
});

test('photo grid is the old gallery page, and shows nothing for a hidden or missing gallery', () => {
  const ctx = blockCtx();
  const html = renderBlock(mk('g1', 'photo-grid', { galleryId: 1 }), ctx);
  assert.equal(html, '<h1 class="page-title">Autumn Wedding</h1><section class="masonry" data-cols="4" data-cols-phone="2">'
    + '<a class="m-item" href="/img/aaa-full.jpg" data-w="2048" data-h="1365"><img src="/img/aaa-grid.jpg" width="800" height="533" alt="Autumn Wedding photo 1" decoding="async"></a>'
    + '<a class="m-item" href="/img/bbb-full.jpg" data-w="2048" data-h="1365"><img src="/img/bbb-grid.jpg" width="800" height="533" alt="Autumn Wedding photo 2" decoding="async"></a></section>');
  assert.equal(ctx.og.id, 2);
  assert.equal(renderBlock(mk('g2', 'photo-grid', { galleryId: 2 }), blockCtx()), '');
  assert.equal(renderBlock(mk('g3', 'photo-grid', { galleryId: 99 }), blockCtx()), '');
  assert.match(renderBlock(mk('g4', 'photo-grid', { galleryId: 1, columns: 3, hover: 'zoom' }), blockCtx()), /<section class="masonry hv-zoom" data-cols="3" /);
});

test('the ninth photo onwards loads lazily', () => {
  const ctx = blockCtx();
  const g = ctx.gallery(1);
  g.photos = Array.from({ length: 10 }, (_, i) => ({ ...g.photos[0], id: 100 + i, fileKey: `k${i}` }));
  const html = renderBlock(mk('g5', 'photo-grid', { galleryId: 1 }), { ...ctx, gallery: () => g });
  assert.equal((html.match(/loading="lazy"/g) || []).length, 2);
});
