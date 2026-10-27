import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_DESIGN, RANGES, ENUMS, FONTS, THEMES, normaliseDesign, effectiveDesign, isDefaultDesign, designCss, fontLink, fontHref,
  designWarnings, contrast, serializeDesignFile, parseDesignFile, DESIGN_FILE_MAX_BYTES,
} from "../design.mjs";

const page = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");
const rootBlock = page.match(/:root\s*\{([^}]*)\}/)[1];
const pageVar = (n) => rootBlock.match(new RegExp(`--${n}:\\s*([^;]+);`))[1].trim();

test("the default design reproduces today's gallery page", () => {
  assert.equal(isDefaultDesign(DEFAULT_DESIGN), true);
  const css = designCss(DEFAULT_DESIGN);
  const v = (n) => css.match(new RegExp(`--${n}:([^;}]+)`))[1];
  assert.equal(v("page-bg"), pageVar("page-bg"));
  assert.equal(v("page-fg"), pageVar("page-fg"));
  assert.equal(v("muted"), pageVar("muted"));
  assert.equal(v("line"), pageVar("line"));
  assert.equal(v("gap"), pageVar("gap"));
  assert.equal(v("maxw"), pageVar("maxw"));
  assert.equal(v("font"), pageVar("font"));
  assert.equal(Number(v("cover-scrim")), Number(pageVar("cover-scrim")));
});

test("the default font link matches the one on the page", () => {
  const href = page.match(/<link href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/)[1];
  assert.equal(fontHref(DEFAULT_DESIGN), href);
});

test("full validation fills defaults and accepts the defaults", () => {
  const r = normaliseDesign({});
  assert.deepEqual(r.errors, {});
  assert.deepEqual(r.design, DEFAULT_DESIGN);
  assert.deepEqual(normaliseDesign({ ...DEFAULT_DESIGN }).errors, {});
});

test("every range accepts its edges and rejects just outside", () => {
  for (const [k, r] of Object.entries(RANGES)) {
    assert.deepEqual(normaliseDesign({ [k]: r.min }).errors, {}, `${k} min`);
    assert.deepEqual(normaliseDesign({ [k]: r.max }).errors, {}, `${k} max`);
    assert.ok(normaliseDesign({ [k]: r.min - 1 }).errors[k], `${k} below`);
    assert.ok(normaliseDesign({ [k]: r.max + 1 }).errors[k], `${k} above`);
    assert.ok(normaliseDesign({ [k]: "5" }).errors[k], `${k} string`);
  }
  assert.ok(normaliseDesign({ gap: 4.5 }).errors.gap, "whole numbers only");
  assert.deepEqual(normaliseDesign({ tileAspect: 1.25 }).errors, {});
});

test("strict about unknown keys, bad colours, bad choices", () => {
  assert.match(normaliseDesign({ shadow: 1 }).errors.shadow, /Unknown/);
  assert.ok(normaliseDesign({ background: "red" }).errors.background);
  assert.ok(normaliseDesign({ background: "#fff" }).errors.background);
  assert.deepEqual(normaliseDesign({ background: null, text: "#ABCDEF" }).errors, {});
  assert.equal(normaliseDesign({ text: "#ABCDEF" }).design.text, "#abcdef");
  assert.ok(normaliseDesign({ theme: "sepia" }).errors.theme);
  assert.ok(normaliseDesign({ font: "comic" }).errors.font);
  assert.ok(normaliseDesign(null).errors.design);
  assert.ok(normaliseDesign([]).errors.design);
});

test("partial validation checks only what is present", () => {
  const r = normaliseDesign({ gap: 3 }, { partial: true });
  assert.deepEqual(r.design, { gap: 3 });
  assert.ok(normaliseDesign({ gap: 99 }, { partial: true }).errors.gap);
});

test("custom CSS is compiled; errors say where", () => {
  assert.deepEqual(normaliseDesign({ customCss: ".cell{opacity:.9}" }).errors, {});
  const e = normaliseDesign({ customCss: ".a{background:url(x)}" }).errors.customCss;
  assert.match(e, /line 1, column \d+/);
});

