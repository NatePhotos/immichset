import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../build.mjs';
import { migratePages } from '../pages.mjs';
import { migrateSite, cleanSite } from '../sitewide.mjs';
import { state } from './fixtures.mjs';

const rd = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const ownWith = edit => { const s = state(); s.pages = migratePages(s.settings, s.galleries); const m = migrateSite(s.settings); edit(m); const r = cleanSite(m); assert.deepEqual(r.errors, []); s.site = r.site; return s; };

test('every visibility an element can have reaches the built stylesheet and its hide rules beat .el{display:flex}', () => {
  const s = ownWith(m => {
    const base = m.header.elements[0];
    m.header.elements = ['all', 'desktop', 'phone', 'none'].map((v, i) => ({ ...structuredClone(base), id: 'e' + i, visible: v }));
  });
  const html = build(s).files.get('index.html');
  for (const c of ['el vis-desktop', 'el vis-phone']) assert.ok(html.includes(c), c);
  assert.ok(!html.includes('blk-off'), 'a hidden element is left out of the published page');
  assert.ok(build(s, { editor: true }).files.get('index.html').includes('el blk-off'), 'the editor keeps it, faded');
  const css = build(s).files.get('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const flexAt = css.indexOf('.el { display: flex');
  assert.ok(flexAt >= 0);
  for (const rule of ['.el.vis-desktop { display: none; }', '.el.vis-phone { display: none; }', '.el.blk-off { display: none; }']) {
    assert.ok(css.indexOf(rule) > flexAt, rule);
  }
  assert.match(css, /@media \(max-width: 760px\) \{\s*\.el\.vis-desktop \{ display: none; \}/);
  assert.match(css, /@media \(min-width: 761px\) \{ \.el\.vis-phone/);
});

test('in the editor a hidden element still shows (faded) despite its stronger hide rule', () => {
  assert.match(rd('site/build.mjs'), /\.blk-off\{display:revert;opacity:\.35\}\.el\.blk-off\{display:flex\}/);
});

test('removing a page from a custom menu also turns off its "Show in the menu", in one commit', () => {
  const sw = rd('web/sitewide-admin.js');
  const at = sw.indexOf('rm.onclick = function(){');
  const h = sw.slice(at, sw.indexOf('row.appendChild(rm)', at));
  assert.equal((h.match(/X\.commit\(/g) || []).length, 1);
  assert.match(h, /props\.items = m\.el\.props\.items\.filter/);
  assert.match(h, /pg\.inMenu = false/);
  assert.match(h, /"site:menu-rm"/);
  assert.match(sw, /also turns off 'Show in the menu' for this page/);
});

test('the filling spacer makes its wrapper grow too', () => {
  assert.match(rd('site/assets/bands.css'), /\.el:has\(> \.esp-fill\) \{ flex: 1; \}/);
});
