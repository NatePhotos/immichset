import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const admin = rd('web/admin.html'), builder = rd('web/builder-admin.js'), siteAdmin = rd('web/site-admin.js'), bridge = rd('site/assets/edit-bridge.js');

test('the page editor is loaded by the panel and opened from the Website section', () => {
  assert.match(admin, /<script src="\/design-admin\.js"><\/script>\n<script src="\/builder-admin\.js"><\/script>/, 'after the Design editor, whose styles it shares');
  assert.match(builder, /window\.SiteBuilder = \{ open: open, close: close, isOpen: isOpen \}/);
  assert.match(siteAdmin, /W\.active = false; SiteBuilder\.open\(\)/, 'the Website screens stop repainting under the editor');
  assert.match(siteAdmin, /if \(window\.SiteBuilder && SiteBuilder\.leave\(\) === false\) return false; W\.active = false;/, 'leaving the section closes the editor, unless the person stays to keep unsaved edits');
  assert.match(siteAdmin, /window\.WebsiteKit = \{ upload: uploadOne \}/);
});

test('the editor is full-screen in the Website section, like the Design editor', () => {
  assert.match(builder, /K\.chrome\(\{ title: "Pages", crumb: "Website", back: leave, section: "website", full: true,/);
  assert.doesNotMatch(builder, /<path d=/, 'no hand-drawn icons');
  assert.doesNotMatch(builder, /addSection\(/, 'not a left-menu section of its own');
});

test('autosave carries the pages revision, and a stale save is never overwritten silently', () => {
  assert.match(builder, /"x-pages-rev": String\(B\.pagesRev\)/);
  assert.match(builder, /r\.status === 409\)\{ B\.stale = true; paintStale\(\)/);
  assert.match(builder, /if \(B\.stale\) return;/, 'no autosave while stale');
  assert.match(builder, /Keep my version/); assert.match(builder, /Load the latest/);
  assert.match(builder, /body\.length > 2 \* 1024 \* 1024/, 'too-large drafts are caught before sending');
});

test('undo is bounded and unsaved work is guarded', () => {
  assert.match(builder, /B\.undo\.length > 100/);
  assert.match(builder, /beforeunload/);
});

test('the live preview is the real build of the unsaved pages', () => {
  assert.match(builder, /api\("\/site\/render"/);
  assert.match(builder, /B\.frame\.srcdoc = r\.body\.html/);
  for (const d of ['phone', 'tablet', 'desktop']) assert.match(builder, new RegExp(`${d}: \\{ w: \\d+, h: \\d+`));
});

test('preview messages are only taken from the preview frame, on this origin', () => {
  assert.match(builder, /ev\.origin !== location\.origin \|\| !B\.frame \|\| ev\.source !== B\.frame\.contentWindow/);
  assert.match(bridge, /ev\.origin !== ORIGIN \|\| ev\.source !== window\.parent/);
  for (const t of ['wb-select', 'wb-scroll', 'wb-scrolled']) { assert.ok(builder.includes(`"${t}"`), t); assert.ok(bridge.includes(`'${t}'`), t); }
});

test('Publish waits for the last save; Discard only touches the draft', () => {
  assert.match(builder, /function settled\(\)/);
  assert.match(builder, /settled\(\)\.then\(function\(\)\{\s*if \(B\.bad\)/);
  assert.match(builder, /api\("\/site\/pages\/discard"/);
  assert.match(builder, /Your changes are a draft\. The public site shows the published version until you publish\./);
});

test('pages: add, rename, address, menu, SEO, duplicate, delete, reorder; home and gallery pages are protected', () => {
  for (const id of ['wbAddPage', 'wbPTitle', 'wbPSlug', 'wbPMenu', 'wbPSeoT', 'wbPSeoD', 'wbPDup', 'wbPDel']) assert.ok(builder.includes(`"${id}"`), id);
  assert.match(builder, /sortable\(host, "\.wbpg"/);
  assert.match(builder, /home \|\| gal \? "" : '<button class="btn sm ghost" type="button" id="wbPDel">/);
});

test('unsaved work is guarded after a failed save, and the footer never claims to be saving when it cannot', () => {
  assert.match(builder, /function unsaved\(\)\{ return dirtyLocal\(\) \|\| B\.stale \|\| B\.bad; \}/);
  assert.match(builder, /if \(B\.open && unsaved\(\)\)/, 'closing the tab warns');
  assert.match(builder, /function tryLeave\(\)\{\s*if \(!B\.open\) return true;\s*if \(\(B\.stale \|\| B\.bad\) && !confirm\(/, 'Back asks first');
  assert.match(builder, /if \(B\.stale \|\| B\.bad\) toast\("Some of your latest page changes were not saved"\)/, 'closing any other way says so');
  assert.match(builder, /if \(!B\.open && !r\.ok\) toast\(/, 'a save that fails after closing is reported');
  assert.match(builder, /if \(B\.stale\) setStatus\("Not saved: changed somewhere else", true\); else setStatus\("Saving…"\)/);
});

test('switching section can be cancelled, so unsaved edits are not lost by navigating', () => {
  assert.match(admin, /if \(cur && cur\.leave && cur\.leave\(\) === false\) return;/, 'only an explicit false cancels');
  assert.match(admin, /return cur\.leave\(\); \}/, 'leaveFor passes the answer on');
  assert.match(admin, /if \(leaveFor\("galleries"\) === false\) return;/);
  assert.match(admin, /function kitNewGallery\(\)\{ if \(leaveFor\("galleries"\) === false\) return;/);
  assert.match(builder, /window\.SiteBuilder\.leave = tryLeave/);
  assert.match(builder, /function tryLeave\(\)\{[^]*?!confirm\([^]*?return false;[^]*?close\(\); return true;/);
  assert.match(siteAdmin, /SiteBuilder\.isOpen\(\) && SiteBuilder\.leave\(\) === false\) return;/, 'websiteView too');
});

import { listBlockTypes, STYLE_SCHEMA, MOTION_SCHEMA } from '../blocks/registry.mjs';

test('every kind of field the server describes has a control', () => {
  const kinds = new Set([...listBlockTypes().flatMap(t => t.fields), ...STYLE_SCHEMA, ...MOTION_SCHEMA].map(f => f.kind));
  for (const k of kinds) assert.ok(builder.includes(`k === "${k}"`), `no control for "${k}" fields`);
  assert.match(builder, /B\.info\.style/); assert.match(builder, /B\.info\.motion/);
  assert.match(builder, /function shown\(f, values\)/, 'fields that only apply sometimes follow their "when"');
});

test('an unknown field kind or block type shows nothing instead of failing', () => {
  assert.match(builder, /return null;\n\}\n\n\/\* choose one of the website/, 'control gives null for an unknown kind');
  assert.match(builder, /if \(!c\) return;/);
  assert.match(builder, /\|\| \{ type: t, label: String\(t\)/, 'an unknown block type still has a label and no fields');
});

test('custom HTML and CSS are edited as plain text, never rendered into the admin page', () => {
  assert.match(builder, /if \(k === "html" \|\| k === "css"\)\{ var c = el\('<textarea class="wbcode"/);
});

test('the outline can drag, duplicate, hide and delete blocks, including inside columns', () => {
  for (const a of ['dup', 'hide', 'del']) assert.ok(builder.includes(`data-act="${a}"`), a);
  assert.match(builder, /sortable\(l, "\.wbit"/);
  assert.match(builder, /data-addto=/);
  assert.match(builder, /\(hidden\)/, 'hidden blocks are marked in the outline');
});

test('the add-block picker shows a sketch of each type and keeps columns out of columns', () => {
  assert.match(builder, /t\.sketch/);
  assert.match(builder, /!nested \|\| t\.nestable/);
  assert.match(builder, /Add a block/);
  assert.ok(listBlockTypes().filter(t => !t.nestable).map(t => t.type).sort().join() === 'columns,photo-grid');
});

test('photos are chosen from the website’s photos or uploaded through the same pipeline', () => {
  assert.match(builder, /window\.WebsiteKit\.upload\(f, "pages"\)/);
  assert.match(builder, /Choose a photo/);
});

test('small editor fixes: hide remembers visibility, drops are cancelled, home is found by id, failures are caught', () => {
  assert.match(builder, /shownBefore\[id\] \|\| "all"/, 'un-hiding restores the earlier visibility');
  assert.match(builder, /shownBefore\[id\] = b\.style\.visible/);
  assert.match(builder, /el\.ondrop = function\(e\)\{ e\.preventDefault\(\); \}/);
  assert.match(builder, /home = p\.id === "home" && !gal/);
  assert.doesNotMatch(builder, /p\.slug === ""/, 'an emptied address is not the home page');
  assert.doesNotMatch(builder, /throw e; \}\);\n\}/, 'reloadSite does not rethrow');
  assert.match(builder, /reloadSite\(\)\.then\(function\(body\)\{ if \(!body\) return;/);
  assert.match(builder, /\}\)\.catch\(function\(\)\{ toast\("Couldn’t discard/);
  assert.match(builder, /function typeOf\(t\)\{[^\n]*\|\| \{ type: t, label: String\(t\), icon: "square"/, 'an unknown block type still gets a stub with an icon');
});
