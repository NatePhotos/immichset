import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHeader, renderFooter, renderElement, cleanBand, IG, UP, ELEMENT_MOTION_DEFAULTS, HEADER_STYLE_DEFAULTS, FOOTER_STYLE_DEFAULTS } from '../bands.mjs';
import { WORDING_DEFAULTS } from '../wording.mjs';

const ctx = (over = {}) => ({
  base: '/', editor: false, siteName: 'Example & Co', logoHtml: '<span class="logo-text">Example &amp; Co</span>', wording: { ...WORDING_DEFAULTS },
  menuPages: [{ id: 'home', title: 'Home', href: '/' }, { id: 'about', title: 'About <us>', href: '/about/' }],
  pageHref: id => ({ home: '/', about: '/about/', contact: '/contact/' })[id] ?? null,
  siteHref: p => (p.startsWith('/') ? '/' + p.slice(1) : p),
  ...over,
});
const el = (id, type, props = {}, more = {}) => ({ id, type, props, motion: { ...ELEMENT_MOTION_DEFAULTS }, visible: 'all', ...more });
const band = (which, elements, style = {}) => cleanBand({ style, elements }, which).band;

test('the old header and footer come out exactly as build.mjs wrote them', () => {
  const h = band('header', [el('hd-logo', 'logo'), el('hd-menu', 'menu', { phone: 'row' })]);
  assert.equal(renderHeader(h, ctx()), '<header class="top">\n  <a class="logo" href="/"><span class="logo-text">Example &amp; Co</span></a>\n'
    + '  <nav><a href="/">Home</a><a href="/about/">About &lt;us&gt;</a></nav>\n</header>');
  const f = band('footer', [el('ft-text', 'text', { text: '© Example' }), el('ft-social', 'social', { network: 'instagram', url: 'https://www.instagram.com/example' })]);
  assert.equal(renderFooter(f, ctx()), '<footer class="foot">\n  <span>© Example</span>\n'
    + `  <a class="ig" href="https://www.instagram.com/example" aria-label="Instagram" target="_blank" rel="noopener">${IG}</a>\n`
    + `  <a class="totop" href="#" aria-label="Back to top">${UP}</a>\n</footer>`);
  const empty = band('footer', [el('ft-text', 'text', { text: '' }), el('ft-social', 'social', { url: '' })]);
  assert.equal(renderFooter(empty, ctx()), `<footer class="foot">\n  <span></span>\n  <span></span>\n  <a class="totop" href="#" aria-label="Back to top">${UP}</a>\n</footer>`);
});

test('a custom menu keeps its order, adds links, drops pages taken off the menu and appends pages added to it', () => {
  const items = [{ id: 'm1', kind: 'link', label: 'Shop & more', url: 'https://shop.example/?a=1&b=2' }, { id: 'm2', kind: 'page', pageId: 'about' },
    { id: 'm3', kind: 'page', pageId: 'contact' }, { id: 'm4', kind: 'link', label: 'Work', url: '/work/' }, { id: 'm5', kind: 'link', label: '', url: '/x/' }];
  const h = band('header', [el('m', 'menu', { items, phone: 'row' })]);
  assert.match(renderHeader(h, ctx({ base: '/admin/site-preview/', siteHref: p => (p.startsWith('/') ? '/admin/site-preview/' + p.slice(1) : p) })),
    /<nav><a href="https:\/\/shop\.example\/\?a=1&amp;b=2">Shop &amp; more<\/a><a href="\/about\/">About &lt;us&gt;<\/a><a href="\/admin\/site-preview\/work\/">Work<\/a><a href="\/">Home<\/a><\/nav>/);
});

test('on phones the menu can fold behind a button that works without JavaScript', () => {
  const h = band('header', [el('mm', 'menu', { phone: 'button' })]);
  const out = renderHeader(h, ctx({ wording: { ...WORDING_DEFAULTS, menu: 'Menü "x"' } }));
  assert.match(out, /<input type="checkbox" id="nav-mm" class="nav-t" aria-label="Menü &quot;x&quot;"><label for="nav-mm" class="nav-b" aria-hidden="true"><span><\/span><\/label><nav class="nav-c"><a href="\/">Home<\/a>/);
  const f = band('footer', [el('fm', 'menu', { phone: 'button' })]);
  assert.match(renderFooter(f, ctx()), /<nav><a href="\/">Home/, 'only the header folds');
});

