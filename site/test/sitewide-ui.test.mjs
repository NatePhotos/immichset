import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listElementTypes, HEADER_STYLE_SCHEMA, FOOTER_STYLE_SCHEMA, ELEMENT_MOTION_SCHEMA, ELEMENT_VISIBLE } from '../bands.mjs';
import { THEME_SCHEMA } from '../theme.mjs';
import { WORDING_SCHEMA } from '../wording.mjs';

const rd = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const admin = rd('web/admin.html'), builder = rd('web/builder-admin.js'), sw = rd('web/sitewide-admin.js');

test('the site-wide panels load after the page editor and use it only through its kit', () => {
  assert.match(admin, /<script src="\/builder-admin\.js"><\/script>\n<script src="\/sitewide-admin\.js"><\/script>/);
  assert.match(sw, /var S = window\.SiteBuilder; if \(!S \|\| !S\.kit\) return;/);
  assert.match(sw, /window\.SiteWide = \{ rail: rail, outline: outline, panel: panel, has: has \}/);
  for (const call of ['SiteWide.rail(', 'SiteWide.outline(', 'SiteWide.panel()', 'SiteWide.has(']) assert.ok(builder.includes(call), call);
});

test('one save path: every change goes through the editor’s commit', () => {
  assert.doesNotMatch(sw, /api\("\/site\/pages"|"x-pages-rev"|\/settings/);
  assert.ok((sw.match(/X\.commit\(/g) || []).length >= 6);
});

test('the rail lists Header, Footer, Theme and Wording beside the pages', () => {
  for (const a of ['"header", "Header"', '"footer", "Footer"', '"theme", "Theme"', '"wording", "Wording"']) assert.ok(sw.includes(a), a);
  assert.match(sw, /r\.onclick = function\(\)\{ X\.selectArea\(r\.dataset\.area, null\); \};/);
});

test('elements can be added, reordered, duplicated, hidden and deleted; hidden ones stay listed and selectable', () => {
  for (const a of ['dup', 'hide', 'del']) assert.ok(sw.includes(`data-act="${a}"`), a);
  assert.match(sw, /X\.sortable\(host\.querySelector\("\.wblist"\), "\.wbit"/);
  assert.match(sw, /\(hidden\)/);
  assert.match(sw, /shownBefore\[id\] \|\| "all"/);
  assert.match(sw, /if \(!a\) return X\.selectArea\(B\.area, id\);/, 'a hidden element is selected like any other');
  assert.match(sw, /X\.rid\("e"\)/, 'new ids are made here, never taken from the database');
  assert.match(sw, /Add to the /);
});

test('every kind of field the server describes for the site has a control', () => {
  const fields = [...listElementTypes().flatMap(t => t.fields), ...HEADER_STYLE_SCHEMA, ...FOOTER_STYLE_SCHEMA, ...ELEMENT_MOTION_SCHEMA, ELEMENT_VISIBLE, ...THEME_SCHEMA, ...WORDING_SCHEMA];
  for (const k of new Set(fields.map(f => f.kind))) {
    if (k === 'menu') assert.match(sw, /if \(f\.kind !== "menu"\) return null;/);
    else assert.ok(builder.includes(`k === "${k}"`), `no control for "${k}" fields`);
  }
  for (const k of ['B.info.headerStyle', 'B.info.footerStyle', 'B.info.elementMotion', 'B.info.elementVisible', 'B.info.theme', 'B.info.wording']) assert.ok(sw.includes(k), k);
});

test('the menu can be automatic or the owner’s own list of pages and links', () => {
  assert.match(sw, /> Automatic<\/label>/);
  assert.match(sw, /\{ id: X\.rid\("m"\), kind: "link", label: "Link", url: "" \}/);
  assert.match(sw, /\{ id: X\.rid\("m"\), kind: "page", pageId: pid \}/);
  assert.match(sw, /placeholder="\/page\/ or https:\/\/…"/);
});

test('server text is escaped or set as text; the logo keeps its own routes and checks', () => {
  assert.match(sw, /esc\(p \? p\.title : "A deleted page"\)/);
  assert.match(sw, /\.value = it\.label \|\| ""/);
  assert.match(sw, /\.value = it\.url \|\| ""/);
  assert.match(sw, /esc\(t\.label\)/);
  assert.match(sw, /fetch\("\/api\/admin\/site\/logo\?name=" \+ encodeURIComponent\(f\.name\)/);
  assert.match(sw, /api\("\/site\/logo", \{ method: "DELETE" \}\)/);
  assert.match(sw, /B\.site\.settings\.style\.logo = j\.logo \|\| null; if \(j\.rev\) B\.rev = j\.rev;/, 'the editor adopts the new site revision');
});

test('the site name is edited in the Header panel', () => {
  assert.match(sw, /id="wbSwName" maxlength="80"/);
  assert.match(sw, /X\.commit\(function\(\)\{ B\.sw\.name = v; \}, "swname"\)/);
});

test('extra: site edits merge under their own key prefix; the rail repaints with the draft; only header and footer bands are selected from the preview', () => {
  assert.match(sw, /"site:"/);
  assert.doesNotMatch(sw, /id \+ \(part \|\| ""\) \+ ":"/);
  assert.match(builder, /function changed\(\)\{[^\n]*paintSiteRail\(\)/);
  assert.match(builder, /m\.band === "header" \|\| m\.band === "footer"/);
});
