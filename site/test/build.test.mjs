import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, esc } from '../build.mjs';
import { DEFAULTS } from '../store.mjs';

const ph = (id, key, galleryId) => ({ id, galleryId, position: id, fileKey: key, width: 2048, height: 1365, originalName: '', immichStatus: 'ok', createdAt: 0 });
function state(over = {}) {
  const settings = structuredClone(DEFAULTS);
  settings.siteName = 'Example Studio';
  settings.about = { heading: 'About', text: 'Hello <script>x</script>\n\nSecond', photoId: 90 };
  settings.contact = { heading: 'Contact us', bannerPhotoId: 91, email: 'someone@example.com', phone: '555 0100' };
  settings.footer = { copyright: '© Example', instagram: 'https://www.instagram.com/example' };
  return {
    rev: 3, settings,
    galleries: [
      { id: 1, slug: 'Autumn-Wedding', title: 'Autumn Wedding', showTitle: true, hidden: false, position: 0, coverPhotoId: 2, immichAlbumId: null,
        photos: [ph(1, 'aaa', 1), ph(2, 'bbb', 1)] },
      { id: 2, slug: 'Secret', title: 'Secret', showTitle: true, hidden: true, position: 1, coverPhotoId: null, immichAlbumId: null,
        photos: [ph(3, 'ccc', 2)] },
      { id: 3, slug: 'Empty', title: 'Empty', showTitle: true, hidden: false, position: 2, coverPhotoId: null, immichAlbumId: null, photos: [] },
    ],
    pagePhotos: [ph(90, 'pfp', null), ph(91, 'ban', null)],
    ...over,
  };
}

test('builds every page of the site', () => {
  const { files } = build(state());
  for (const p of ['index.html', 'about/index.html', 'contact/index.html', 'Autumn-Wedding/index.html',
                   '404.html', 'style.css', 'site.js', '_headers']) assert.ok(files.has(p), p);
});

test('hidden and empty galleries are left out everywhere', () => {
  const { files } = build(state());
  assert.ok(!files.has('Secret/index.html'));
  assert.ok(!files.has('Empty/index.html'));
  assert.ok(!files.get('index.html').includes('Secret'));
});

test('home card uses the cover photo', () => {
  const { files } = build(state());
  assert.match(files.get('index.html'), /class="card" href="\/Autumn-Wedding\/"><img src="\/img\/bbb-grid\.jpg"/);
});

test('gallery lists photos in order with both sizes, and records them as images', () => {
  const { files, images } = build(state());
  const html = files.get('Autumn-Wedding/index.html');
  assert.ok(html.indexOf('aaa-grid') < html.indexOf('bbb-grid'));
  assert.match(html, /href="\/img\/aaa-full\.jpg"/);
  assert.match(html, /data-cols="4" data-cols-phone="2"/);
  for (const k of ['aaa', 'bbb', 'pfp', 'ban']) assert.ok(images.has(`img/${k}-full.jpg`), k);
  assert.ok(!images.has('img/ccc-grid.jpg'));
});

test('user text is escaped', () => {
  const { files } = build(state());
  const about = files.get('about/index.html');
  assert.ok(!about.includes('<script>x'));
  assert.ok(about.includes('Hello &lt;script&gt;x&lt;/script&gt;'));
  assert.ok(about.includes('<p>Second</p>'));
  assert.equal(esc(`"'<>&`), '&quot;&#39;&lt;&gt;&amp;');
});

test('preview base prefixes every link and asset', () => {
  const { files } = build(state(), { base: '/admin/site-preview/' });
  const home = files.get('index.html');
  assert.ok(home.includes('href="/admin/site-preview/about/"'));
  assert.ok(home.includes('href="/admin/site-preview/style.css"'));
  assert.ok(home.includes('src="/admin/site-preview/img/bbb-grid.jpg"'));
  assert.ok(!/(href|src)="\/(?!admin\/site-preview\/)[^"/]/.test(home.replace(/https:\/\/[^"]+/g, '')));
});

test('style settings become CSS variables and the font link', () => {
  const s = state();
  s.settings.style = { ...s.settings.style, page: '#000000', headingFont: 'Lora', gap: 'roomy', cardShape: 'square', textSize: 'larger' };
  const { files } = build(s);
  const css = files.get('style.css');
  assert.ok(css.startsWith(':root{--page:#000000;'));
  assert.ok(css.includes("--font-head:'Lora'"));
  assert.ok(css.includes('--gap:2rem') && css.includes('--card-ratio:1 / 1') && css.includes('--scale:1.12'));
  assert.ok(files.get('index.html').includes('family=Lora:wght@400;500'));
});

test('no logo shows the site name; a logo is linked and listed', () => {
  assert.ok(build(state()).files.get('index.html').includes('<span class="logo-text">Example Studio</span>'));
  const s = state(); s.settings.style = { ...s.settings.style, logo: 'logo.png' };
  const out = build(s);
  assert.ok(out.files.get('index.html').includes('<img src="/logo.png"'));
  assert.equal(out.images.get('logo.png'), 'logo.png');
});

test('canonical links only when a site address is known', () => {
  assert.ok(!build(state()).files.get('index.html').includes('rel="canonical"'));
  assert.ok(build(state(), { siteUrl: 'https://example.com' }).files.get('about/index.html')
    .includes('<link rel="canonical" href="https://example.com/about/">'));
});

test('contact shows only the details that are set', () => {
  const s = state(); s.settings.contact.phone = '';
  const html = build(s).files.get('contact/index.html');
  assert.ok(html.includes('mailto:someone@example.com'));
  assert.ok(!html.includes('Phone number'));
});
