import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync(new URL('../../web/builder-admin.js', import.meta.url), 'utf8');

test('one draft: the site-wide part is saved, previewed, undone and discarded with the pages', () => {
  assert.match(builder, /var body = JSON\.stringify\(\{ pages: B\.pages, site: B\.sw \}\);/, 'one save, one revision');
  assert.match(builder, /JSON\.stringify\(\{ pages: B\.pages, slug: slug, site: B\.sw \}\)/, 'the preview shows unsaved site edits');
  assert.match(builder, /function snap\(\)\{ return \{ pages: clone\(B\.pages\), sw: clone\(B\.sw\) \}; \}/);
  assert.match(builder, /B\.undo\.push\(snap\(\)\)/);
  assert.match(builder, /B\.redo\.push\(snap\(\)\); unsnap\(B\.undo\.pop\(\)\)/);
  assert.match(builder, /B\.sw = clone\(body\.site\)/, 'loading takes the site');
  assert.match(builder, /B\.sw = clone\(r\.body\.site\)/, 'discard takes the published site');
  assert.match(builder, /The pages, header, footer, theme and wording go back to what the public site shows now/);
});

test('clicking the header or footer in the preview selects it, and the preview is told what is selected by kind', () => {
  assert.match(builder, /if \(m\.type === "wb-select"\)\{ if \(m\.band\) selectArea\(m\.band, m\.id \|\| null\); else select\(m\.id \|\| null, false\); \}/);
  assert.match(builder, /send\(\{ type: "wb-select", id: B\.sel, kind: "b", scroll: !!scroll \}\)/);
  assert.match(builder, /send\(\{ type: "wb-select", id: B\.sel \|\| B\.area, kind: B\.sel \? "e" : "band", scroll: !!scroll \}\)/);
  assert.match(builder, /'<div id="wbSiteRail"><\/div><div id="wbOutline"><\/div><\/nav>'/);
  assert.match(builder, /B\.area === "page" && p\.id === B\.pageId \? " on" : ""/, 'a page is only highlighted while pages are being edited');
});

test('the side panels hand over to the site-wide panels, which may be missing without breaking the page editor', () => {
  assert.match(builder, /if \(B\.area !== "page" && window\.SiteWide\) return SiteWide\.panel\(\);/);
  assert.match(builder, /if \(B\.area !== "page"\)\{ if \(window\.SiteWide\) SiteWide\.outline\(host\); else host\.innerHTML = ""; return; \}/);
  assert.match(builder, /function selected\(\)\{ return B\.area === "page" \? !!find\(B\.sel\) : isBand\(\) && !!window\.SiteWide && SiteWide\.has\(B\.sel\); \}/);
  assert.match(builder, /window\.SiteBuilder\.kit = \{ B: B, commit: commit, buildForm: buildForm, el: el, sortable: sortable, rid: rid, clone: clone,/);
  assert.match(builder, /function buildForm\(fields, values, onSet, extra\)\{/);
  assert.match(builder, /var c = \(extra && extra\(f, values\[f\.key\], set\)\) \|\| control\(f, values\[f\.key\], set\);/);
});

test('with the Wording panel open the preview shows the not-found page', () => {
  assert.match(builder, /slug = B\.area === "wording" \? "-" : p\.slug/);
  assert.match(builder, /if \(\(was === "wording"\) !== \(area === "wording"\)\) render\(0\);/);
});
