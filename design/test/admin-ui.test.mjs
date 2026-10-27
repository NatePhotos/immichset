import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rd = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const admin = rd("web/admin.html"), editor = rd("web/design-admin.js"), page = rd("web/index.html");

test("Design is one full-screen editor inside each gallery, not a left-menu section", () => {
  assert.doesNotMatch(editor, /addSection\(/, "no Design entry in the left menu");
  assert.doesNotMatch(admin, /dzwrap/, "the old side-by-side layout is gone");
  assert.match(admin, /design:\s*\{[^}]*editor:true/, "the Design tab opens the editor");
  assert.match(admin, /window\.DesignEditor\) return DesignEditor\.open\(g, S\.pane\)/);
  assert.match(admin, /\$\("app"\)\.classList\.toggle\("dzfull", !!opts\.full\)/, "every other screen drops full-screen");
});

test("the cover pane is split so the editor can host it, without listeners piling up on window", () => {
  assert.doesNotMatch(admin, /function paneCover\(/);
  assert.match(admin, /function coverPhotoPane\(host, g, opts\)/);
  assert.match(admin, /function focalPane\(host, g, opts\)/);
  const focal = admin.slice(admin.indexOf("function focalPane("), admin.indexOf("A cover is served exactly as stored"));
  assert.doesNotMatch(focal, /window\.addEventListener/);
  assert.match(focal, /setPointerCapture/);
});

test("the preview only obeys the editor frame, and only the messages it expects", () => {
  assert.match(page, /ev\.origin !== location\.origin \|\| ev\.source !== window\.parent/);
  assert.match(page, /m\.to === "grid" \? \$\("hdr"\) : \(m\.to === "cover" \? \$\("cover"\) : null\)/);
  for (const t of ["ims-design", "ims-cover", "ims-scroll"]) assert.ok(page.includes(`"${t}"`), t);
});

test("autosave never writes a design the server flagged, and undo is bounded", () => {
  assert.match(editor, /Object\.keys\(D\.errors\)/);
  assert.match(editor, /D\.undo\.length > 100/);
  assert.match(editor, /beforeunload/);
});

test("the editor offers every cover layout and colour/type preset the server knows", () => {
  assert.match(editor, /D\.info\.coverLayouts/);
  assert.match(editor, /D\.info\.colorPresets/);
  assert.match(editor, /D\.info\.typePresets/);
  for (const l of ["left", "split", "classic", "frame", "lines", "divider", "journal", "inset", "box"]) assert.ok(editor.includes(`data-l=${l}]`), `thumbnail for ${l}`);
});

test("every gallery tab uses the same rail as the Design editor", () => {
  assert.match(admin, /function railTop\(g, active\)/);
  assert.match(admin, /'<div class="dz dzgen">'/, "the other tabs are laid out as rail + content");
  assert.doesNotMatch(admin, /class="gtabs"/, "the old word tabs are gone");
  assert.match(editor, /K\.railTop\(gal\(\), "design"\)/, "the editor reuses it");
  assert.match(admin, /railTop:railTop, wireRail:wireRail/);
  for (const tab of ["photos", "design", "settings", "email", "activity"]) assert.ok(admin.includes(`["${tab}",`), tab);
});

test("the panel's icons are Lucide icons from one shared table", () => {
  assert.match(admin, /var LUCIDE = \{/);
  for (const n of ["image", "images", "house", "globe", "users", "mail", "settings", "ellipsis", "log-out", "paintbrush", "palette", "chart-column", "type", "layout-grid", "sliders-horizontal", "clock", "heart", "triangle-alert", "circle-check", "circle-x", "plus", "chevron-right", "chevron-left"])
    assert.ok(admin.includes(`"${n}":`), `LUCIDE has ${n}`);
  assert.doesNotMatch(admin, /function svg20\(/, "no second, hand-drawn icon set");
  const home = rd("web/home.js");
  assert.match(home, /K\.lucide\(/); assert.doesNotMatch(home, /<path d=/);
  assert.doesNotMatch(editor, /<path d=/, "the editor draws no icons of its own");
  assert.match(admin, /settings:\s*lucide\("settings"\)/, "Settings is the Lucide gear, not the sun-like icon");
  assert.match(rd("NOTICE"), /Lucide/);
});

test("email previews scale to the space they have", () => {
  assert.match(admin, /function scaleEmail\(frame\)/);
  assert.match(admin, /scaleEmail\(\$\("mPrev"\)\)/);
  assert.match(admin, /scaleEmail\(\$\("cPrev"\)\)/);
  assert.match(admin, /ResizeObserver\(fit\)\.observe\(wrap\)/);
});

test("an email preview never makes the page scroll: the screen is fitted to the window and the scale is capped", () => {
  assert.match(admin, /Math\.min\(1\.1, Math\.max\(0\.5, wrap\.clientWidth \/ W\)\)/, "no more than 110%");
  assert.match(admin, /\.main\.fitview\{height:calc\(100vh - var\(--hdr,89px\)\);height:calc\(100dvh - var\(--hdr,89px\)\)/);
  assert.match(admin, /\.main\.fitview>#cp\{/, "the wrapper around the compose form is sized too");
  assert.match(admin, /function headerHeight\(\)/, "the real header height is measured, not guessed");
  assert.match(admin, /min-height:calc\(100dvh - var\(--hdr,60px\)\)/, "the gallery shell does not add its own scroll");
  assert.match(admin, /\$\("pane"\)\.classList\.remove\("fitview"\)/, "other screens are not fitted");
});

test("the header is the same on every gallery tab, the Design editor included", () => {
  assert.match(admin, /function galleryChromeOpts\(g, extra\)/);
  assert.match(admin, /chrome\(galleryChromeOpts\(g\)\)/, "the other tabs use it");
  assert.match(editor, /K\.chrome\(K\.galleryChromeOpts\(g, \{ full: true, more: moreItems\(\) \}\)\)/, "the editor uses it");
  assert.doesNotMatch(editor, /label: "Share"|label: "Preview"/, "the editor does not build a header of its own");
  assert.doesNotMatch(admin, /crumb:"Galleries"/, "no 'Galleries /' crumb on some tabs only");
});

test("the Design list looks like every other tab's list: same classes, no styles of its own", () => {
  assert.match(editor, /<div class="navhead">Design<\/div><div class="navrow"/);
  assert.match(editor, /class="navitem'/);
  assert.doesNotMatch(editor, /\.dzitems\b|\.dzhead\b/, "no second set of list text styles");
});

test("the Templates page has a New template button that opens Compose with a blank template", () => {
  assert.match(admin, /id="tplNew"/);
  assert.match(admin, /\$\("tplNew"\)\.onclick = function\(\)\{ S\.newTpl = true; S\.pane = "compose"; renderShell\(\); \}/);
  assert.match(admin, /var fresh = !!S\.newTpl, want = S\.selectTpl;/);
  assert.match(admin, /Save as new template/);
  assert.match(admin, /S\.selectTpl = made \? made\.id : null/, "the template just made is the one showing afterwards");
});

test("the editor can turn the cover animation off, and offers nothing for the grid photos", () => {
  assert.match(editor, /seg\("coverMotion", "Cover animation"/);
  assert.match(editor, /coverMotion: "Cover animation"[,} ]/, "listed under what this gallery changes");
  assert.doesNotMatch(editor, /photoMotion/);
});

test("every Design section has a Reset to default, covering exactly the settings it owns", async () => {
  assert.match(editor, /id="dzReset"[^>]*>Reset to default</);
  const lit = editor.match(/var RESET_KEYS = (\{[\s\S]*?\n\});/)[1];
  const keys = new Function(`return ${lit}`)();
  assert.deepEqual(Object.keys(keys), ["cover", "type", "color", "grid", "advanced"]);
  const { DEFAULT_DESIGN } = await import("../design.mjs");
  const all = Object.values(keys).flat();
  for (const k of all) assert.ok(k in DEFAULT_DESIGN, `${k} is a real setting`);
  assert.equal(new Set(all).size, all.length, "no setting is reset by two sections");
  const owned = new Set(all);
  const unowned = Object.keys(DEFAULT_DESIGN).filter((k) => !owned.has(k));
  assert.deepEqual(unowned, [], "every design setting belongs to a section, so none is left unresettable");
  assert.match(editor, /function changed\(slow\)\{[^}]*paintReset\(\)/, "the button follows slider drags too");
});

test("the editor can turn the slideshow and the favourites hearts off", () => {
  assert.match(editor, /seg\("slideshow", "Slideshow"/);
  assert.match(editor, /seg\("favourites", "Favourites \(hearts\)"/);
  assert.match(editor, /slideshow: "Slideshow", favourites: "Favourites"[,} ]/);
});

test("the editor can hide the photo count", () => {
  assert.match(editor, /seg\("photoCount", "Photo count"/);
  assert.match(editor, /photoCount: "Photo count" \}/);
});

test("saving a default look says it only affects new galleries, and refreshes the list", () => {
  assert.match(editor, /Galleries that already exist keep the look they have now/);
  assert.match(editor, /Existing galleries are unchanged/);
  assert.doesNotMatch(editor, /will change to match/, "no more promise to restyle other galleries");
  assert.match(editor, /K\.refreshGalleries\(function\(\)/);
  assert.match(editor, /function settled\(\)/, "a pending save finishes before the default is written");
});

test("photos in the Activity section open in a viewer", () => {
  assert.match(admin, /function viewPhotos\(ids, start, label\)/);
  assert.match(admin, /function wirePhotoTiles\(root\)/);
  assert.match(admin, /wirePhotoTiles\(\$\("picks"\)\)/, "Favourites");
  assert.match(admin, /wirePhotoTiles\(\$\("dls"\)\)/, "Downloads");
  assert.equal((admin.match(/class="p" data-id="/g) || []).length, 2, "every tile carries its photo id");
  assert.match(admin, /imgSrc\(ids\[i\], "preview"\)/, "the large preview, not the thumbnail");
  for (const key of ["Escape", "ArrowLeft", "ArrowRight"]) assert.ok(admin.includes(`e.key === "${key}"`), key);
  assert.match(admin, /OVERLAY = \{ close: close, viewer: el \}/, "it closes when the page changes");
  assert.match(admin, /\.picksrow \.p\{[^}]*cursor:zoom-in/);
});

test("Downloads says so when someone took every photo, instead of listing them all", () => {
  assert.match(admin, /var summary = p\.all \? 'Downloaded ' \+ everything/);
  assert.match(admin, /if \(p\.ids\.length && !p\.all\) h \+= thumbs\(p\.ids\)/, "no thumbnails for someone who took everything");
  assert.match(admin, /z\.ids && !z\.all && !p\.all \? thumbs\(z\.ids\)/, "nor for a zip of everything");
  assert.match(admin, /"all " \+ total \+ " photos"/);
});

test("the editor saves a draft and only Publish puts it in front of clients", () => {
  assert.match(editor, /JSON\.stringify\(\{ designDraft: D\.own \}\)/, "autosave writes the draft, never the published look");
  assert.doesNotMatch(editor, /JSON\.stringify\(\{ design: keys\.length/, "the old write straight to the live design is gone");
  assert.match(editor, /cur\.designDraft \|\| cur\.design/, "it opens on the draft if there is one");
  assert.match(editor, /\/design\/publish/); assert.match(editor, /\/design\/discard/);
  assert.match(editor, /id="dzPublish"/); assert.match(editor, /Discard changes/);
  assert.match(editor, /Your changes are a draft\. Clients still see the published design until you publish\./);
  assert.match(editor, /function settled\(\)/, "a pending save finishes before publishing");
  assert.match(editor, /setStatus\(r\.body\.designPending \? "Draft saved" : "Saved"\)/);
});