test('band style becomes classes; text and addresses are escaped; empty elements keep their place', () => {
  const h = band('header', [el('t', 'text', { text: '<b>hi</b>' }), el('b', 'button', { label: 'Book <now>', link: { kind: 'url', url: 'https://x.example/?q=a&b' }, look: 'outline', newTab: true }),
    el('l', 'link', { label: 'Contact', link: { kind: 'page', pageId: 'gone' } }), el('n', 'siteName'), el('s', 'spacer', { size: 'fill' })],
    { background: 'color', bgColor: '#102030', padding: 'compact', alignment: 'center', sticky: true });
  assert.equal(renderHeader(h, ctx()), '<header class="top bp-compact ba-center bg-own sticky" style="--band-bg:#102030">\n  <span>&lt;b&gt;hi&lt;/b&gt;</span>\n'
    + '  <a class="hbtn hbtn-outline" href="https://x.example/?q=a&amp;b" target="_blank" rel="noopener noreferrer">Book &lt;now&gt;</a>\n'
    + '  <span></span>\n  <a class="site-name" href="/">Example &amp; Co</a>\n  <span class="esp esp-fill" aria-hidden="true"></span>\n</header>');
});

test('the footer grid follows its element count; other arrangements are a row', () => {
  const two = band('footer', [el('a', 'text', { text: 'A' })]);
  assert.match(renderFooter(two, ctx()), /^<footer class="foot" style="grid-template-columns:1fr 1fr;column-gap:1\.5rem">/);
  const five = band('footer', [el('a', 'text', { text: 'A' }), el('b', 'text', { text: 'B' }), el('c', 'text', { text: 'C' }), el('d', 'text', { text: 'D' })]);
  assert.match(renderFooter(five, ctx()), /style="grid-template-columns:1fr auto auto auto 1fr;column-gap:1\.5rem"/);
  const left = band('footer', [el('a', 'text', { text: 'A' })], { alignment: 'left', toTop: false });
  assert.match(renderFooter(left, ctx()), /^<footer class="foot ba-left">\n  <span>A<\/span>\n<\/footer>$/);
});

test('motion and visibility wrap an element; hidden ones are left out, except faded in the editor', () => {
  const e = el('x', 'text', { text: 'Hi' }, { motion: { entrance: 'slide-up', duration: 500, delay: 100, hover: 'lift' }, visible: 'desktop' });
  assert.equal(renderElement(e, ctx()), '<div class="el vis-desktop m m-slide-up eh-lift" style="--m-dur:500ms;--m-delay:100ms"><span>Hi</span></div>');
  const off = el('y', 'text', { text: 'Gone' }, { visible: 'none' });
  assert.equal(renderElement(off, ctx()), null);
  assert.equal(renderElement(off, ctx({ editor: true })), '<div class="el blk-off" data-e="y"><span>Gone</span></div>');
  assert.equal(renderElement(el('z', 'social'), ctx({ editor: true })), '<div class="el" data-e="z"><span class="el-empty">Social link</span></div>');
  assert.match(renderHeader(band('header', []), ctx({ editor: true })), /^<header class="top" data-band="header">/);
});

test('the menu button label comes from the wording, and hostile values that skip cleaning are still escaped', () => {
  const h = band('header', [el('mm', 'menu', { phone: 'button' })]);
  assert.match(renderHeader(h, ctx()), /aria-label="Menu"/);
  const bad = { style: { ...HEADER_STYLE_DEFAULTS, background: 'color', bgColor: '"><script>', padding: 'x"', alignment: '"><b' },
    elements: [{ id: '"><i', type: 'text', props: { text: 'T' }, motion: { entrance: '"><u', duration: 1, delay: 2, hover: '" onx="' }, visible: 'all' }] };
  const out = renderHeader(bad, ctx({ editor: true }));
  assert.ok(!/<(script|b|i|u)\b/.test(out) && !out.includes('" onx="'), out);
});
