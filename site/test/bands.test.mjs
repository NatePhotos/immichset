import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBand, cleanElement, listElementTypes, menuUrl, ELEMENT_TYPES, ELEMENT_MOTION_SCHEMA, ELEMENT_MOTION_DEFAULTS,
  HEADER_STYLE_SCHEMA, HEADER_STYLE_DEFAULTS, FOOTER_STYLE_SCHEMA, FOOTER_STYLE_DEFAULTS, BAND_LIMITS } from '../bands.mjs';

const el = (id, type, props = {}, more = {}) => ({ id, type, props, motion: {}, visible: 'all', ...more });

test('the element types are the eight the spec lists, each with a form and defaults it accepts', () => {
  assert.deepEqual(listElementTypes().map(t => t.type), ['logo', 'siteName', 'menu', 'link', 'button', 'social', 'text', 'spacer']);
  for (const t of ELEMENT_TYPES.values()) {
    const r = t.validate(structuredClone(t.defaults));
    assert.deepEqual(r.errors, {}, t.type);
    assert.deepEqual(Object.keys(r.props), t.fields.map(f => f.key), t.type);
  }
  assert.deepEqual(ELEMENT_MOTION_SCHEMA.map(f => f.key), Object.keys(ELEMENT_MOTION_DEFAULTS));
  assert.deepEqual(HEADER_STYLE_SCHEMA.map(f => f.key), Object.keys(HEADER_STYLE_DEFAULTS));
  assert.deepEqual(FOOTER_STYLE_SCHEMA.map(f => f.key), Object.keys(FOOTER_STYLE_DEFAULTS));
});

test('menu items point at a page or at a checked address; anything else is refused', () => {
  assert.equal(menuUrl('/about/'), '/about/');
  assert.equal(menuUrl('/work/#top'), '/work/#top');
  assert.equal(menuUrl('https://example.com/x'), 'https://example.com/x');
  assert.equal(menuUrl('mailto:a@b.co'), 'mailto:a@b.co');
  for (const bad of ['//evil.example', '/\\evil', 'javascript:alert(1)', '/a b', '/a"b', 'about/', '/x\u0001']) assert.equal(menuUrl(bad), '', bad);
  const m = ELEMENT_TYPES.get('menu');
  const ok = m.validate({ items: [{ id: 'm1', kind: 'page', pageId: 'about' }, { id: 'm2', kind: 'link', label: ' Shop ', url: 'https://shop.example' }, { id: 'm3', kind: 'link', label: 'New', url: '' }], phone: 'row' });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.props, { items: [{ id: 'm1', kind: 'page', pageId: 'about' }, { id: 'm2', kind: 'link', label: 'Shop', url: 'https://shop.example' },
    { id: 'm3', kind: 'link', label: 'New', url: '' }], phone: 'row' });
  assert.deepEqual(m.validate({ items: null }).props, { items: null, phone: 'button' });
  for (const items of [[{ id: 'm1', kind: 'link', label: 'x', url: 'javascript:alert(1)' }], [{ id: 'm1', kind: 'page', pageId: 'a' }, { id: 'm1', kind: 'page', pageId: 'b' }],
    [{ id: 'm1', kind: 'html', html: '<script>' }], 'nope', Array.from({ length: BAND_LIMITS.menuItems + 1 }, (_, i) => ({ id: `m${i}`, kind: 'page', pageId: 'home' }))]) {
    assert.ok(m.validate({ items }).errors.items, JSON.stringify(items).slice(0, 60));
  }
});

test('links, buttons and social links use the same address check as the page blocks', () => {
  const b = cleanElement(el('e1', 'button', { label: 'Go', link: { kind: 'url', url: 'javascript:alert(1)' } }));
  assert.match(b.errors.join(), /Button, link: links must start with https:\/\//);
  const s = cleanElement(el('e2', 'social', { network: 'myspace', url: 'ftp://x' }));
  assert.deepEqual(s.errors.sort(), ['Social link, network: choose one of: Instagram, Facebook, YouTube, LinkedIn', 'Social link, url: links must start with https://, http://, mailto: or tel:']);
  assert.equal(s.element.props.url, '');
});

test('an element is checked like a block: known type, valid unique id, motion and visibility from their lists', () => {
  const ids = new Set();
  assert.equal(cleanElement(el('e1', 'text', { text: 'x'.repeat(300) }), ids).element.props.text.length, 200);
  assert.match(cleanElement(el('e1', 'text'), ids).errors[0], /used twice/);
  assert.match(cleanElement(el('E 1', 'text'), ids).errors[0], /not valid/);
  assert.match(cleanElement(el('e3', 'script'), ids).errors[0], /unknown element "script"/);
  const r = cleanElement(el('e4', 'logo', {}, { motion: { entrance: 'spin', hover: 'grow' }, visible: 'sometimes' }), ids);
  assert.deepEqual(r.errors.sort(), ['Logo, entrance: choose one of: None, Fade in, Slide up, Slide down, Slide in from the right, Slide in from the left, Zoom in, Soft focus in',
    'Logo, visible: choose one of: Phones and computers, Computers only, Phones only, Hidden']);
  assert.deepEqual(r.element.motion, { ...ELEMENT_MOTION_DEFAULTS, hover: 'grow' });
  assert.equal(cleanElement({ id: 'e5', type: 'logo' }, ids).element.visible, 'all', 'a missing visibility is the default, not an error');
});

test('a band is checked as a whole, with every reason, and limited in size', () => {
  const r = cleanBand({ style: { padding: 'huge', sticky: true }, elements: [el('a', 'logo'), el('a', 'menu'), el('b', 'nope')] }, 'header');
  assert.deepEqual(r.errors, ['Header, padding: choose one of: Compact, Normal, Roomy', 'Header: Menu: the element id "a" is used twice', 'Header: unknown element "nope"']);
  assert.deepEqual(r.band.style, { ...HEADER_STYLE_DEFAULTS, sticky: true });
  assert.deepEqual(r.band.elements.map(e => e.id), ['a']);
  assert.deepEqual(cleanBand(null, 'footer').errors, ['Footer: missing']);
  assert.match(cleanBand({ style: {}, elements: 'x' }, 'footer').errors[0], /must be a list/);
  const many = Array.from({ length: BAND_LIMITS.elements + 1 }, (_, i) => el(`s${i}`, 'spacer'));
  assert.match(cleanBand({ style: {}, elements: many }, 'footer').errors.join(), /at most 20 elements/);
  assert.equal(cleanBand({ style: {}, elements: [] }, 'footer').band.style.toTop, true);
});