test("a gallery inherits the site design and overrides only what it sets", () => {
  const site = { ...DEFAULT_DESIGN, theme: "dark", gap: 4 };
  const eff = effectiveDesign(site, { gap: 20, background: "#222222" });
  assert.equal(eff.theme, "dark");
  assert.equal(eff.gap, 20);
  assert.equal(eff.background, "#222222");
  assert.deepEqual(effectiveDesign(null, null), DEFAULT_DESIGN);
  assert.deepEqual(effectiveDesign(site, { background: null }).background, null);
});

test("a non-default design is detected", () => {
  assert.equal(isDefaultDesign({ ...DEFAULT_DESIGN, gap: 11 }), false);
});

test("themes: dark, system, custom colours", () => {
  assert.match(designCss({ ...DEFAULT_DESIGN, theme: "dark" }), /--page-bg:#111111/);
  const sys = designCss({ ...DEFAULT_DESIGN, theme: "system" });
  assert.match(sys, /color-scheme:light dark/);
  assert.match(sys, /@media \(prefers-color-scheme:dark\)\{:root\{--page-bg:#111111/);
  const custom = designCss({ ...DEFAULT_DESIGN, background: "#faf5ec", text: "#222222" });
  assert.match(custom, /--page-bg:#faf5ec/);
  assert.match(custom, /--page-fg:#222222/);
  const sysCustom = designCss({ ...DEFAULT_DESIGN, theme: "system", background: "#faf5ec" });
  assert.match(sysCustom, /:root\{color-scheme:light dark;--page-bg:#faf5ec/);
  assert.match(sysCustom, /prefers-color-scheme:dark\)\{:root\{--page-bg:#111111/);
});

test("accent text picks a readable colour", () => {
  assert.match(designCss({ ...DEFAULT_DESIGN, accent: "#ffffff" }), /--accent:#ffffff;--accent-fg:#111111/);
  assert.match(designCss({ ...DEFAULT_DESIGN, accent: "#000000" }), /--accent:#000000;--accent-fg:#ffffff/);
});

test("layout choices produce their rules", () => {
  assert.match(designCss({ ...DEFAULT_DESIGN, cover: "none" }), /#cover\{display:none\}/);
  assert.match(designCss({ ...DEFAULT_DESIGN, cover: "banner", coverHeight: 60 }), /#cover\{height:60svh;min-height:280px\}/);
  assert.match(designCss({ ...DEFAULT_DESIGN, gridStyle: "tiles" }), /#grid\.tiles\{display:grid/);
  assert.match(designCss({ ...DEFAULT_DESIGN, header: "centered" }), /\.hhead\{flex-basis:100%/);
  assert.match(designCss({ ...DEFAULT_DESIGN, rowHeight: 330 }), /--row-h-tablet:260/);
  assert.match(designCss({ ...DEFAULT_DESIGN, radius: 8 }), /--radius:8px/);
});

test("custom CSS is appended last and scoped", () => {
  const css = designCss({ ...DEFAULT_DESIGN, customCss: ".cell{opacity:.9}" });
  assert.ok(css.endsWith(":where(#app,#lb) .cell{opacity:.9}"));
  assert.doesNotMatch(css, /</);
});

test("contrast warnings", () => {
  assert.deepEqual(designWarnings(DEFAULT_DESIGN), []);
  assert.equal(designWarnings({ ...DEFAULT_DESIGN, background: "#777777", text: "#888888" }).length >= 1, true);
  assert.ok(designWarnings({ ...DEFAULT_DESIGN, theme: "system", background: "#faf5ec" }).some((w) => /light appearance/.test(w)));
  assert.ok(contrast("#000000", "#ffffff") > 20.9);
});

test("font links come only from the catalogue", () => {
  assert.equal(fontLink({ ...DEFAULT_DESIGN, font: "system-sans" }), "");
  const l = fontLink({ ...DEFAULT_DESIGN, font: "lora" });
  assert.match(l, /family=Lora:wght@/);
  for (const f of FONTS) assert.match(fontLink({ ...DEFAULT_DESIGN, font: f.id }), f.google ? /^<link rel="preconnect"/ : /^$/);
  assert.equal(fontHref({ font: "nonsense" }), fontHref(DEFAULT_DESIGN), "unknown font falls back to the default");
});

test("design files round-trip", () => {
  const d = { ...DEFAULT_DESIGN, theme: "dark", gap: 6, customCss: ".cell{opacity:.9}" };
  const text = serializeDesignFile(d);
  assert.deepEqual(parseDesignFile(text), d);
  const o = JSON.parse(text);
  assert.equal(o.format, "immichset-design");
  assert.equal(o.version, 5);
});

test("design files are checked", () => {
  const good = JSON.parse(serializeDesignFile(DEFAULT_DESIGN));
  const t = (o) => JSON.stringify(o);
  assert.throws(() => parseDesignFile("{nope"), /not valid JSON/);
  assert.throws(() => parseDesignFile(t({ ...good, format: "other" })), /not an immichset/);
  assert.throws(() => parseDesignFile(t({ ...good, version: 6 })), /newer version/);
  assert.throws(() => parseDesignFile(t({ ...good, version: 0 })), /version/);
  assert.throws(() => parseDesignFile(t({ ...good, extra: 1 })), /unexpected/);
  assert.throws(() => parseDesignFile(t({ ...good, design: { ...good.design, gap: 999 } })), /between/);
  assert.throws(() => parseDesignFile(t({ ...good, design: { ...good.design, customCss: "@import 'x';" } })), /Custom CSS/);
  assert.throws(() => parseDesignFile("x".repeat(DESIGN_FILE_MAX_BYTES + 1)), /too large/);
  assert.throws(() => parseDesignFile(null), /too large/);
});

test("the catalogue and enums line up", () => {
  assert.deepEqual(ENUMS.font, FONTS.map((f) => f.id));
  assert.ok(FONTS.every((f) => f.stack && f.name));
  assert.deepEqual(Object.keys(THEMES), ["light", "dark"]);
});

test("the page's font block is exactly the default font link, between markers", () => {
  const m = page.match(/<!--ims:font-->([\s\S]*?)<!--\/ims:font-->/);
  assert.ok(m, "font markers are missing from web/index.html");
  assert.equal(m[1].trim(), fontLink(DEFAULT_DESIGN));
  assert.equal(page.split("<!--ims:font-->").length, 2);
});

test("themed surfaces on the page use variables, not fixed light colours", () => {
  const rule = (sel) => page.match(new RegExp(`(?:^|\\n)${sel.replace(/[.+]/g, "\\$&")}\\{[^}]*\\}`))[0];
  assert.doesNotMatch(rule("header"), /rgba\(255,255,255/);
  assert.doesNotMatch(rule(".cell"), /#f2f2f2/);
  assert.doesNotMatch(rule(".dlpop"), /background:#fff|color:#1a1a1a/);
  assert.doesNotMatch(rule(".gate-box button"), /color:#fff/);
  assert.doesNotMatch(rule("#toTop"), /rgba\(255,255,255/);
  assert.match(rule(".cell"), /border-radius:var\(--radius\)/);
});

test("the page has the hooks designCss targets", () => {
  for (const id of ['id="app"', 'id="lb"', 'id="cover"', 'id="grid"']) assert.ok(page.includes(id), id);
  assert.match(page, /\.hwrap\{/);
  assert.match(page, /\.htitle\{/);
});

/* ---- cover layouts, typography, presets (design version 2) ---- */
import { COVER_LAYOUTS, COLOR_PRESETS, TYPE_PRESETS, COVER_CSS } from "../design.mjs";

test("new settings default to today's look and are validated", () => {
  for (const [k, v] of Object.entries({ coverLayout: "center", titleFont: "body", titleCase: "upper", titleWeight: 700, titleTracking: 0.085, titleSize: 100, navStyle: "icons" }))
    assert.equal(DEFAULT_DESIGN[k], v, k);
  assert.ok(normaliseDesign({ coverLayout: "spiral" }).errors.coverLayout);
  assert.ok(normaliseDesign({ titleFont: "comic" }).errors.titleFont);
  assert.deepEqual(normaliseDesign({ titleFont: "lora", titleTracking: 0.125, gridStyle: "columns" }).errors, {});
  assert.ok(normaliseDesign({ titleWeight: 450 }).errors.titleWeight === undefined, "weights are not forced onto the step; only the range applies");
  assert.ok(normaliseDesign({ titleWeight: 250 }).errors.titleWeight);
  assert.ok(normaliseDesign({ titleSize: 2.5 }).errors.titleSize);
});

test("every preset is valid; every colour preset reads well", () => {
  for (const p of [...COLOR_PRESETS, ...TYPE_PRESETS]) assert.deepEqual(normaliseDesign(p.set, { partial: true }).errors, {}, p.id);
  for (const p of COLOR_PRESETS) {
    const w = designWarnings({ ...DEFAULT_DESIGN, ...p.set }).filter((x) => !/light appearance/.test(x));
    assert.deepEqual(w, [], `${p.id}: ${w.join(" ")}`);
  }
  assert.deepEqual(TYPE_PRESETS[0].set, { font: "montserrat", titleFont: "body", titleCase: "upper", titleWeight: 700, titleTracking: 0.085, titleSize: 100 }, "the first type preset is today's look");
});

test("the title rules are written only when they differ from the original", () => {
  const base = designCss(DEFAULT_DESIGN);
  for (const re of [/font-family:'?Playfair|text-transform:none|font-weight:|letter-spacing:|font-size:calc|#grid\.columns/]) assert.doesNotMatch(base, re);
  assert.match(designCss({ ...DEFAULT_DESIGN, titleFont: "playfair-display" }), /\.cover-inner h1,\.htitle\{font-family:'Playfair Display'/);
  assert.match(designCss({ ...DEFAULT_DESIGN, titleCase: "none" }), /text-transform:none/);
  assert.match(designCss({ ...DEFAULT_DESIGN, titleWeight: 300 }), /\.cover-inner h1\{font-weight:300\}/);
  assert.match(designCss({ ...DEFAULT_DESIGN, titleTracking: 0.2 }), /letter-spacing:0\.2em/);
  assert.match(designCss({ ...DEFAULT_DESIGN, titleSize: 120 }), /clamp\(30px,6\.2vw,62px\)\*1\.2/);
  assert.match(designCss({ ...DEFAULT_DESIGN, navStyle: "icons" }), /\.hbtn span\{display:none\}/);
  assert.doesNotMatch(designCss({ ...DEFAULT_DESIGN, navStyle: "text" }), /\.hbtn span/);
  assert.match(designCss({ ...DEFAULT_DESIGN, gridStyle: "columns" }), /#grid\.columns\{display:flex/);
});

test("the font link follows the body and title fonts, and the default is unchanged", () => {
  assert.equal(fontHref(DEFAULT_DESIGN), "https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap");
  const two = fontHref({ ...DEFAULT_DESIGN, font: "lora", titleFont: "playfair-display" });
  assert.match(two, /family=Lora:wght@[^&]+&family=Playfair\+Display:wght@[^&]+&display=swap$/);
  assert.equal(fontHref({ ...DEFAULT_DESIGN, font: "lora", titleFont: "lora" }).split("family=").length, 2, "the same font twice is asked for once");
  assert.equal(fontHref({ ...DEFAULT_DESIGN, font: "system-sans", titleFont: "system-serif" }), "");
  assert.match(fontHref({ ...DEFAULT_DESIGN, font: "system-sans", titleFont: "lora" }), /family=Lora/);
});

test("cover layouts: one rule set each, none for the original, none when there is no cover", () => {
  assert.deepEqual(COVER_LAYOUTS.map((l) => l.id), ["center", "left", "split", "classic", "frame", "lines", "divider", "journal", "inset", "box"]);
  const allowed = /#cover|\.bg|\.scrim|\.cover-inner|\.cover-cta|\.cover-mark|h1/;
  for (const l of COVER_LAYOUTS) {
    const css = designCss({ ...DEFAULT_DESIGN, coverLayout: l.id });
    if (l.id === "center") { assert.equal(COVER_CSS.center, undefined); assert.equal(isDefaultDesign({ ...DEFAULT_DESIGN, coverLayout: "center" }), true); continue; }
    assert.ok(COVER_CSS[l.id], l.id);
    assert.ok(css.includes(COVER_CSS[l.id]), `${l.id} is emitted`);
    assert.doesNotMatch(COVER_CSS[l.id], /url\(|</, `${l.id} loads nothing`);
    for (const sel of COVER_CSS[l.id].match(/[^{}]+(?=\{)/g).filter((x) => !x.startsWith("@media"))) assert.match(sel, allowed, `${l.id}: ${sel}`);
    assert.equal(designCss({ ...DEFAULT_DESIGN, coverLayout: l.id, cover: "none" }).includes(COVER_CSS[l.id]), false, `${l.id} is dropped with no cover`);
    assert.equal(isDefaultDesign({ ...DEFAULT_DESIGN, coverLayout: l.id }), false);
  }
});

test("the page has every hook the cover layouts use", () => {
  for (const hook of ['id="cover"', 'class="bg" id="coverBg"', 'class="scrim"', 'class="cover-inner"', 'class="cover-cta"', 'class="cover-mark"'])
    assert.ok(page.includes(hook), hook);
});

test("a version 1 design file still imports, and gets the new settings' defaults", () => {
  const { coverLayout, titleFont, titleCase, titleWeight, titleTracking, titleSize, navStyle, coverMotion, slideshow, favourites, photoCount, ...old } = DEFAULT_DESIGN;
  const v1 = JSON.stringify({ format: "immichset-design", version: 1, design: { ...old, gap: 4 } });
  const d = parseDesignFile(v1);
  assert.equal(d.gap, 4); assert.equal(d.coverLayout, "center"); assert.equal(d.titleSize, 100);
  assert.throws(() => parseDesignFile(JSON.stringify({ format: "immichset-design", version: 6, design: old })), /newer version/);
});

test("the cover animation switch defaults to on, validates, and only writes CSS when off", () => {
  assert.equal(DEFAULT_DESIGN.coverMotion, "on");
  assert.ok(normaliseDesign({ coverMotion: "slow" }).errors.coverMotion);
  assert.deepEqual(normaliseDesign({ coverMotion: "off" }).errors, {});
  assert.doesNotMatch(designCss(DEFAULT_DESIGN), /transition:none/);
  const off = designCss({ ...DEFAULT_DESIGN, coverMotion: "off" });
  assert.match(off, /#cover \.bg\{transition:none;transform:none\}\.cover-inner\{transition:none;transform:none\}/);
  assert.doesNotMatch(off, /\.cell img/, "the photos in the grid are untouched");
  assert.equal(isDefaultDesign({ ...DEFAULT_DESIGN, coverMotion: "off" }), false);
});

test("slideshow and favourites switches default to on, validate, and only write CSS when off", () => {
  assert.equal(DEFAULT_DESIGN.slideshow, "on"); assert.equal(DEFAULT_DESIGN.favourites, "on");
  assert.ok(normaliseDesign({ slideshow: "maybe" }).errors.slideshow);
  assert.ok(normaliseDesign({ favourites: false }).errors.favourites);
  assert.deepEqual(normaliseDesign({ slideshow: "off", favourites: "off" }).errors, {});
  const base = designCss(DEFAULT_DESIGN);
  assert.doesNotMatch(base, /btnSlides|btnFav|\.heart/);
  const show = designCss({ ...DEFAULT_DESIGN, slideshow: "off" });
  assert.match(show, /#btnSlides\{display:none!important\}/); assert.doesNotMatch(show, /btnFav|\.heart/);
  const fav = designCss({ ...DEFAULT_DESIGN, favourites: "off" });
  assert.match(fav, /#btnFav,\.heart,#lbFav\{display:none!important\}/); assert.doesNotMatch(fav, /btnSlides/);
  assert.equal(isDefaultDesign({ ...DEFAULT_DESIGN, favourites: "off" }), false);
});

test("the page has the elements the slideshow and favourites switches hide", () => {
  for (const id of ['id="btnSlides"', 'id="btnFav"', 'id="lbFav"']) assert.ok(page.includes(id), id);
  assert.match(page, /\.heart\{position:absolute/);
});

test("the photo count switch defaults to on, validates, and hides only the count when off", () => {
  assert.equal(DEFAULT_DESIGN.photoCount, "on");
  assert.ok(normaliseDesign({ photoCount: "few" }).errors.photoCount);
  assert.deepEqual(normaliseDesign({ photoCount: "off" }).errors, {});
  assert.doesNotMatch(designCss(DEFAULT_DESIGN), /hCount/);
  const off = designCss({ ...DEFAULT_DESIGN, photoCount: "off" });
  assert.match(off, /#hCount\{display:none!important\}/);
  assert.doesNotMatch(off, /btnSlides|btnFav|\.heart/, "the buttons are untouched");
  assert.ok(page.includes('id="hCount"'), "the page has the count this hides");
});
