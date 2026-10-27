# Website Builder (Pages, Blocks, Visual Editor, Animations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the admin panel's Website section into a block-based page builder: pages made of blocks, a full-screen visual editor with a live preview and an autosaved draft, and entrance, hover and parallax animations, while the published site stays static on Cloudflare Pages and an unmigrated site builds byte-for-byte as it does today.

**Architecture:** Pages live in the website store as `s:pages` (null until first saved) with their own revision counter `_pagesRev`, so photo uploads never make the editor's draft stale. `site/pages.mjs` turns the old settings into pages on the fly (non-destructive migration), keeps gallery pages in step with the galleries, and validates saved pages. One module per block type under `site/blocks/` exports `type, label, icon, sketch, defaults, fields, validate, render, nestable`; `site/build.mjs` stays pure and renders pages by calling the registry. Animation and block CSS (`site/assets/blocks.css`) and the IntersectionObserver script (`site/assets/motion.js`) are appended to `style.css`/`site.js` only once pages have been saved, so a never-edited site's output is unchanged. The editor (`web/builder-admin.js`) renders unsaved pages through `POST /api/admin/site/render` into an `iframe srcdoc`, and autosaves to `PUT /api/admin/site/pages`; Publish and version restore keep using the existing routes.

**Checked:** the code in Tasks 1–13 was assembled against the current tree in a scratch copy: every test under `site/test` and `design/test/css.test.mjs` passes, including the golden byte-identity test, and both admin scripts pass `node --check`.

**Tech Stack:** Node (v26) ESM built-ins only (`node:sqlite`, `node:test`, `node:vm`, `node:fs`), no dependencies, no build step. Admin UI is classic browser scripts using `window.AdminKit`.

## Global Constraints

Copied from the spec (`docs/superpowers/specs/2026-10-27-website-builder-design.md`):

- The published site stays static on Cloudflare Pages.
- `page = { id, title, slug, inMenu, seoTitle, seoDescription, blocks: block[] }`; `block = { id, type, props, style, motion }`.
- `style` is shared by every block: background colour or photo, padding, alignment, width (full or contained), and visibility at phone and desktop. `motion` is shared by every block. `props` is specific to the block type and validated by that type's schema.
- Slugs may not collide with the existing reserved paths in `site/store.mjs` or with a gallery slug.
- On first load of a site without `pages`, they are generated from the current state: Home becomes a gallery-cards block; each visible gallery becomes a page holding a photo-grid block; About becomes an image-and-text block; Contact becomes a banner block plus a contact-details block. Output for an unmigrated site must be byte-identical to today's (tested). Old settings fields are kept, so restoring an earlier published version works.
- Blocks (first round): Hero/banner, heading, rich text, image, image and text, gallery cards, photo grid (masonry), button, spacer/divider, columns (2 or 3, each holding blocks), contact details, embed (YouTube/Vimeo URL or map), custom HTML.
- Each block type is one module exporting: `type`, `defaults`, `validate(props)`, `render(block, ctx)` and an editor form description.
- Entrance: none, fade, slide up/down/left/right, zoom in, blur-in. Duration, delay, and once-or-every-time-in-view. Background: none or parallax. Per image-bearing block: hover effect (none, zoom, lift, darken, caption reveal). Per button: hover effect (fill, lift, glow).
- Animations: CSS classes and custom properties emitted by the builder, plus a small IntersectionObserver script. Animations are skipped under `prefers-reduced-motion`, and content is visible without JavaScript (the hidden initial state is only applied once the script has loaded). Only transform and opacity are animated.
- Editor: full-screen, in the style of `web/design-admin.js`; left rail with pages (add, rename, duplicate, delete, reorder, menu visibility, SEO fields) and the current page's block outline (drag to reorder, duplicate, delete, hide); centre live preview at phone, tablet and desktop, click a block to select it; right panel with the selected block's content, style and motion; add-block picker with a preview of each type; autosaved draft with undo and redo; the public site changes only on **Publish**; existing version history and restore are unchanged.
- `site/build.mjs` stays a pure function: state in, files out. All text is escaped, URLs are checked to be http(s), mailto or tel. Custom HTML and any custom CSS go through a sanitiser with the same rules as gallery custom CSS (`design/css.mjs`); scripts, inline event handlers and `javascript:` URLs are removed. Uploaded images use the existing photo pipeline and Immich album sync.
- Out of scope: free-form pixel positioning, a multi-language site, e-commerce, blog, theme, header/menu editor, whole-site zip upload, theme packages (roadmap pieces 3 and 4).

Repo rules that apply to every task:

- No dependencies, no build step, Node built-ins only (RUNBOOK "Three files, no dependencies").
- Full test command: `node --test admin/test health/test zip/test mail/test config/test design/test setup/test site/test`. `node --test <dir>` only runs `*.test.mjs` files (checked), so helper modules under `site/test/` are safe.
- Commit messages describe the change only; no mention of who asked, no AI or Co-Authored-By lines. Commit only after the user approves. Never push.
- Do not write markdown links in docs (the docs test checks every relative link under `docs/`).

---

## File Structure

| File | Responsibility |
|---|---|
| `site/test/fixtures.mjs` (new) | The shared test site (`state()`, `ph()`), identical to the one in `build.test.mjs`. |
| `site/test/golden/cases.mjs` (new) | The four sites the golden test builds. |
| `site/test/golden/capture.mjs` (new) | One-off script that records today's build output to `legacy.json`; refuses to overwrite. |
| `site/test/golden/legacy.json` (new, generated) | Today's build output, captured before `build.mjs` changes. |
| `site/test/golden.test.mjs` (new) | An unmigrated site builds exactly as recorded. |
| `site/sanitize.mjs` (new) | `sanitizeHtml(src, mode)`, `decodeEntities(s)`, `safeUrl(u)`. |
| `design/css.mjs` (modify) | `compileCustomCss(src, { scope })`: the scope becomes an option. |
| `site/blocks/common.mjs` (new) | Escaping, `cleanFields` (validates props from a form description), style and motion schemas/defaults/cleaners, the `wrap` that emits style/motion classes, `linkHref`, hover option lists. |
| `site/blocks/registry.mjs` (new) | `BLOCK_TYPES`, `listBlockTypes`, `validateBlock(s)`, `renderBlock(s)`, `countBlocks`. |
| `site/blocks/heading.mjs`, `rich-text.mjs`, `button.mjs`, `spacer.mjs` (new) | Text blocks. |
| `site/blocks/hero.mjs`, `image.mjs`, `image-text.mjs`, `gallery-cards.mjs`, `photo-grid.mjs` (new) | Photo blocks; the legacy pages' markup lives here. |
| `site/blocks/columns.mjs`, `contact.mjs`, `embed.mjs`, `custom-html.mjs` (new) | Layout, contact, embed and custom HTML blocks. |
| `site/test/block-helpers.mjs` (new) | `blockCtx()` and `mk()` for block unit tests. |
| `site/pages.mjs` (new) | `migratePages`, `galleryPage`, `resolvePages`, `cleanPages`, `isShownPage`, `pageHref`, limits. |
| `site/assets/blocks.css` (new) | Block layout, wrapper style classes, entrance/hover CSS, reduced-motion rules. |
| `site/assets/motion.js` (new) | IntersectionObserver entrances and parallax. |
| `site/assets/edit-bridge.js` (new) | Editor-only preview script: click to select, scroll sync. |
| `site/build.mjs` (modify) | Renders pages through the registry; menu from pages; editor mode; appends blocks.css/motion.js once pages are saved. |
| `site/store.mjs` (modify) | `getPages`, `putPages`, `discardPages`, `pagesRev`; pages in `snapshot`/`restoreSnapshot`; `slugFor` avoids page slugs. |
| `site/routes.mjs` (modify) | `GET /api/admin/site` gains pages; `GET /blocks`, `PUT /pages`, `POST /pages/discard`, `POST /render`; body limits; error lists. |
| `web/builder-admin.js` (new) | The full-screen page editor. |
| `web/site-admin.js` (modify) | Pages tab opens the editor; `window.WebsiteKit.upload`; closes the editor when leaving. |
| `web/admin.html` (modify) | Loads `/builder-admin.js`. |
| `deploy.sh` (modify) | Copies the new files. |
| `README.md`, `RUNBOOK.md` (modify) | Public website section; file table. |
| Tests (new): `site/test/sanitize.test.mjs`, `blocks-text.test.mjs`, `blocks-photo.test.mjs`, `blocks-layout.test.mjs`, `pages.test.mjs`, `motion.test.mjs`, `build-pages.test.mjs`, `store-pages.test.mjs`, `builder-routes.test.mjs`, `builder-ui.test.mjs`, `deploy-files.test.mjs`; `design/test/css.test.mjs` (modify). |

NOTICE stays unchanged: no third-party code or icons are added (block icons reuse Lucide shapes already embedded in `web/admin.html` and credited).

---

### Task 1: Golden record of today's build

Capture what the current `build.mjs` produces before anything changes, so every later task is held to byte-identical output for sites that never used the editor.

**Files:**
- Create: `site/test/fixtures.mjs`
- Create: `site/test/golden/cases.mjs`
- Create: `site/test/golden/capture.mjs`
- Create (generated): `site/test/golden/legacy.json`
- Test: `site/test/golden.test.mjs`

**Interfaces:**
- Consumes: `build(state, { base, siteUrl })` from `site/build.mjs` (unchanged); `DEFAULTS` from `site/store.mjs`.
- Produces: `state(over)` and `ph(id, key, galleryId)` from `site/test/fixtures.mjs`; `CASES` (`{ name: [make: () => state, opts] }`) from `site/test/golden/cases.mjs`; `site/test/golden/legacy.json` (`{ name: { files: {path: content}, images: [[rel, rel]] } }`).

- [ ] **Step 1: Write the shared fixture**

`site/test/fixtures.mjs`:

```js
/* The small test website every site test builds: three galleries (one hidden, one empty) and two page photos.
   Identical to the one in build.test.mjs. */
import { DEFAULTS } from '../store.mjs';

export const ph = (id, key, galleryId) => ({ id, galleryId, position: id, fileKey: key, width: 2048, height: 1365, originalName: '', immichStatus: 'ok', createdAt: 0 });

export function state(over = {}) {
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
```

`site/test/golden/cases.mjs`:

```js
/* The sites the golden test builds: everything set, a live site with a logo, the admin preview, and a bare site. */
import { state } from '../fixtures.mjs';

const withLogo = () => { const s = state(); s.settings.style = { ...s.settings.style, logo: 'logo.svg' }; return s; };
const sparse = () => {
  const s = state();
  s.settings.siteName = '';
  s.settings.about = { heading: 'About', text: '', photoId: null };
  s.settings.contact = { heading: 'Contact us', bannerPhotoId: null, email: '', phone: '' };
  s.settings.footer = { copyright: '', instagram: '' };
  for (const g of s.galleries) g.hidden = true;
  return s;
};

export const CASES = {
  full: [() => state(), {}],
  live: [withLogo, { siteUrl: 'https://example.com' }],
  preview: [() => state(), { base: '/admin/site-preview/' }],
  sparse: [sparse, {}],
};
```

- [ ] **Step 2: Write the failing golden test**

`site/test/golden.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../build.mjs';
import { CASES } from './golden/cases.mjs';

/* recorded by golden/capture.mjs from the builder as it was before pages and blocks existed */
const want = JSON.parse(readFileSync(new URL('./golden/legacy.json', import.meta.url), 'utf8'));

test('a site that never saved pages builds exactly as before, file for file and image for image', () => {
  assert.deepEqual(Object.keys(want).sort(), Object.keys(CASES).sort());
  for (const [name, [make, opts]] of Object.entries(CASES)) {
    const { files, images } = build(make(), opts);
    assert.deepEqual(Object.fromEntries([...files].sort()), want[name].files, name);
    assert.deepEqual([...images].sort(), want[name].images, name);
  }
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --test site/test/golden.test.mjs`
Expected: FAIL with `ENOENT: no such file or directory, open '.../site/test/golden/legacy.json'`.

- [ ] **Step 4: Write the capture script and capture today's output**

`site/test/golden/capture.mjs`:

```js
/* Run once, before build.mjs learns about pages:  node site/test/golden/capture.mjs
   Records what today's builder makes for each case in cases.mjs, so the page-based builder can be held to it.
   It refuses to overwrite: the record must stay what the old builder made. */
import { writeFileSync, existsSync } from 'node:fs';
import { build } from '../../build.mjs';
import { CASES } from './cases.mjs';

const out = new URL('./legacy.json', import.meta.url);
if (existsSync(out)) { console.error('legacy.json already exists and must not change'); process.exit(1); }
const all = {};
for (const [name, [make, opts]] of Object.entries(CASES)) {
  const { files, images } = build(make(), opts);
  all[name] = { files: Object.fromEntries([...files].sort()), images: [...images].sort() };
}
writeFileSync(out, JSON.stringify(all, null, 1) + '\n');
console.log('wrote', out.pathname);
```

Run: `git diff --quiet site/build.mjs site/assets && node site/test/golden/capture.mjs`
Expected: prints `wrote .../site/test/golden/legacy.json` (the `git diff --quiet` guard proves `build.mjs` and the assets are untouched).

- [ ] **Step 5: Run the golden test to see it pass**

Run: `node --test site/test/golden.test.mjs site/test/build.test.mjs`
Expected: PASS (all tests).

- [ ] **Step 6: Commit (commit only after the user approves)**

```bash
git add site/test/fixtures.mjs site/test/golden/cases.mjs site/test/golden/capture.mjs site/test/golden/legacy.json site/test/golden.test.mjs
git commit -m "Website: record today's build output as a golden test"
```

---

### Task 2: HTML sanitiser, URL check, scoped custom CSS

**Files:**
- Create: `site/sanitize.mjs`
- Modify: `design/css.mjs` (functions `complexSelector`, `selectorList`, `rules`, `compileCustomCss`)
- Test: `site/test/sanitize.test.mjs`, `design/test/css.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `decodeEntities(s: string) => string`
  - `safeUrl(u: unknown) => string` — the URL if it is `http(s)://…`, `mailto:…` or `tel:…` (digits, `+().-`), else `''`.
  - `sanitizeHtml(src: unknown, mode: 'rich' | 'custom') => string`
  - `compileCustomCss(src, { scope = SCOPE } = {}) => { css, error }` (default behaviour unchanged).

- [ ] **Step 1: Write the failing tests**

`site/test/sanitize.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml, safeUrl, decodeEntities } from '../sanitize.mjs';

test('URLs: only http(s), mailto and tel, however they are disguised', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl(' mailto:someone@example.com '), 'mailto:someone@example.com');
  assert.equal(safeUrl('tel:+1(555)010-0100'), 'tel:+1(555)010-0100');
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', '&#106;avascript:alert(1)', 'java\tscript:x', 'data:text/html,x',
                     '//evil.example', '/relative', 'https://exa mple.com', 'https://x"onmouseover=1', 'tel:555 0100', 'vbscript:x', ''])
    assert.equal(safeUrl(bad), '', bad);
});

test('entities decode, including numeric ones, and unknown names are left alone', () => {
  assert.equal(decodeEntities('&lt;b&gt; &amp; &#106;&#x41; &nbsp;&copy;'), '<b> & jA  &copy;');
});

test('scripts, styles and frames go with their content; handlers and style attributes go', () => {
  const out = sanitizeHtml('<p onclick="x()" style="color:red">Hi<script>alert(1)</script></p><style>p{}</style><iframe src="https://x"></iframe><svg><script>1</script></svg>ok', 'custom');
  assert.equal(out, '<p>Hi</p>ok');
});

test('links keep only safe addresses, and new-tab links get rel', () => {
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>', 'rich'), '<a>x</a>');
  assert.equal(sanitizeHtml('<a href="&#106;avascript:alert(1)">x</a>', 'rich'), '<a>x</a>');
  assert.equal(sanitizeHtml('<a href="https://e.com" target="_blank" rel="opener">x</a>', 'rich'),
    '<a href="https://e.com" target="_blank" rel="noopener noreferrer">x</a>');
  assert.equal(sanitizeHtml('<a href=https://e.com/?a=1&amp;b=2>x</a>', 'rich'), '<a href="https://e.com/?a=1&amp;b=2">x</a>');
});

test('unknown tags are dropped but their text is kept; images are not allowed', () => {
  assert.equal(sanitizeHtml('<foo><b>bold</b></foo><img src="https://x/y.jpg" onerror="z">', 'custom'), '<b>bold</b>');
});

test('rich mode allows less than custom mode', () => {
  assert.equal(sanitizeHtml('<div><table><tr><td>x</td></tr></table></div>', 'rich'), 'x');
  assert.equal(sanitizeHtml('<div><table><tr><td colspan="2">x</td></tr></table></div>', 'custom'), '<div><table><tr><td colspan="2">x</td></tr></table></div>');
});

test('tags are balanced, stray closers dropped, comments removed, text escaped', () => {
  assert.equal(sanitizeHtml('<b>open <i>both', 'rich'), '<b>open <i>both</i></b>');
  assert.equal(sanitizeHtml('</p>x</b>', 'rich'), 'x');
  assert.equal(sanitizeHtml('a <!-- <script>alert(1)</script> --> b', 'rich'), 'a  b');
  assert.equal(sanitizeHtml('1 < 2 & 3 > 2', 'rich'), '1 &lt; 2 &amp; 3 &gt; 2');
  assert.equal(sanitizeHtml('<p title="a&quot;b">x</p>', 'rich'), '<p title="a&quot;b">x</p>');
  assert.equal(sanitizeHtml('<b>unfinished <i', 'rich'), '<b>unfinished </b>');
});

test('class values are limited to plain names', () => {
  assert.equal(sanitizeHtml('<p class="lead big">x</p><p class="a&quot;onclick=1">y</p>', 'custom'), '<p class="lead big">x</p><p>y</p>');
});

test('sanitising twice changes nothing', () => {
  const once = sanitizeHtml('<p>A &amp; B&nbsp;<a href="https://e.com" target="_blank">l</a><b>x', 'rich');
  assert.equal(sanitizeHtml(once, 'rich'), once);
});
```

Append to `design/test/css.test.mjs`:

```js
test("a different scope can be given, for website blocks", () => {
  assert.equal(compileCustomCss("p{color:red}", { scope: "#b-x1" }).css, "#b-x1 p{color:red}");
  assert.equal(compileCustomCss(":root{--a:1}", { scope: "#b-x1" }).css, "#b-x1{--a:1}");
  assert.equal(compileCustomCss("a:is(.x,.y){color:red}", { scope: "#b-x1" }).css, "#b-x1 a:is(.x,.y){color:red}");
  assert.equal(compileCustomCss("p{color:red}").css, `${SCOPE} p{color:red}`, "the gallery scope is still the default");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test site/test/sanitize.test.mjs design/test/css.test.mjs`
Expected: FAIL — `Cannot find module '.../site/sanitize.mjs'`, and the new css test fails with `':where(#app,#lb) p{color:red}' !== '#b-x1 p{color:red}'`.

- [ ] **Step 3: Write the sanitiser**

`site/sanitize.mjs`:

```js
/* HTML sanitiser for the website's rich text and custom HTML blocks. Splits the source into tags and text, keeps only
   allow-listed tags and attributes, checks every link, and writes the result out from the parsed pieces, never from the
   source, so nothing that was not allowed can come out. The same idea as design/css.mjs. Pure. */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�';
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/* Links on the website may only be web pages, email addresses and phone numbers. */
const URL_OK = /^(?:https?:\/\/[^\s"'<>\\]+|mailto:[^\s"'<>\\]+|tel:\+?[0-9().-]+)$/i;
export function safeUrl(u) {
  const s = decodeEntities(String(u ?? '')).trim();
  if (s.length > 2000 || /[\u0000-\u001f\u007f]/.test(s)) return '';
  return URL_OK.test(s) ? s : '';
}

const escText = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const escAttr = t => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const RICH = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'span'];
const TAGS = {
  rich: new Set(RICH),
  custom: new Set([...RICH, 'div', 'section', 'h1', 'h5', 'h6', 'hr', 'figure', 'figcaption', 'small', 'sup', 'sub',
                   'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre']),
};
const VOID = new Set(['br', 'hr']);
/* containers whose content is code or would load something: dropped together with everything inside */
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'applet', 'template', 'noscript', 'textarea', 'title',
  'svg', 'math', 'select', 'xmp', 'plaintext', 'noembed', 'noframes']);
const GLOBAL_ATTRS = new Set(['class', 'title']);
const TAG_ATTRS = { a: new Set(['href', 'target', 'rel']), td: new Set(['colspan', 'rowspan']), th: new Set(['colspan', 'rowspan']) };
const CLASS_OK = /^[A-Za-z0-9 _-]{0,200}$/;
const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;

/* index of the ">" that ends the tag whose attributes start at k, skipping quoted values; -1 if there is none */
function tagEnd(s, k) {
  let q = null;
  for (; k < s.length; k++) {
    const c = s[k];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '>') return k;
  }
  return -1;
}

function attrs(tag, src) {
  const kept = new Map();
  for (const m of src.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (kept.has(name) || !(GLOBAL_ATTRS.has(name) || TAG_ATTRS[tag]?.has(name))) continue;
    const v = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
    if (name === 'class') { if (CLASS_OK.test(v) && v.trim()) kept.set(name, v.trim()); }
    else if (name === 'href') { const u = safeUrl(v); if (u) kept.set(name, u); }
    else if (name === 'target') { if (v === '_blank') kept.set(name, v); }
    else if (name === 'rel') { /* written below, never taken from the source */ }
    else if (name === 'colspan' || name === 'rowspan') { if (/^[1-9][0-9]?$/.test(v)) kept.set(name, v); }
    else kept.set(name, v.slice(0, 300));
  }
  if (tag === 'a' && kept.get('target') === '_blank') kept.set('rel', 'noopener noreferrer');
  return [...kept].map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
}

export function sanitizeHtml(src, mode = 'rich') {
  const allow = TAGS[mode];
  if (!allow) throw new Error(`unknown sanitiser mode ${mode}`);
  const s = String(src ?? '');
  const lower = s.toLowerCase();
  const open = [];
  let i = 0, out = '';
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { out += escText(decodeEntities(s.slice(i))); break; }
    if (lt > i) out += escText(decodeEntities(s.slice(i, lt)));
    i = lt;
    if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); i = e < 0 ? s.length : e + 3; continue; }
    if (s[i + 1] === '!' || s[i + 1] === '?') { const e = s.indexOf('>', i); i = e < 0 ? s.length : e + 1; continue; }
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(s.slice(i, i + 64));
    if (!m) { out += '&lt;'; i++; continue; }
    const end = tagEnd(s, i + m[0].length);
    if (end < 0) break;                                   /* an unfinished tag at the very end is dropped */
    const name = m[2].toLowerCase(), closing = m[1] === '/';
    const attrSrc = s.slice(i + m[0].length, end);
    i = end + 1;
    if (!closing && DROP.has(name)) {
      const close = lower.indexOf(`</${name}`, i);
      if (close < 0) { i = s.length; continue; }
      const e = tagEnd(s, close + name.length + 2);
      i = e < 0 ? s.length : e + 1;
      continue;
    }
    if (!allow.has(name)) continue;
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at < 0) continue;
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }
    out += `<${name}${attrs(name, attrSrc)}>`;
    if (!VOID.has(name)) open.push(name);
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}
```

- [ ] **Step 4: Make the CSS scope an option**

In `design/css.mjs`:

Replace the signature line `function complexSelector(toks, nested) {` with `function complexSelector(toks, nested, scope = SCOPE) {`. Inside it, replace `if (n) { out.push(SCOPE); rooted = true; k = n; }` with `if (n) { out.push(scope); rooted = true; k = n; }`, replace `out.push(`:${lc}(${selectorList(inner, true)})`);` with ``out.push(`:${lc}(${selectorList(inner, true, scope)})`);``, and replace the final `return (rooted || nested ? '' : SCOPE + ' ') + out.join('');` with `return (rooted || nested ? '' : scope + ' ') + out.join('');`.

Replace `selectorList`:

```js
function selectorList(toks, nested = false, scope = SCOPE) {
  return splitCommas(toks).map((p) => complexSelector(p, nested, scope)).join(',');
}
```

In `rules`, change the signature to `function rules(toks, inAt, count, scope = SCOPE) {`, the recursive call to `const body = rules(toks.slice(open + 1, end), true, count, scope);` and the selector line to `const sel = selectorList(toks.slice(k, open), false, scope);`.

Replace the head of `compileCustomCss` and its compile line:

```js
/* Returns {css, error}. error is null or {message, line, col}; css is '' when there is an error.
   scope is the selector every rule is put under: the gallery by default, one website block for the site builder. */
export function compileCustomCss(src, { scope = SCOPE } = {}) {
```

and inside it `const css = rules(tokenize(text0), false, { rules: 0, n: 0 }, scope);`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test site/test/sanitize.test.mjs design/test`
Expected: PASS (all, including every existing design test).

- [ ] **Step 6: Commit (commit only after the user approves)**

```bash
git add site/sanitize.mjs site/test/sanitize.test.mjs design/css.mjs design/test/css.test.mjs
git commit -m "Website: HTML sanitiser and link check, and a scope option for custom CSS"
```

---

### Task 3: Block foundation and the text blocks

Shared field checker, style and motion settings, the wrapper that turns them into classes, the registry, and the heading, rich text, button and spacer blocks.

**Files:**
- Create: `site/blocks/common.mjs`, `site/blocks/registry.mjs`, `site/blocks/heading.mjs`, `site/blocks/rich-text.mjs`, `site/blocks/button.mjs`, `site/blocks/spacer.mjs`
- Create: `site/test/block-helpers.mjs`
- Test: `site/test/blocks-text.test.mjs`

**Interfaces:**
- Consumes: `sanitizeHtml`, `safeUrl` (Task 2); `compileCustomCss(src, { scope })` (Task 2); `state`, `ph` (Task 1).
- Produces (all later tasks rely on these exact names):
  - `common.mjs`: `esc(t)`, `text(v, max)`, `idOrNull(v)`, `paras(t)`, `safeUrl`, `LINK_ERROR`, `cleanFields(raw, fields, defaults, ctx) => { props, errors: {key: message} }`, `STYLE_DEFAULTS`, `STYLE_SCHEMA`, `cleanStyle(raw, ctx) => { style, errors }`, `ENTRANCES`, `MOTION_DEFAULTS`, `MOTION_SCHEMA`, `cleanMotion(raw) => { motion, errors }`, `isPlain(block)`, `wrap(block, inner, ctx) => string`, `linkHref(link, ctx) => string | null`, `HOVER_IMAGE`, `BUTTON_HOVER`.
  - Field kinds understood by `cleanFields`: `text`, `textarea`, `select`, `number`, `toggle`, `color`, `photo`, `gallery`, `galleries`, `url`, `link`, `richtext`, `html`, `css`.
  - A field description: `{ key, label, kind, max?, options?: [value, label][], min?, max?, step?, unit?, hint?, when?: [key, value | '!value'] }`.
  - Block module exports: `type`, `label`, `icon` (a name in admin.html's LUCIDE table), `sketch` (static SVG string), `defaults`, `fields`, `validate(props, ctx) => { props, errors }`, `render(block, ctx) => string`, optional `nestable = false`.
  - Render `ctx`: `{ base, editor, siteName, style, shownGalleries, cover(g), pic(photo, 'grid'|'full'), gridSize(photo), photo(id), gallery(id), pageHref(pageId), og, head, setOg(photo), addHead(html), renderBlocks }`.
  - Validate `ctx`: `{ photoIds?: Set<number>, galleryIds?: Set<number>, blockIds: Set<string>, depth: number, validateBlocks }`.
  - `registry.mjs`: `BLOCK_TYPES: Map`, `listBlockTypes() => [{ type, label, icon, sketch, defaults, fields, nestable }]`, `validateBlock(raw, ctx) => { block | null, errors: string[] }`, `validateBlocks(list, ctx) => { blocks, errors }`, `countBlocks(blocks)`, `renderBlock(block, ctx)`, `renderBlocks(list, ctx)`; re-exports `STYLE_DEFAULTS, STYLE_SCHEMA, MOTION_DEFAULTS, MOTION_SCHEMA`.
  - `block-helpers.mjs`: `blockCtx(over)`, `mk(id, type, props, style, motion)`.

- [ ] **Step 1: Write the test helpers**

`site/test/block-helpers.mjs`:

```js
/* What block tests need: a render context like the one build.mjs makes, and a quick way to make a checked block. */
import { state } from './fixtures.mjs';
import { validateBlock, renderBlocks } from '../blocks/registry.mjs';

export function blockCtx(over = {}) {
  const s = state();
  const photos = [...s.pagePhotos, ...s.galleries.flatMap(g => g.photos)];
  const byId = new Map(photos.map(p => [p.id, p]));
  const images = new Map();
  return {
    base: '/', editor: false, siteName: 'Example Studio', style: s.settings.style, images,
    shownGalleries: s.galleries.filter(g => !g.hidden && g.photos.length),
    cover: g => byId.get(g.coverPhotoId) || g.photos[0],
    pic: (p, v) => { const rel = `img/${p.fileKey}-${v}.jpg`; images.set(rel, rel); return '/' + rel; },
    gridSize: p => (p.width > 800 ? [800, Math.round(p.height * 800 / p.width)] : [p.width, p.height]),
    photo: id => (id == null ? null : byId.get(id) || null),
    gallery: id => s.galleries.find(g => g.id === id) || null,
    pageHref: id => ({ home: '/', about: '/about/', contact: '/contact/' })[id] ?? null,
    og: null, head: '',
    setOg(p) { if (p && !this.og) this.og = p; },
    addHead(h) { this.head += h; },
    renderBlocks,
    ...over,
  };
}

export function mk(id, type, props = {}, style = {}, motion = {}) {
  const r = validateBlock({ id, type, props, style, motion }, {});
  if (!r.block || r.errors.length) throw new Error(`test block ${id}: ${r.errors.join('; ')}`);
  return r.block;
}
```

- [ ] **Step 2: Write the failing tests**

`site/test/blocks-text.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_TYPES, listBlockTypes, validateBlock, validateBlocks, renderBlock } from '../blocks/registry.mjs';
import { STYLE_DEFAULTS, MOTION_DEFAULTS, cleanFields, wrap } from '../blocks/common.mjs';
import { blockCtx, mk } from './block-helpers.mjs';

test('every block module has the same shape', () => {
  for (const t of BLOCK_TYPES.values()) {
    for (const k of ['type', 'label', 'icon', 'sketch', 'defaults', 'fields']) assert.ok(t[k] !== undefined, `${t.type}.${k}`);
    assert.equal(typeof t.validate, 'function'); assert.equal(typeof t.render, 'function');
    assert.match(t.sketch, /^<svg viewBox="0 0 100 60">[\s\S]*<\/svg>$/);
    assert.doesNotMatch(t.sketch, /<path|script|on\w+=/i, `${t.type} sketch is plain shapes`);
    const r = validateBlock({ id: `d-${t.type}`, type: t.type, props: structuredClone(t.defaults) }, {});
    assert.deepEqual(r.errors, [], `${t.type} defaults are valid`);
  }
  assert.deepEqual(listBlockTypes().map(t => t.type), [...BLOCK_TYPES.keys()]);
});

test('a block gets default style and motion, and unknown keys are dropped', () => {
  const { block, errors } = validateBlock({ id: 'h1', type: 'heading', props: { text: 'Hi', extra: 1 } }, {});
  assert.deepEqual(errors, []);
  assert.deepEqual(block.style, STYLE_DEFAULTS);
  assert.deepEqual(block.motion, MOTION_DEFAULTS);
  assert.ok(!('extra' in block.props));
});

test('bad blocks are refused with a reason', () => {
  assert.match(validateBlock({ id: 'x1', type: 'nope' }, {}).errors[0], /unknown block type "nope"/);
  assert.match(validateBlock({ id: 'Bad Id', type: 'heading' }, {}).errors[0], /block id "Bad Id" is not valid/);
  const r = validateBlocks([{ id: 'a1', type: 'heading' }, { id: 'a1', type: 'spacer' }], {});
  assert.equal(r.blocks.length, 1); assert.match(r.errors[0], /used twice/);
  assert.match(validateBlock({ id: 'm1', type: 'heading', motion: { entrance: 'spin' } }, {}).errors[0], /^Heading, entrance: choose one of/);
  assert.match(validateBlock({ id: 'm2', type: 'heading', motion: { duration: 50 } }, {}).errors[0], /from 200 to 3000/);
  assert.match(validateBlock({ id: 's1', type: 'heading', style: { bgColor: 'red' } }, {}).errors[0], /six-digit colour/);
});

test('field kinds: text is trimmed and cut, photos must exist, links must be safe', () => {
  const fields = [{ key: 't', kind: 'text', max: 5 }, { key: 'p', kind: 'photo' }, { key: 'l', kind: 'link' }, { key: 'u', kind: 'url' }];
  const r = cleanFields({ t: '  abcdefgh ', p: 99, l: { kind: 'url', url: 'javascript:x' }, u: 'https://ok.example' }, fields,
    { t: '', p: null, l: { kind: 'url', url: '', pageId: '' }, u: '' }, { photoIds: new Set([1]) });
  assert.deepEqual(r.props, { t: 'abcde', p: null, l: { kind: 'url', url: '', pageId: '' }, u: 'https://ok.example' });
  assert.match(r.errors.l, /https:\/\/, http:\/\/, mailto: or tel:/);
});

test('heading: escaped, at the chosen level and size', () => {
  const b = mk('h1', 'heading', { text: 'A <b>&', level: 3, size: 'large' });
  assert.equal(renderBlock(b, blockCtx()), '<h3 class="hd hd-large">A &lt;b&gt;&amp;</h3>');
  assert.match(validateBlock({ id: 'h2', type: 'heading', props: { level: 7 } }, {}).errors[0], /^Heading, level:/);
});

test('rich text is sanitised when saved and again when built', () => {
  const b = mk('r1', 'rich-text', { html: '<p>Hi <script>x</script><a href="javascript:y">l</a></p>' });
  assert.equal(b.props.html, '<p>Hi <a>l</a></p>');
  b.props.html = '<p onclick="z">tampered</p><script>1</script>';
  assert.equal(renderBlock(b, blockCtx()), '<div class="rich"><p>tampered</p></div>');
});

test('button: links to a page or a safe address; a missing page hides it', () => {
  const ctx = blockCtx();
  assert.equal(renderBlock(mk('b1', 'button', { label: 'Say hi', link: { kind: 'page', pageId: 'contact' } }), ctx),
    '<p class="btn-row"><a class="sbtn sbtn-solid bh-fill" href="/contact/">Say hi</a></p>');
  assert.equal(renderBlock(mk('b2', 'button', { label: 'Mail', link: { kind: 'url', url: 'mailto:a@b.c' }, newTab: true, look: 'outline', hover: 'glow' }), ctx),
    '<p class="btn-row"><a class="sbtn sbtn-outline bh-glow" href="mailto:a@b.c" target="_blank" rel="noopener noreferrer">Mail</a></p>');
  assert.equal(renderBlock(mk('b3', 'button', { link: { kind: 'page', pageId: 'gone' } }), ctx), '');
  assert.match(validateBlock({ id: 'b4', type: 'button', props: { link: { kind: 'url', url: 'javascript:alert(1)' } } }, {}).errors[0], /^Button, link: links must start/);
  assert.match(validateBlock({ id: 'b5', type: 'button', props: { hover: 'none' } }, {}).errors[0], /^Button, hover:/, 'buttons offer fill, lift and glow');
});

test('spacer: a gap, with or without a line', () => {
  assert.equal(renderBlock(mk('s1', 'spacer', { height: 'large', line: true }), blockCtx()), '<div class="spacer sp-large" aria-hidden="true"><hr></div>');
  assert.equal(renderBlock(mk('s2', 'spacer'), blockCtx()), '<div class="spacer sp-medium" aria-hidden="true"></div>');
});

test('the wrapper: none for a plain block, classes and custom properties otherwise, always in the editor', () => {
  const plain = mk('w1', 'heading', { text: 'x' });
  assert.equal(wrap(plain, 'IN', blockCtx()), 'IN');
  assert.equal(wrap(plain, 'IN', blockCtx({ editor: true })), '<div class="blk" data-b="w1">IN</div>');
  const styled = mk('w2', 'heading', {}, { background: 'color', bgColor: '#112233', padding: 'small', width: 'contained', visible: 'phone' },
    { entrance: 'fade', duration: 500, delay: 100, repeat: 'once' });
  assert.equal(wrap(styled, 'IN', blockCtx()),
    '<div class="blk bg-color pad-s w-contained vis-phone m m-fade m-once" data-b="w2" style="--bg:#112233;--m-dur:500ms;--m-delay:100ms">IN</div>');
});

test('hidden blocks are left out, except in the editor where they show faded', () => {
  const b = mk('v1', 'heading', { text: 'x' }, { visible: 'none' });
  assert.equal(renderBlock(b, blockCtx()), '');
  assert.equal(renderBlock(b, blockCtx({ editor: true })), '<div class="blk blk-off" data-b="v1"><h2 class="hd hd-medium">x</h2></div>');
});

test('an empty block shows a note in the editor and nothing on the site', () => {
  const b = mk('e1', 'button', { link: { kind: 'page', pageId: 'gone' } });
  assert.equal(renderBlock(b, blockCtx({ editor: true })), '<div class="blk" data-b="e1"><p class="blk-empty">Button: nothing to show yet</p></div>');
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `node --test site/test/blocks-text.test.mjs`
Expected: FAIL with `Cannot find module '.../site/blocks/registry.mjs'`.

- [ ] **Step 4: Write `site/blocks/common.mjs`**

```js
/* What every website block shares: escaping, the checker that validates a block's props from its form description,
   the style and motion settings every block has, and the wrapper that puts them on the page. Pure. */
import { sanitizeHtml, safeUrl } from '../sanitize.mjs';
import { compileCustomCss } from '../../design/css.mjs';
export { safeUrl };

export const esc = t => String(t ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const text = (v, max) => String(v ?? '').trim().slice(0, max);
export const idOrNull = v => (Number.isInteger(v) && v > 0 ? v : null);
export const paras = t => String(t || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
  .map(s => `<p>${esc(s).replace(/\n/g, '<br>')}</p>`).join('');
export const LINK_ERROR = 'links must start with https://, http://, mailto: or tel:';

/* Checks raw props against a form description. Text is trimmed and cut to length, photos and galleries that do not
   exist become null, and anything else that is wrong is reported (and replaced by the default). */
export function cleanFields(raw, fields, defaults, ctx = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {}, errors = {};
  for (const f of fields) {
    const d = defaults[f.key];
    const v = Object.hasOwn(src, f.key) ? src[f.key] : d;
    switch (f.kind) {
      case 'text': case 'textarea': out[f.key] = text(v, f.max ?? 200); break;
      case 'select':
        if (f.options.some(o => o[0] === v)) out[f.key] = v;
        else { out[f.key] = d; errors[f.key] = `choose one of: ${f.options.map(o => o[1]).join(', ')}`; }
        break;
      case 'number': {
        const n = Number(v);
        if (Number.isInteger(n) && n >= f.min && n <= f.max) out[f.key] = n;
        else { out[f.key] = d; errors[f.key] = `must be a whole number from ${f.min} to ${f.max}`; }
        break;
      }
      case 'toggle': out[f.key] = v === true; break;
      case 'color':
        if (/^#[0-9a-f]{6}$/i.test(String(v))) out[f.key] = String(v).toLowerCase();
        else { out[f.key] = d; errors[f.key] = 'use a six-digit colour such as #1a1a1a'; }
        break;
      case 'photo': { const id = idOrNull(v); out[f.key] = id != null && (!ctx.photoIds || ctx.photoIds.has(id)) ? id : null; break; }
      case 'gallery': { const id = idOrNull(v); out[f.key] = id != null && (!ctx.galleryIds || ctx.galleryIds.has(id)) ? id : null; break; }
      case 'galleries':
        out[f.key] = Array.isArray(v)
          ? [...new Set(v.map(idOrNull))].filter(id => id != null && (!ctx.galleryIds || ctx.galleryIds.has(id))) : null;
        break;
      case 'url': {
        const s = text(v, 2000);
        out[f.key] = s ? safeUrl(s) : '';
        if (s && !out[f.key]) errors[f.key] = LINK_ERROR;
        break;
      }
      case 'link': {
        const o = v && typeof v === 'object' ? v : {};
        const kind = o.kind === 'page' ? 'page' : 'url';
        const s = kind === 'url' ? text(o.url, 2000) : '';
        const u = s ? safeUrl(s) : '';
        if (s && !u) errors[f.key] = LINK_ERROR;
        out[f.key] = { kind, url: u, pageId: kind === 'page' ? text(o.pageId, 32) : '' };
        break;
      }
      case 'richtext': out[f.key] = sanitizeHtml(String(v ?? '').slice(0, f.max ?? 20000), 'rich'); break;
      case 'html': out[f.key] = sanitizeHtml(String(v ?? '').slice(0, f.max ?? 20000), 'custom'); break;
      case 'css': {
        const s = String(v ?? '');
        const r = compileCustomCss(s, { scope: '#b-check' });
        if (r.error) { out[f.key] = d; errors[f.key] = `line ${r.error.line}, column ${r.error.col}: ${r.error.message}`; }
        else out[f.key] = s;
        break;
      }
      default: throw new Error(`unknown field kind ${f.kind}`);
    }
  }
  return { props: out, errors };
}

/* ---- style: the same settings on every block ---- */
export const STYLE_DEFAULTS = Object.freeze({ background: 'none', bgColor: '#ffffff', bgPhotoId: null, padding: 'none',
  align: 'default', width: 'default', visible: 'all' });
export const STYLE_SCHEMA = [
  { key: 'background', label: 'Background', kind: 'select', options: [['none', 'None'], ['color', 'Colour'], ['photo', 'Photo']] },
  { key: 'bgColor', label: 'Background colour', kind: 'color', when: ['background', 'color'] },
  { key: 'bgPhotoId', label: 'Background photo', kind: 'photo', when: ['background', 'photo'] },
  { key: 'padding', label: 'Space above and below', kind: 'select', options: [['none', 'None'], ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
  { key: 'align', label: 'Alignment', kind: 'select', options: [['default', 'As designed'], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] },
  { key: 'width', label: 'Width', kind: 'select', options: [['default', 'As designed'], ['full', 'Full width'], ['contained', 'Contained']] },
  { key: 'visible', label: 'Show on', kind: 'select', options: [['all', 'Phones and computers'], ['desktop', 'Computers only'], ['phone', 'Phones only'], ['none', 'Hidden']] },
];
export function cleanStyle(raw, ctx = {}) { const r = cleanFields(raw, STYLE_SCHEMA, STYLE_DEFAULTS, ctx); return { style: r.props, errors: r.errors }; }

/* ---- motion: entrance and background animation on every block ---- */
export const ENTRANCES = ['none', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom-in', 'blur-in'];
export const MOTION_DEFAULTS = Object.freeze({ entrance: 'none', duration: 700, delay: 0, repeat: 'once', background: 'none' });
export const MOTION_SCHEMA = [
  { key: 'entrance', label: 'Entrance', kind: 'select', options: [['none', 'None'], ['fade', 'Fade in'], ['slide-up', 'Slide up'],
    ['slide-down', 'Slide down'], ['slide-left', 'Slide in from the right'], ['slide-right', 'Slide in from the left'], ['zoom-in', 'Zoom in'], ['blur-in', 'Soft focus in']] },
  { key: 'duration', label: 'Duration', kind: 'number', min: 200, max: 3000, step: 50, unit: 'ms', when: ['entrance', '!none'] },
  { key: 'delay', label: 'Delay', kind: 'number', min: 0, max: 3000, step: 50, unit: 'ms', when: ['entrance', '!none'] },
  { key: 'repeat', label: 'Play', kind: 'select', options: [['once', 'The first time it comes into view'], ['every', 'Every time it comes into view']], when: ['entrance', '!none'] },
  { key: 'background', label: 'Background motion', kind: 'select', options: [['none', 'None'], ['parallax', 'Parallax']], hint: 'Parallax needs a background photo (Style tab).' },
];
export function cleanMotion(raw) { const r = cleanFields(raw, MOTION_SCHEMA, MOTION_DEFAULTS); return { motion: r.props, errors: r.errors }; }

export const HOVER_IMAGE = [['none', 'None'], ['zoom', 'Zoom in'], ['lift', 'Lift'], ['darken', 'Darken'], ['caption', 'Show the caption']];
export const BUTTON_HOVER = [['fill', 'Fill'], ['lift', 'Lift'], ['glow', 'Glow']];

/* A block with nothing set in style or motion is written exactly as its own markup, with no wrapper:
   that is what keeps a site made from the old pages identical to before. */
export function isPlain(b) {
  const s = b.style, m = b.motion;
  return s.background === 'none' && s.padding === 'none' && s.align === 'default' && s.width === 'default' && s.visible === 'all'
    && m.entrance === 'none' && m.background === 'none';
}
const PAD = { small: 's', medium: 'm', large: 'l' };
export function wrap(b, inner, ctx) {
  if (isPlain(b) && !ctx.editor) return inner;
  const s = b.style, m = b.motion, cls = ['blk'], vars = [];
  let layer = '';
  if (s.background === 'color') { cls.push('bg-color'); vars.push(`--bg:${s.bgColor}`); }
  const bp = s.background === 'photo' ? ctx.photo(s.bgPhotoId) : null;
  if (bp) {
    cls.push('bg-photo');
    if (m.background === 'parallax') cls.push('px');
    layer = `<div class="blk-bg" style="background-image:url('${ctx.pic(bp, 'full')}')"></div>`;
  }
  if (s.padding !== 'none') cls.push(`pad-${PAD[s.padding]}`);
  if (s.align !== 'default') cls.push(`al-${s.align}`);
  if (s.width !== 'default') cls.push(`w-${s.width}`);
  if (s.visible === 'desktop' || s.visible === 'phone') cls.push(`vis-${s.visible}`);
  if (s.visible === 'none') cls.push('blk-off');
  if (m.entrance !== 'none') {
    cls.push('m', `m-${m.entrance}`);
    if (m.repeat === 'once') cls.push('m-once');
    vars.push(`--m-dur:${m.duration}ms`, `--m-delay:${m.delay}ms`);
  }
  return `<div class="${cls.join(' ')}" data-b="${esc(b.id)}"${vars.length ? ` style="${vars.join(';')}"` : ''}>${layer}${inner}</div>`;
}

export function linkHref(link, ctx) { return link.kind === 'page' ? ctx.pageHref(link.pageId) : (link.url || null); }
```

- [ ] **Step 5: Write the four text block modules**

`site/blocks/heading.mjs`:

```js
import { cleanFields, esc } from './common.mjs';
export const type = 'heading';
export const label = 'Heading';
export const icon = 'type';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="18" y="24" width="64" height="12" rx="2"/></svg>';
export const defaults = Object.freeze({ text: 'A heading', level: 2, size: 'medium' });
export const fields = [
  { key: 'text', label: 'Text', kind: 'text', max: 200 },
  { key: 'level', label: 'Importance', kind: 'select', options: [[1, 'Page title'], [2, 'Section'], [3, 'Sub-section']], hint: 'Search engines read the page title as what the page is about. Use it once per page.' },
  { key: 'size', label: 'Size', kind: 'select', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b) {
  const p = b.props;
  return `<h${p.level} class="hd hd-${p.size}">${esc(p.text)}</h${p.level}>`;
}
```

`site/blocks/rich-text.mjs`:

```js
import { cleanFields } from './common.mjs';
import { sanitizeHtml } from '../sanitize.mjs';
export const type = 'rich-text';
export const label = 'Text';
export const icon = 'type';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="14" y="14" width="72" height="5"/><rect x="14" y="25" width="66" height="5"/><rect x="14" y="36" width="70" height="5"/><rect x="14" y="47" width="40" height="5"/></svg>';
export const defaults = Object.freeze({ html: '<p>Write something here.</p>' });
export const fields = [{ key: 'html', label: 'Text', kind: 'richtext', max: 20000 }];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
/* sanitised again here, so text that reached the database some other way still cannot carry script */
export function render(b) { return `<div class="rich">${sanitizeHtml(b.props.html, 'rich')}</div>`; }
```

`site/blocks/button.mjs`:

```js
import { cleanFields, esc, linkHref, BUTTON_HOVER } from './common.mjs';
export const type = 'button';
export const label = 'Button';
export const icon = 'chevron-right';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="28" y="22" width="44" height="16" rx="3"/></svg>';
export const defaults = Object.freeze({ label: 'Get in touch', link: { kind: 'page', url: '', pageId: 'contact' }, look: 'solid', hover: 'fill', newTab: false });
export const fields = [
  { key: 'label', label: 'Words on the button', kind: 'text', max: 60 },
  { key: 'link', label: 'Goes to', kind: 'link' },
  { key: 'look', label: 'Look', kind: 'select', options: [['solid', 'Solid'], ['outline', 'Outline']] },
  { key: 'hover', label: 'On hover', kind: 'select', options: BUTTON_HOVER },
  { key: 'newTab', label: 'Open in a new tab', kind: 'toggle' },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b, ctx) {
  const p = b.props, href = linkHref(p.link, ctx);
  if (!href || !p.label) return '';
  const tab = p.newTab ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<p class="btn-row"><a class="sbtn sbtn-${p.look} bh-${p.hover}" href="${esc(href)}"${tab}>${esc(p.label)}</a></p>`;
}
```

`site/blocks/spacer.mjs`:

```js
import { cleanFields } from './common.mjs';
export const type = 'spacer';
export const label = 'Space or line';
export const icon = 'sliders-horizontal';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="10" y="29" width="80" height="2"/></svg>';
export const defaults = Object.freeze({ height: 'medium', line: false });
export const fields = [
  { key: 'height', label: 'Height', kind: 'select', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
  { key: 'line', label: 'Draw a line', kind: 'toggle' },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b) { return `<div class="spacer sp-${b.props.height}" aria-hidden="true">${b.props.line ? '<hr>' : ''}</div>`; }
```

- [ ] **Step 6: Write the registry**

`site/blocks/registry.mjs`:

```js
/* Every website block type, and the checks and rendering that apply to all of them. A block type is one module in this
   folder exporting type, label, icon, sketch, defaults, fields, validate, render (and nestable = false if it may not go
   inside columns); list it in TYPES, in the order the add-block picker shows them. Pure. */
import * as heading from './heading.mjs';
import * as richText from './rich-text.mjs';
import * as button from './button.mjs';
import * as spacer from './spacer.mjs';
import { cleanStyle, cleanMotion, wrap, esc } from './common.mjs';
export { STYLE_DEFAULTS, STYLE_SCHEMA, MOTION_DEFAULTS, MOTION_SCHEMA } from './common.mjs';

const TYPES = [heading, richText, button, spacer];
export const BLOCK_TYPES = new Map(TYPES.map(t => [t.type, t]));
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function listBlockTypes() {
  return TYPES.map(t => ({ type: t.type, label: t.label, icon: t.icon, sketch: t.sketch, defaults: t.defaults,
                           fields: t.fields, nestable: t.nestable !== false }));
}

function prep(ctx) { ctx.blockIds ??= new Set(); ctx.depth ??= 0; ctx.validateBlocks ??= validateBlocks; return ctx; }

export function validateBlock(raw, ctx = {}) {
  prep(ctx);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { block: null, errors: ['a block must be an object'] };
  const t = BLOCK_TYPES.get(raw.type);
  if (!t) return { block: null, errors: [`unknown block type "${String(raw.type).slice(0, 40)}"`] };
  if (ctx.depth > 0 && t.nestable === false) return { block: null, errors: [`${t.label} cannot go inside columns`] };
  const id = String(raw.id ?? '');
  if (!ID.test(id)) return { block: null, errors: [`${t.label}: the block id "${id.slice(0, 40)}" is not valid`] };
  if (ctx.blockIds.has(id)) return { block: null, errors: [`${t.label}: the block id "${id}" is used twice`] };
  ctx.blockIds.add(id);
  const p = t.validate(raw.props, ctx), s = cleanStyle(raw.style, ctx), m = cleanMotion(raw.motion);
  const errors = [...Object.entries(p.errors), ...Object.entries(s.errors), ...Object.entries(m.errors)]
    .map(([k, e]) => `${t.label}, ${k}: ${e}`);
  return { block: { id, type: t.type, props: p.props, style: s.style, motion: m.motion }, errors };
}

export function validateBlocks(list, ctx = {}) {
  prep(ctx);
  const blocks = [], errors = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const r = validateBlock(raw, ctx);
    if (r.block) blocks.push(r.block);
    errors.push(...r.errors);
  }
  return { blocks, errors };
}

export function countBlocks(list) {
  return list.reduce((n, b) => n + 1 + (b.type === 'columns' ? b.props.columns.reduce((k, c) => k + countBlocks(c), 0) : 0), 0);
}

export function renderBlock(b, ctx) {
  const t = BLOCK_TYPES.get(b.type);
  if (!t || (b.style.visible === 'none' && !ctx.editor)) return '';
  ctx.renderBlocks ??= renderBlocks;
  let inner = t.render(b, ctx);
  if (!inner) {
    if (!ctx.editor) return '';
    inner = `<p class="blk-empty">${esc(t.label)}: nothing to show yet</p>`;
  }
  return wrap(b, inner, ctx);
}

export function renderBlocks(list, ctx) { return (list || []).map(b => renderBlock(b, ctx)).join(''); }
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `node --test site/test/blocks-text.test.mjs`
Expected: PASS (11 tests).

- [ ] **Step 8: Commit (commit only after the user approves)**

```bash
git add site/blocks/common.mjs site/blocks/registry.mjs site/blocks/heading.mjs site/blocks/rich-text.mjs site/blocks/button.mjs site/blocks/spacer.mjs site/test/block-helpers.mjs site/test/blocks-text.test.mjs
git commit -m "Website: block registry, shared style and motion settings, text blocks"
```

---

### Task 4: Photo blocks (hero, image, image and text, gallery cards, photo grid)

These carry the markup of today's Home, gallery, About and Contact pages, so their default output must match `build.mjs` exactly.

**Files:**
- Create: `site/blocks/hero.mjs`, `site/blocks/image.mjs`, `site/blocks/image-text.mjs`, `site/blocks/gallery-cards.mjs`, `site/blocks/photo-grid.mjs`
- Modify: `site/blocks/registry.mjs` (imports and `TYPES`)
- Test: `site/test/blocks-photo.test.mjs`

**Interfaces:**
- Consumes: `cleanFields`, `esc`, `paras`, `linkHref`, `HOVER_IMAGE` (Task 3); render `ctx` (Task 3).
- Produces: block types `hero`, `image`, `image-text`, `gallery-cards`, `photo-grid` with these defaults (Task 6's migration relies on them):
  - `hero`: `{ photoId: null, heading: 'A heading', subheading: '', buttonLabel: '', buttonLink: { kind: 'url', url: '', pageId: '' }, height: 'banner', shade: 0 }`
  - `image`: `{ photoId: null, alt: '', caption: '', size: 'large', link: { kind: 'url', url: '', pageId: '' }, hover: 'none' }`
  - `image-text`: `{ photoId: null, heading: 'About', text: '', alt: '', photoSide: 'left', hover: 'none' }`
  - `gallery-cards`: `{ galleryIds: null, subtitle: 'Click For More!', hover: 'none' }` (null = every visible gallery)
  - `photo-grid`: `{ galleryId: null, columns: 0, hover: 'none' }` (0 = the site's column setting); `nestable = false`.

- [ ] **Step 1: Write the failing tests**

`site/test/blocks-photo.test.mjs`:

```js
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test site/test/blocks-photo.test.mjs`
Expected: FAIL with `test block h1: unknown block type "hero"`.

- [ ] **Step 3: Write the five modules**

`site/blocks/hero.mjs`:

```js
import { cleanFields, esc, linkHref } from './common.mjs';
export const type = 'hero';
export const label = 'Banner';
export const icon = 'image';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="0" y="0" width="100" height="60"/><rect x="25" y="24" width="50" height="8" rx="1"/></svg>';
export const defaults = Object.freeze({ photoId: null, heading: 'A heading', subheading: '', buttonLabel: '',
  buttonLink: { kind: 'url', url: '', pageId: '' }, height: 'banner', shade: 0 });
export const fields = [
  { key: 'photoId', label: 'Photo', kind: 'photo' },
  { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
  { key: 'subheading', label: 'Line under the heading', kind: 'text', max: 200 },
  { key: 'buttonLabel', label: 'Button words', kind: 'text', max: 60, hint: 'Leave empty for no button.' },
  { key: 'buttonLink', label: 'Button goes to', kind: 'link' },
  { key: 'height', label: 'Height', kind: 'select', options: [['banner', 'Banner'], ['tall', 'Tall'], ['full', 'Full screen']] },
  { key: 'shade', label: 'Darken the photo', kind: 'number', min: 0, max: 70, step: 5, unit: '%' },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b, ctx) {
  const p = b.props, ph = ctx.photo(p.photoId);
  const href = p.buttonLabel ? linkHref(p.buttonLink, ctx) : null;
  const extra = (p.subheading ? `<p class="hero-sub">${esc(p.subheading)}</p>` : '')
    + (href ? `<a class="sbtn sbtn-solid bh-fill" href="${esc(href)}">${esc(p.buttonLabel)}</a>` : '');
  if (!ph) return `<h1 class="page-title">${esc(p.heading)}</h1>${extra}`;
  ctx.setOg(ph);
  const src = ctx.pic(ph, 'full');
  ctx.addHead(`<link rel="preload" as="image" href="${src}">`);
  const cls = p.height === 'banner' ? 'banner' : `banner hero-${p.height}`;
  const shade = p.shade ? `<span class="hero-shade" style="opacity:${p.shade / 100}"></span>` : '';
  const inner = extra ? `<div class="hero-in"><h1>${esc(p.heading)}</h1>${extra}</div>` : `<h1>${esc(p.heading)}</h1>`;
  return `<section class="${cls}" style="background-image:url('${src}')">${shade}${inner}</section>`;
}
```

`site/blocks/image.mjs`:

```js
import { cleanFields, esc, linkHref, HOVER_IMAGE } from './common.mjs';
export const type = 'image';
export const label = 'Photo';
export const icon = 'image';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="20" y="6" width="60" height="40"/><rect x="34" y="50" width="32" height="4"/></svg>';
export const defaults = Object.freeze({ photoId: null, alt: '', caption: '', size: 'large', link: { kind: 'url', url: '', pageId: '' }, hover: 'none' });
export const fields = [
  { key: 'photoId', label: 'Photo', kind: 'photo' },
  { key: 'alt', label: 'Description for people who cannot see it', kind: 'text', max: 200 },
  { key: 'caption', label: 'Caption', kind: 'text', max: 200 },
  { key: 'size', label: 'Size', kind: 'select', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['full', 'Edge to edge']] },
  { key: 'link', label: 'Clicking it goes to', kind: 'link' },
  { key: 'hover', label: 'On hover', kind: 'select', options: HOVER_IMAGE },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b, ctx) {
  const p = b.props, ph = ctx.photo(p.photoId);
  if (!ph) return '';
  ctx.setOg(ph);
  const v = p.size === 'small' || p.size === 'medium' ? 'grid' : 'full';
  const [w, h] = v === 'grid' ? ctx.gridSize(ph) : [ph.width, ph.height];
  const img = `<img src="${ctx.pic(ph, v)}" width="${w}" height="${h}" alt="${esc(p.alt)}" loading="lazy" decoding="async">`;
  const href = linkHref(p.link, ctx);
  const cap = p.caption ? `<figcaption class="cap">${esc(p.caption)}</figcaption>` : '';
  const hv = p.hover === 'none' ? '' : ` hv-${p.hover}`;
  return `<figure class="img-block size-${p.size}${hv}"><span class="frame">${href ? `<a href="${esc(href)}">${img}</a>` : img}</span>${cap}</figure>`;
}
```

`site/blocks/image-text.mjs`:

```js
import { cleanFields, esc, paras, HOVER_IMAGE } from './common.mjs';
export const type = 'image-text';
export const label = 'Image and text';
export const icon = 'image';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="8" y="8" width="40" height="44"/><rect x="56" y="14" width="34" height="6"/><rect x="56" y="26" width="30" height="4"/><rect x="56" y="34" width="34" height="4"/><rect x="56" y="42" width="22" height="4"/></svg>';
export const defaults = Object.freeze({ photoId: null, heading: 'About', text: '', alt: '', photoSide: 'left', hover: 'none' });
export const fields = [
  { key: 'photoId', label: 'Photo', kind: 'photo' },
  { key: 'alt', label: 'Photo description', kind: 'text', max: 200, hint: 'Empty uses your site name.' },
  { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
  { key: 'text', label: 'Text', kind: 'textarea', max: 5000, hint: 'Leave an empty line between paragraphs.' },
  { key: 'photoSide', label: 'Photo on the', kind: 'select', options: [['left', 'Left'], ['right', 'Right']] },
  { key: 'hover', label: 'On hover', kind: 'select', options: HOVER_IMAGE.slice(0, 3) },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b, ctx) {
  const p = b.props, ph = ctx.photo(p.photoId);
  ctx.setOg(ph);
  const cls = 'about' + (p.photoSide === 'right' ? ' about-right' : '') + (p.hover === 'none' ? '' : ` hv-${p.hover}`);
  return `<section class="${cls}">`
    + (ph ? `<img class="about-photo" src="${ctx.pic(ph, 'full')}" width="${ph.width}" height="${ph.height}" alt="${esc(p.alt || ctx.siteName)}">` : '')
    + `<div class="about-card"><h1>${esc(p.heading)}</h1>${paras(p.text)}</div></section>`;
}
```

`site/blocks/gallery-cards.mjs`:

```js
import { cleanFields, esc, HOVER_IMAGE } from './common.mjs';
export const type = 'gallery-cards';
export const label = 'Gallery cards';
export const icon = 'images';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="8" y="8" width="24" height="34"/><rect x="38" y="8" width="24" height="34"/><rect x="68" y="8" width="24" height="34"/><rect x="11" y="47" width="18" height="4"/><rect x="41" y="47" width="18" height="4"/><rect x="71" y="47" width="18" height="4"/></svg>';
export const defaults = Object.freeze({ galleryIds: null, subtitle: 'Click For More!', hover: 'none' });
export const fields = [
  { key: 'galleryIds', label: 'Galleries', kind: 'galleries', hint: 'Every visible gallery, in the order of the Galleries tab, unless you pick some.' },
  { key: 'subtitle', label: 'Line under each name', kind: 'text', max: 80 },
  { key: 'hover', label: 'On hover', kind: 'select', options: HOVER_IMAGE },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b, ctx) {
  const p = b.props;
  const list = p.galleryIds ? p.galleryIds.map(id => ctx.shownGalleries.find(g => g.id === id)).filter(Boolean) : ctx.shownGalleries;
  if (list[0]) ctx.setOg(ctx.cover(list[0]));
  const cap = p.hover === 'caption' ? ' cap' : '';
  const cards = list.map((g, i) => {
    const c = ctx.cover(g); const [w, h] = ctx.gridSize(c);
    return `<a class="card" href="${ctx.base}${encodeURIComponent(g.slug)}/"><img src="${ctx.pic(c, 'grid')}" alt="${esc(g.title)}" width="${w}" height="${h}"${i === 0 ? ' fetchpriority="high"' : ''}>`
      + `<span class="card-title${cap}">${esc(g.title)}</span>` + (p.subtitle ? `<span class="card-sub${cap}">${esc(p.subtitle)}</span>` : '') + '</a>';
  }).join('');
  return `<section class="cards${p.hover === 'none' ? '' : ` hv-${p.hover}`}">${cards}</section>`;
}
```

`site/blocks/photo-grid.mjs`:

```js
import { cleanFields, esc, HOVER_IMAGE } from './common.mjs';
export const type = 'photo-grid';
export const label = 'Photo grid';
export const icon = 'layout-grid';
/* site.js lays out and opens the first grid on a page only, so a page holds one, and never inside columns */
export const nestable = false;
export const sketch = '<svg viewBox="0 0 100 60"><rect x="6" y="6" width="27" height="20"/><rect x="37" y="6" width="27" height="30"/><rect x="68" y="6" width="27" height="16"/><rect x="6" y="30" width="27" height="24"/><rect x="37" y="40" width="27" height="14"/><rect x="68" y="26" width="27" height="28"/></svg>';
export const defaults = Object.freeze({ galleryId: null, columns: 0, hover: 'none' });
export const fields = [
  { key: 'galleryId', label: 'Gallery', kind: 'gallery', hint: 'The name above the photos follows the gallery’s own “Show the name” setting.' },
  { key: 'columns', label: 'Columns on computers', kind: 'select', options: [[0, 'Same as the Style tab'], [2, '2'], [3, '3'], [4, '4'], [5, '5']] },
  { key: 'hover', label: 'On hover', kind: 'select', options: HOVER_IMAGE.slice(0, 4) },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b, ctx) {
  const p = b.props, g = ctx.gallery(p.galleryId);
  if (!g || g.hidden || !g.photos.length) return '';
  ctx.setOg(ctx.cover(g));
  const items = g.photos.map((ph, i) => {
    const [w, h] = ctx.gridSize(ph);
    return `<a class="m-item" href="${ctx.pic(ph, 'full')}" data-w="${ph.width}" data-h="${ph.height}">`
      + `<img src="${ctx.pic(ph, 'grid')}" width="${w}" height="${h}" alt="${esc(g.title)} photo ${i + 1}"${i < 8 ? '' : ' loading="lazy"'} decoding="async"></a>`;
  }).join('');
  const heading = `<h1 class="${g.showTitle ? 'page-title' : 'sr-only'}">${esc(g.title)}</h1>`;
  return `${heading}<section class="masonry${p.hover === 'none' ? '' : ` hv-${p.hover}`}" data-cols="${p.columns || ctx.style.colsDesktop}" data-cols-phone="${ctx.style.colsPhone}">${items}</section>`;
}
```

- [ ] **Step 4: Register them**

In `site/blocks/registry.mjs`, add after the existing block imports:

```js
import * as hero from './hero.mjs';
import * as image from './image.mjs';
import * as imageText from './image-text.mjs';
import * as galleryCards from './gallery-cards.mjs';
import * as photoGrid from './photo-grid.mjs';
```

and replace the `TYPES` line with:

```js
const TYPES = [hero, heading, richText, image, imageText, galleryCards, photoGrid, button, spacer];
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test site/test/blocks-photo.test.mjs site/test/blocks-text.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit (commit only after the user approves)**

```bash
git add site/blocks/hero.mjs site/blocks/image.mjs site/blocks/image-text.mjs site/blocks/gallery-cards.mjs site/blocks/photo-grid.mjs site/blocks/registry.mjs site/test/blocks-photo.test.mjs
git commit -m "Website: photo blocks - banner, photo, image and text, gallery cards, photo grid"
```

---

### Task 5: Columns, contact details, embed and custom HTML blocks

**Files:**
- Create: `site/blocks/columns.mjs`, `site/blocks/contact.mjs`, `site/blocks/embed.mjs`, `site/blocks/custom-html.mjs`
- Modify: `site/blocks/registry.mjs` (imports and `TYPES`)
- Test: `site/test/blocks-layout.test.mjs`

**Interfaces:**
- Consumes: `cleanFields`, `esc`, `text` (Task 3); `sanitizeHtml` (Task 2); `compileCustomCss(src, { scope })` (Task 2); `ctx.validateBlocks`, `ctx.renderBlocks` (Task 3).
- Produces: block types `columns` (`{ count: 2, gap: 'normal', columns: [[], [], []] }`, `nestable = false`), `contact` (`{ heading: 'Contact us', email: '', phone: '' }`), `embed` (`{ kind: 'video', url: '', place: '', ratio: '16:9', title: '' }`, plus exported `embedSrc(props) => string`), `custom-html` (`{ html: '<p>Your HTML here.</p>', css: '' }`). Final registry order: hero, heading, rich-text, image, image-text, gallery-cards, photo-grid, button, spacer, columns, contact, embed, custom-html.

- [ ] **Step 1: Write the failing tests**

`site/test/blocks-layout.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBlock, validateBlock, validateBlocks, countBlocks, BLOCK_TYPES } from '../blocks/registry.mjs';
import { embedSrc } from '../blocks/embed.mjs';
import { blockCtx, mk } from './block-helpers.mjs';

const h = (id, t) => ({ id, type: 'heading', props: { text: t } });

test('columns hold blocks, checked like any others, and show only as many as chosen', () => {
  const b = mk('c1', 'columns', { count: 2, columns: [[h('k1', 'Left')], [h('k2', 'Right')], [h('k3', 'Kept for later')]] });
  assert.equal(countBlocks([b]), 4);
  assert.equal(renderBlock(b, blockCtx()),
    '<div class="cols cols-2 gap-normal"><div class="col"><h2 class="hd hd-medium">Left</h2></div><div class="col"><h2 class="hd hd-medium">Right</h2></div></div>');
  assert.match(renderBlock(b, blockCtx({ editor: true })), /<div class="col"><div class="blk" data-b="k1">/, 'blocks in columns are selectable');
});

test('columns refuse columns and photo grids inside, and share one set of block ids with the page', () => {
  const r = validateBlocks([h('d1', 'x'), { id: 'c2', type: 'columns', props: { columns: [
    [{ id: 'c3', type: 'columns' }, { id: 'g1', type: 'photo-grid' }, h('d1', 'dup')], [], []] } }], {});
  assert.equal(r.errors.length, 3);
  assert.match(r.errors.join('\n'), /Columns cannot go inside columns/);
  assert.match(r.errors.join('\n'), /Photo grid cannot go inside columns/);
  assert.match(r.errors.join('\n'), /"d1" is used twice/);
});

test('contact details are the old Contact section', () => {
  assert.equal(renderBlock(mk('t1', 'contact', { heading: 'Contact us', email: 'someone@example.com', phone: '555 0100' }), blockCtx()),
    '<section class="contact"><h2>Contact us</h2><div class="label">Email</div><a href="mailto:someone@example.com">someone@example.com</a>'
    + '<div class="label">Phone number</div><a href="tel:5550100">555 0100</a></section>');
  assert.equal(renderBlock(mk('t2', 'contact', { email: '' }), blockCtx()), '<section class="contact"><h2>Contact us</h2></section>');
  assert.match(validateBlock({ id: 't3', type: 'contact', props: { email: 'not an address' } }, {}).errors[0], /^Contact details, email:/);
});

test('embed: YouTube and Vimeo links become privacy-friendly players; a place becomes a map', () => {
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=3', 'https://youtube.com/shorts/dQw4w9WgXcQ'])
    assert.equal(embedSrc({ kind: 'video', url: u }), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', u);
  assert.equal(embedSrc({ kind: 'video', url: 'https://vimeo.com/123456' }), 'https://player.vimeo.com/video/123456');
  assert.equal(embedSrc({ kind: 'video', url: 'https://evil.example/watch?v=dQw4w9WgXcQ' }), '');
  assert.equal(embedSrc({ kind: 'map', place: 'Town Hall, Leeds & Co' }), 'https://maps.google.com/maps?q=Town%20Hall%2C%20Leeds%20%26%20Co&output=embed');
  assert.equal(renderBlock(mk('e1', 'embed', { url: 'https://vimeo.com/123456', title: 'Film' }), blockCtx()),
    '<div class="embed r-16x9"><iframe src="https://player.vimeo.com/video/123456" title="Film" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>');
  assert.match(validateBlock({ id: 'e2', type: 'embed', props: { url: 'https://example.com/x' } }, {}).errors[0], /^Video or map, url: paste a YouTube or Vimeo link/);
  assert.equal(renderBlock(mk('e3', 'embed'), blockCtx()), '');
});

test('custom HTML is sanitised, and its CSS only reaches inside the block', () => {
  const b = mk('x1', 'custom-html', { html: '<p onclick="a()">Hi</p><script>alert(1)</script>', css: 'p{color:red}' });
  assert.equal(b.props.html, '<p>Hi</p>');
  assert.equal(renderBlock(b, blockCtx()), '<style>#b-x1 p{color:red}</style><div class="custom-html" id="b-x1"><p>Hi</p></div>');
  assert.match(validateBlock({ id: 'x2', type: 'custom-html', props: { css: 'p{background:url(https://x)}' } }, {}).errors[0], /^Custom HTML, css: line 1, column/);
  b.props.css = 'p{background:url(https://x)}';   /* tampered after saving: nothing is written */
  assert.equal(renderBlock(b, blockCtx()), '<div class="custom-html" id="b-x1"><p>Hi</p></div>');
});

test('the full set of block types, in picker order', () => {
  assert.deepEqual([...BLOCK_TYPES.keys()], ['hero', 'heading', 'rich-text', 'image', 'image-text', 'gallery-cards', 'photo-grid',
    'button', 'spacer', 'columns', 'contact', 'embed', 'custom-html']);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test site/test/blocks-layout.test.mjs`
Expected: FAIL with `Cannot find module '.../site/blocks/embed.mjs'`.

- [ ] **Step 3: Write the four modules**

`site/blocks/columns.mjs`:

```js
import { cleanFields } from './common.mjs';
export const type = 'columns';
export const label = 'Columns';
export const icon = 'layout-grid';
export const nestable = false;
export const sketch = '<svg viewBox="0 0 100 60"><rect x="6" y="8" width="26" height="44"/><rect x="37" y="8" width="26" height="44"/><rect x="68" y="8" width="26" height="44"/></svg>';
export const defaults = Object.freeze({ count: 2, gap: 'normal', columns: [[], [], []] });
export const fields = [
  { key: 'count', label: 'Columns', kind: 'select', options: [[2, 'Two'], [3, 'Three']], hint: 'On phones the columns stack, one under the other.' },
  { key: 'gap', label: 'Space between', kind: 'select', options: [['tight', 'Tight'], ['normal', 'Normal'], ['roomy', 'Roomy']] },
];
/* the blocks inside are checked like a page's, sharing its set of ids; a third column is kept when two are shown */
export function validate(raw, ctx) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const { props, errors } = cleanFields(src, fields, defaults, ctx);
  const cols = Array.isArray(src.columns) ? src.columns : [];
  const inner = { ...ctx, depth: (ctx.depth || 0) + 1 };
  props.columns = [0, 1, 2].map(i => {
    const r = ctx.validateBlocks(Array.isArray(cols[i]) ? cols[i] : [], inner);
    r.errors.forEach((e, j) => { errors[`column ${i + 1} (${j + 1})`] = e; });
    return r.blocks;
  });
  return { props, errors };
}
export function render(b, ctx) {
  const p = b.props;
  return `<div class="cols cols-${p.count} gap-${p.gap}">`
    + p.columns.slice(0, p.count).map(c => `<div class="col">${ctx.renderBlocks(c, ctx)}</div>`).join('') + '</div>';
}
```

Note: the `columns` test expects the error text `Columns cannot go inside columns` and the column errors to be reported as `Columns, column 1 (1): Columns cannot go inside columns`; both come out of `validateBlock` joining `${t.label}, ${k}: ${e}`.

`site/blocks/contact.mjs`:

```js
import { cleanFields, esc } from './common.mjs';
export const type = 'contact';
export const label = 'Contact details';
export const icon = 'mail';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="30" y="8" width="40" height="7"/><rect x="40" y="22" width="20" height="3"/><rect x="28" y="28" width="44" height="5"/><rect x="40" y="40" width="20" height="3"/><rect x="32" y="46" width="36" height="5"/></svg>';
export const defaults = Object.freeze({ heading: 'Contact us', email: '', phone: '' });
export const fields = [
  { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
  { key: 'email', label: 'Email', kind: 'text', max: 200 },
  { key: 'phone', label: 'Phone', kind: 'text', max: 60 },
];
export function validate(props, ctx) {
  const r = cleanFields(props, fields, defaults, ctx);
  if (r.props.email && !/^[^\s@<>"]+@[^\s@<>"]+$/.test(r.props.email)) r.errors.email = 'that does not look like an email address';
  return r;
}
export function render(b) {
  const p = b.props, tel = String(p.phone || '').replace(/[^\d+]/g, '');
  const rows = (p.email ? `<div class="label">Email</div><a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '')
             + (p.phone ? `<div class="label">Phone number</div><a href="tel:${esc(tel)}">${esc(p.phone)}</a>` : '');
  return `<section class="contact"><h2>${esc(p.heading)}</h2>${rows}</section>`;
}
```

`site/blocks/embed.mjs`:

```js
import { cleanFields, esc } from './common.mjs';
export const type = 'embed';
export const label = 'Video or map';
export const icon = 'globe';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="14" y="8" width="72" height="44" rx="3"/><rect x="44" y="22" width="12" height="16"/></svg>';
export const defaults = Object.freeze({ kind: 'video', url: '', place: '', ratio: '16:9', title: '' });
export const fields = [
  { key: 'kind', label: 'Show', kind: 'select', options: [['video', 'A video'], ['map', 'A map']] },
  { key: 'url', label: 'YouTube or Vimeo link', kind: 'text', max: 300, when: ['kind', 'video'] },
  { key: 'place', label: 'Address or place name', kind: 'text', max: 200, when: ['kind', 'map'] },
  { key: 'ratio', label: 'Shape', kind: 'select', options: [['16:9', 'Wide'], ['4:3', 'Standard'], ['1:1', 'Square']] },
  { key: 'title', label: 'Description for screen readers', kind: 'text', max: 120 },
];
/* Only these players are ever embedded: the address is rebuilt from the video id, never taken from the link. */
export function embedSrc(p) {
  if (p.kind === 'map') return p.place ? `https://maps.google.com/maps?q=${encodeURIComponent(p.place)}&output=embed` : '';
  const u = String(p.url || '');
  let m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})(?:[?&#/].*)?$/i.exec(u);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = /^https?:\/\/(?:www\.)?(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d{1,12})(?:[?#/].*)?$/i.exec(u);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return '';
}
export function validate(props, ctx) {
  const r = cleanFields(props, fields, defaults, ctx);
  if (r.props.kind === 'video' && r.props.url && !embedSrc(r.props)) r.errors.url = 'paste a YouTube or Vimeo link';
  return r;
}
export function render(b) {
  const p = b.props, src = embedSrc(p);
  if (!src) return '';
  return `<div class="embed r-${p.ratio.replace(':', 'x')}"><iframe src="${esc(src)}" title="${esc(p.title || (p.kind === 'map' ? 'Map' : 'Video'))}" `
    + 'loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>';
}
```

`site/blocks/custom-html.mjs`:

```js
import { cleanFields, esc } from './common.mjs';
import { sanitizeHtml } from '../sanitize.mjs';
import { compileCustomCss } from '../../design/css.mjs';
export const type = 'custom-html';
export const label = 'Custom HTML';
export const icon = 'settings';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="10" y="12" width="30" height="5"/><rect x="18" y="22" width="46" height="5"/><rect x="18" y="32" width="38" height="5"/><rect x="10" y="42" width="30" height="5"/></svg>';
export const defaults = Object.freeze({ html: '<p>Your HTML here.</p>', css: '' });
export const fields = [
  { key: 'html', label: 'HTML', kind: 'html', max: 20000, hint: 'Text, headings, lists, links and tables. Scripts, event handlers such as onclick, style attributes, images and frames are removed.' },
  { key: 'css', label: 'CSS for this block', kind: 'css', hint: 'Applies only inside this block. The same rules as gallery custom CSS: no url(), @import, @font-face or position: fixed.' },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b) {
  const c = b.props.css ? compileCustomCss(b.props.css, { scope: `#b-${b.id}` }) : { css: '' };
  return (c.css ? `<style>${c.css}</style>` : '') + `<div class="custom-html" id="b-${esc(b.id)}">${sanitizeHtml(b.props.html, 'custom')}</div>`;
}
```

- [ ] **Step 4: Register them**

In `site/blocks/registry.mjs`, add after the photo block imports:

```js
import * as columns from './columns.mjs';
import * as contact from './contact.mjs';
import * as embed from './embed.mjs';
import * as customHtml from './custom-html.mjs';
```

and replace the `TYPES` line with:

```js
const TYPES = [hero, heading, richText, image, imageText, galleryCards, photoGrid, button, spacer, columns, contact, embed, customHtml];
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test site/test/blocks-layout.test.mjs site/test/blocks-photo.test.mjs site/test/blocks-text.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit (commit only after the user approves)**

```bash
git add site/blocks/columns.mjs site/blocks/contact.mjs site/blocks/embed.mjs site/blocks/custom-html.mjs site/blocks/registry.mjs site/test/blocks-layout.test.mjs
git commit -m "Website: columns, contact details, video and map, and custom HTML blocks"
```

---

### Task 6: Pages model: migration, gallery sync and checks

**Files:**
- Create: `site/pages.mjs`
- Test: `site/test/pages.test.mjs`

**Interfaces:**
- Consumes: `validateBlocks`, `countBlocks`, `BLOCK_TYPES` (Tasks 3–5); `text`, `STYLE_DEFAULTS`, `MOTION_DEFAULTS` (Task 3).
- Produces:
  - Stored page shape: `{ id, title, slug, inMenu, seoTitle, seoDescription, galleryId: number | null, blocks }` (`galleryId` ties a gallery's page to it).
  - `PAGE_LIMITS = { pages: 40, blocks: 80, title: 120, seoTitle: 120, seoDescription: 300, slug: 60 }`, `RESERVED_PAGE_SLUGS`.
  - `migratePages(settings, galleries) => page[]` — ids `home`, `g<galleryId>`, `about`, `contact`; block ids `home-cards`, `g<id>-grid`, `about-main`, `contact-banner`, `contact-details`.
  - `galleryPage(gallery) => page`.
  - `resolvePages(pages, galleries) => page[]` — drops pages of deleted galleries, adds pages for new galleries after the last gallery page, copies gallery title and slug.
  - `isShownPage(page, galleriesById: Map) => boolean`.
  - `pageHref(page, base) => string`.
  - `cleanPages(raw, { galleries: [{id, slug, title}], photoIds: Set<number> }) => { pages: page[] | null, errors: string[] }`.

- [ ] **Step 1: Write the failing tests**

`site/test/pages.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratePages, resolvePages, cleanPages, pageHref, isShownPage, PAGE_LIMITS } from '../pages.mjs';
import { state } from './fixtures.mjs';

const gals = s => s.galleries.map(({ id, slug, title }) => ({ id, slug, title }));
const check = (pages, s = state()) => cleanPages(pages, { galleries: gals(s), photoIds: new Set([1, 2, 3, 90, 91]) });
const extra = (id, slug, blocks = []) => ({ id, title: `Page ${id}`, slug, inMenu: false, seoTitle: '', seoDescription: '', galleryId: null, blocks });

test('the old fixed pages become blocks: home cards, a grid per gallery, About, Contact', () => {
  const s = state(), p = migratePages(s.settings, s.galleries);
  assert.deepEqual(p.map(x => [x.id, x.slug, x.inMenu, x.galleryId]), [['home', '', true, null], ['g1', 'Autumn-Wedding', false, 1],
    ['g2', 'Secret', false, 2], ['g3', 'Empty', false, 3], ['about', 'about', true, null], ['contact', 'contact', true, null]]);
  assert.deepEqual(p.map(x => x.title), ['Home', 'Autumn Wedding', 'Secret', 'Empty', 'About', 'Contact']);
  assert.deepEqual(p[0].blocks.map(b => [b.id, b.type]), [['home-cards', 'gallery-cards']]);
  assert.deepEqual(p[1].blocks.map(b => [b.id, b.type, b.props.galleryId]), [['g1-grid', 'photo-grid', 1]]);
  assert.deepEqual(p[4].blocks[0].props, { photoId: 90, heading: 'About', text: 'Hello <script>x</script>\n\nSecond', alt: '', photoSide: 'left', hover: 'none' });
  assert.deepEqual(p[5].blocks.map(b => b.type), ['hero', 'contact']);
  assert.deepEqual([p[5].blocks[0].props.photoId, p[5].blocks[0].props.heading], [91, 'Contact']);
  assert.deepEqual(p[5].blocks[1].props, { heading: 'Contact us', email: 'someone@example.com', phone: '555 0100' });
});

test('pages follow the galleries: new ones get a page, deleted ones lose theirs, renames carry over', () => {
  const s = state();
  const pages = migratePages(s.settings, s.galleries.slice(0, 2));
  const now = [{ ...s.galleries[0], title: 'Renamed', slug: 'Autumn-Wedding' }, s.galleries[2]];
  const r = resolvePages(pages, now);
  assert.deepEqual(r.map(p => p.id), ['home', 'g1', 'g3', 'about', 'contact']);
  assert.equal(r[1].title, 'Renamed');
  assert.equal(r[2].blocks[0].type, 'photo-grid');
  assert.deepEqual(resolvePages([], s.galleries.slice(0, 1)).map(p => p.id), ['g1']);
});

test('the page of a hidden or empty gallery is not shown; other pages are', () => {
  const s = state(), by = new Map(s.galleries.map(g => [g.id, g]));
  const p = migratePages(s.settings, s.galleries);
  assert.deepEqual(p.filter(x => isShownPage(x, by)).map(x => x.id), ['home', 'g1', 'about', 'contact']);
});

test('page links carry the base and encode the address', () => {
  assert.equal(pageHref({ slug: '' }, '/admin/site-preview/'), '/admin/site-preview/');
  assert.equal(pageHref({ slug: 'about' }, '/'), '/about/');
  assert.equal(pageHref({ slug: 'a b' }, '/'), '/a%20b/');
});

test('pages made from the old settings pass the checks unchanged', () => {
  const s = state(), p = migratePages(s.settings, s.galleries);
  const r = check(p, s);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.pages, p);
});

test('web addresses: lower-case, unique, not the site’s own, not a gallery’s', () => {
  const s = state(), base = migratePages(s.settings, s.galleries);
  assert.match(check([...base, extra('pa', 'img')]).errors.join('\n'), /\/img\/ is used by the site itself/);
  assert.match(check([...base, extra('pb', 'autumn-wedding')]).errors.join('\n'), /\/autumn-wedding\/ is a gallery’s address/);
  assert.match(check([...base, extra('pc', 'about')]).errors.join('\n'), /another page already uses \/about\//);
  assert.match(check([...base, extra('pd', 'Bad Slug!')]).errors.join('\n'), /only use a-z, 0-9 and dashes/);
  assert.deepEqual(check([...base, extra('pe', 'news')]).errors, []);
});

test('exactly one home page; at most one photo grid per page', () => {
  const s = state(), base = migratePages(s.settings, s.galleries);
  assert.match(check(base.filter(p => p.id !== 'home')).errors.join('\n'), /Keep exactly one home page/);
  const two = [...base, extra('pf', 'twice', [{ id: 'q1', type: 'photo-grid', props: { galleryId: 1 } }, { id: 'q2', type: 'photo-grid', props: { galleryId: 1 } }])];
  assert.match(check(two).errors.join('\n'), /"Page pf": a page can hold one photo grid/);
});

test('missing photos become empty, and the page of a deleted gallery is dropped', () => {
  const s = state(), p = migratePages(s.settings, s.galleries);
  p.find(x => x.id === 'about').blocks[0].props.photoId = 999;
  p.push({ ...extra('g77', 'Gone'), galleryId: 77 });
  const r = check(p, s);
  assert.deepEqual(r.errors, []);
  assert.equal(r.pages.find(x => x.id === 'about').blocks[0].props.photoId, null);
  assert.ok(!r.pages.some(x => x.id === 'g77'));
});

test('a gallery page always takes its gallery’s name and address', () => {
  const s = state(), p = migratePages(s.settings, s.galleries);
  Object.assign(p[1], { title: 'Mine', slug: 'mine' });
  const r = check(p, s);
  assert.deepEqual([r.pages[1].title, r.pages[1].slug], ['Autumn Wedding', 'Autumn-Wedding']);
});

test('block problems name the page and the block', () => {
  const s = state(), p = migratePages(s.settings, s.galleries);
  p[0].blocks.push({ id: 'zz1', type: 'nope' });
  assert.equal(check(p, s).errors[0], '"Home": unknown block type "nope"');
});

test('limits on the number of pages and blocks', () => {
  const s = state(), base = migratePages(s.settings, s.galleries);
  const many = Array.from({ length: PAGE_LIMITS.pages }, (_, i) => extra(`p${i}`, `p${i}`));
  assert.match(check([...base, ...many]).errors.join('\n'), /at most 40 pages/);
  const big = extra('pbig', 'big', Array.from({ length: PAGE_LIMITS.blocks + 1 }, (_, i) => ({ id: `s${i}`, type: 'spacer' })));
  assert.match(check([...base, big]).errors.join('\n'), /"Page pbig": at most 80 blocks on a page/);
  assert.match(check('nope').errors[0], /Pages must be a list/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test site/test/pages.test.mjs`
Expected: FAIL with `Cannot find module '.../site/pages.mjs'`.

- [ ] **Step 3: Write `site/pages.mjs`**

```js
/* The website's pages. A site that has never saved pages gets them made from its old settings (Home, a page per
   gallery, About, Contact), on the fly and without writing anything, so an old site builds exactly as before.
   Gallery pages follow their galleries: a new gallery gets a page, a deleted one loses its page, and a gallery page
   always has its gallery's name and address. Pure. */
import { validateBlocks, countBlocks, BLOCK_TYPES } from './blocks/registry.mjs';
import { text, STYLE_DEFAULTS, MOTION_DEFAULTS } from './blocks/common.mjs';

export const PAGE_LIMITS = Object.freeze({ pages: 40, blocks: 80, title: 120, seoTitle: 120, seoDescription: 300, slug: 60 });
/* addresses the built site uses for itself; every other reserved name in store.mjs (about, contact, files) is either
   a page of its own or cannot match the slug pattern */
export const RESERVED_PAGE_SLUGS = new Set(['img']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

const block = (id, type, props) => ({ id, type, props: { ...structuredClone(BLOCK_TYPES.get(type).defaults), ...props },
  style: { ...STYLE_DEFAULTS }, motion: { ...MOTION_DEFAULTS } });
const page = (id, title, slug, blocks) => ({ id, title, slug, inMenu: true, seoTitle: '', seoDescription: '', galleryId: null, blocks });

export function galleryPage(g) {
  return { id: `g${g.id}`, title: g.title, slug: g.slug, inMenu: false, seoTitle: '', seoDescription: '', galleryId: g.id,
           blocks: [block(`g${g.id}-grid`, 'photo-grid', { galleryId: g.id })] };
}

export function migratePages(s, galleries) {
  return [
    page('home', 'Home', '', [block('home-cards', 'gallery-cards', {})]),
    ...galleries.map(galleryPage),
    page('about', 'About', 'about', [block('about-main', 'image-text', { photoId: s.about.photoId, heading: s.about.heading, text: s.about.text })]),
    page('contact', 'Contact', 'contact', [
      block('contact-banner', 'hero', { photoId: s.contact.bannerPhotoId, heading: 'Contact' }),
      block('contact-details', 'contact', { heading: s.contact.heading, email: s.contact.email, phone: s.contact.phone }),
    ]),
  ];
}

export function resolvePages(pages, galleries) {
  const byId = new Map(galleries.map(g => [g.id, g]));
  const out = pages.filter(p => p.galleryId == null || byId.has(p.galleryId))
    .map(p => (p.galleryId == null ? p : { ...p, title: byId.get(p.galleryId).title, slug: byId.get(p.galleryId).slug }));
  const have = new Set(out.map(p => p.galleryId).filter(id => id != null));
  for (const g of galleries) {
    if (have.has(g.id)) continue;
    let at = out.findLastIndex(p => p.galleryId != null);
    if (at < 0) at = out.findIndex(p => p.slug === '');
    out.splice(at + 1, 0, galleryPage(g));
  }
  return out;
}

/* a gallery's page is left off the site while the gallery is hidden or has no photos, as before */
export function isShownPage(p, galleriesById) {
  if (p.galleryId == null) return true;
  const g = galleriesById.get(p.galleryId);
  return !!(g && !g.hidden && g.photos.length);
}

export const pageHref = (p, base) => base + (p.slug ? `${encodeURIComponent(p.slug)}/` : '');

export function cleanPages(raw, { galleries, photoIds }) {
  if (!Array.isArray(raw)) return { pages: null, errors: ['Pages must be a list'] };
  const errors = [];
  if (raw.length > PAGE_LIMITS.pages) errors.push(`A site can have at most ${PAGE_LIMITS.pages} pages`);
  const gal = new Map(galleries.map(g => [g.id, g]));
  const gallerySlugs = new Set(galleries.map(g => g.slug.toLowerCase()));
  const vctx = { photoIds, galleryIds: new Set(gal.keys()), blockIds: new Set(), depth: 0 };
  const seenIds = new Set(), seenSlugs = new Set(), pages = [];
  raw.slice(0, PAGE_LIMITS.pages).forEach((p, i) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) { errors.push(`Page ${i + 1} is not a page`); return; }
    const id = String(p.id ?? '');
    if (!ID.test(id) || seenIds.has(id)) { errors.push(`Page ${i + 1} has a missing or repeated id`); return; }
    seenIds.add(id);
    const galleryId = Number.isInteger(p.galleryId) ? p.galleryId : null;
    if (galleryId != null && !gal.has(galleryId)) return;            /* its gallery was deleted: the page goes too */
    const g = galleryId != null ? gal.get(galleryId) : null;
    const title = g ? g.title : text(p.title, PAGE_LIMITS.title);
    const name = `"${title || `Page ${i + 1}`}"`;
    if (!title) errors.push(`${name}: give the page a name`);
    const slug = g ? g.slug : String(p.slug ?? '').trim().toLowerCase();
    if (!g && slug !== '') {
      if (!SLUG.test(slug) || slug.length > PAGE_LIMITS.slug) errors.push(`${name}: a web address can only use a-z, 0-9 and dashes`);
      else if (RESERVED_PAGE_SLUGS.has(slug)) errors.push(`${name}: /${slug}/ is used by the site itself`);
      else if (gallerySlugs.has(slug)) errors.push(`${name}: /${slug}/ is a gallery’s address`);
    }
    if (seenSlugs.has(slug.toLowerCase())) errors.push(`${name}: another page already uses /${slug}${slug ? '/' : ''}`);
    seenSlugs.add(slug.toLowerCase());
    const r = validateBlocks(p.blocks, vctx);
    for (const e of r.errors) errors.push(`${name}: ${e}`);
    if (countBlocks(r.blocks) > PAGE_LIMITS.blocks) errors.push(`${name}: at most ${PAGE_LIMITS.blocks} blocks on a page`);
    if (r.blocks.filter(b => b.type === 'photo-grid').length > 1) errors.push(`${name}: a page can hold one photo grid`);
    pages.push({ id, title, slug, inMenu: p.inMenu === true, seoTitle: text(p.seoTitle, PAGE_LIMITS.seoTitle),
                 seoDescription: text(p.seoDescription, PAGE_LIMITS.seoDescription), galleryId, blocks: r.blocks });
  });
  if (pages.filter(p => p.slug === '').length !== 1) errors.push('Keep exactly one home page');
  return errors.length ? { pages: null, errors } : { pages, errors: [] };
}
```

Note on the "Page pf" test names: `extra()` titles pages `Page <id>`, so the error prefix is `"Page pf"`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test site/test/pages.test.mjs`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit (commit only after the user approves)**

```bash
git add site/pages.mjs site/test/pages.test.mjs
git commit -m "Website: pages made from the old settings, kept in step with galleries, and checked"
```

---

### Task 7: Block stylesheet and animation script

**Files:**
- Create: `site/assets/blocks.css`, `site/assets/motion.js`
- Test: `site/test/motion.test.mjs`

**Interfaces:**
- Consumes: `ENTRANCES`, `HOVER_IMAGE`, `BUTTON_HOVER` (Task 3); markup classes from Tasks 3–5 (`hd`, `rich`, `img-block`, `frame`, `cap`, `about-right`, `hero-*`, `sbtn*`, `bh-*`, `hv-*`, `spacer`, `sp-*`, `cols*`, `gap-*`, `embed`, `r-*`, `custom-html`, `blk*`, `pad-*`, `al-*`, `w-*`, `vis-*`, `m`, `m-*`, `m-once`, `in`, `px`).
- Produces: the two asset files Task 8 appends to `style.css` and `site.js`. The page `<html>` gets class `anim` only when the script runs and motion is allowed; entering blocks get class `in`.

- [ ] **Step 1: Write the failing tests**

`site/test/motion.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ENTRANCES, HOVER_IMAGE, BUTTON_HOVER } from '../blocks/common.mjs';

const CSS = readFileSync(new URL('../assets/blocks.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const MOTION = readFileSync(new URL('../assets/motion.js', import.meta.url), 'utf8');

function media(query) {
  const at = CSS.indexOf(`@media (${query})`);
  assert.ok(at >= 0, `missing @media (${query})`);
  let i = CSS.indexOf('{', at), d = 0;
  const start = i;
  for (; i < CSS.length; i++) { if (CSS[i] === '{') d++; else if (CSS[i] === '}' && --d === 0) break; }
  return { body: CSS.slice(start + 1, i), from: at, to: i + 1 };
}
const topLevel = s => { const out = []; let d = 0, cur = ''; for (const c of s) { if (c === '(') d++; if (c === ')') d--; if (c === ',' && !d) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };

test('the hidden start of an entrance applies only once the script has run, and never for reduced motion', () => {
  const m = media('prefers-reduced-motion: no-preference');
  const outside = CSS.slice(0, m.from) + CSS.slice(m.to);
  assert.doesNotMatch(outside, /\.anim\b/);
  assert.doesNotMatch(outside, /:not\(\.in\)/);
  const hidden = m.body.split('}').filter(r => r.includes(':not(.in)'));
  assert.ok(hidden.length >= ENTRANCES.length - 2);
  for (const r of hidden) assert.match(r.trim(), /^\.anim /, r);
});

test('every entrance has a start state', () => {
  const m = media('prefers-reduced-motion: no-preference').body;
  assert.match(m, /\.anim \.blk\.m:not\(\.in\) \{ opacity: 0; \}/);
  for (const e of ENTRANCES.filter(x => x !== 'none' && x !== 'fade')) assert.ok(m.includes(`.anim .m-${e}:not(.in)`), e);
});

test('only transform and opacity are ever animated', () => {
  assert.doesNotMatch(CSS, /@keyframes|animation\s*:/);
  const decls = [...CSS.matchAll(/transition(?:-property)?\s*:\s*([^;}]+)/g)].map(m => m[1]);
  assert.ok(decls.length > 5);
  for (const d of decls) for (const part of topLevel(d)) {
    assert.ok(['opacity', 'transform', 'none'].includes(part.trim().split(/\s+/)[0]), `animates more than transform/opacity: ${d}`);
  }
});

test('reduced motion also stills hover effects', () => {
  const r = media('prefers-reduced-motion: reduce').body;
  assert.match(r, /transition: none !important/);
  assert.match(r, /transform: none/);
});

test('every hover effect the blocks offer has a rule', () => {
  for (const [v] of HOVER_IMAGE.filter(o => o[0] !== 'none')) assert.ok(CSS.includes(`.hv-${v}`), v);
  for (const [v] of BUTTON_HOVER) assert.ok(CSS.includes(`.bh-${v}`), v);
});

/* motion.js against a pretend page */
const classList = set => ({ add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c) });
const block = (...cls) => { const set = new Set(['blk', 'm', ...cls]); return { set, classList: classList(set) }; };
function run({ reduce = false, io = true, blocks = [], layers = [] } = {}) {
  const html = new Set(), observed = new Set(), handlers = {};
  let cb = null;
  const ctx = {
    document: { documentElement: { classList: classList(html) },
      querySelectorAll: sel => (sel === '.blk.m' ? blocks : sel === '.blk.px > .blk-bg' ? layers : []) },
    matchMedia: q => ({ matches: reduce && q.includes('reduce') }),
    innerHeight: 800,
    addEventListener: (t, f) => { handlers[t] = f; },
    requestAnimationFrame: f => f(),
  };
  if (io) ctx.IntersectionObserver = class { constructor(f) { cb = f; } observe(e) { observed.add(e); } unobserve(e) { observed.delete(e); } };
  ctx.window = ctx;
  vm.runInNewContext(MOTION, ctx);
  return { html, observed, handlers, fire: entries => cb(entries) };
}

test('blocks enter as they come into view; once means once', () => {
  const a = block('m-fade', 'm-once'), b = block('m-slide-up');
  const p = run({ blocks: [a, b] });
  assert.ok(p.html.has('anim'));
  p.fire([{ target: a, isIntersecting: true }, { target: b, isIntersecting: true }]);
  assert.ok(a.set.has('in') && b.set.has('in'));
  assert.ok(!p.observed.has(a), 'a once-only block stops being watched');
  p.fire([{ target: b, isIntersecting: false }]);
  assert.ok(!b.set.has('in'), 'an every-time block hides again to replay');
});

test('nothing is hidden when the visitor asks for less motion, or the browser has no IntersectionObserver', () => {
  assert.ok(!run({ reduce: true, blocks: [block('m-fade')] }).html.has('anim'));
  assert.ok(!run({ io: false, blocks: [block('m-fade')] }).html.has('anim'));
});

test('parallax moves the background layer with the scroll, and not at all for reduced motion', () => {
  const layer = () => ({ style: {}, parentNode: { getBoundingClientRect: () => ({ top: 0, bottom: 400, height: 400 }) } });
  const l = layer();
  const p = run({ layers: [l] });
  assert.equal(l.style.transform, 'translate3d(0, 2.50%, 0)');
  assert.equal(typeof p.handlers.scroll, 'function');
  const still = layer();
  run({ reduce: true, layers: [still] });
  assert.equal(still.style.transform, undefined);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test site/test/motion.test.mjs`
Expected: FAIL with `ENOENT: no such file or directory, open '.../site/assets/blocks.css'`.

- [ ] **Step 3: Write `site/assets/blocks.css`**

```css
/* Blocks, and their style, motion and hover settings. build.mjs adds this after site.css once the site's pages have
   been saved from the page editor; a site that never used the editor keeps exactly the old stylesheet.
   Only transform and opacity are ever animated. */

/* ---- the wrapper a block gets when it has style or motion ---- */
.blk { position: relative; }
.blk.bg-color { background: var(--bg); }
.blk.bg-photo { overflow: hidden; color: #fff; }
.blk-bg { position: absolute; inset: 0; background: #111 center / cover no-repeat; z-index: 0; }
.blk.px > .blk-bg { inset: -15% 0; will-change: transform; }
.blk > :not(.blk-bg) { position: relative; z-index: 1; }
.pad-s { padding-block: 1.2rem; }
.pad-m { padding-block: 3rem; }
.pad-l { padding-block: 6rem; }
.w-contained { max-width: 64rem; margin-inline: auto; padding-inline: 1rem; }
.w-full > * { max-width: none; }
.al-left { text-align: left; }
.al-center { text-align: center; }
.al-right { text-align: right; }
@media (max-width: 760px) { .vis-desktop { display: none; } }
@media (min-width: 761px) { .vis-phone { display: none; } }

/* ---- blocks ---- */
.hd { font-family: var(--font-head); color: var(--ink); font-weight: 400; line-height: 1.3; max-width: 56rem; margin: 2.4rem auto 1rem; padding: 0 1rem; text-align: center; }
.hd-small { font-size: 1.1rem; }
.hd-medium { font-size: 1.5rem; }
.hd-large { font-size: 2.3rem; }
.rich, .custom-html { max-width: 44rem; margin: 1.2rem auto; padding: 0 1rem; }
.rich p + p, .rich ul, .rich ol, .rich blockquote { margin-top: .9rem; }
.rich ul, .rich ol { padding-left: 1.4rem; }
.rich h2, .rich h3, .rich h4 { font-family: var(--font-head); color: var(--ink); font-weight: 400; margin: 1.6rem 0 .6rem; }
.rich a, .custom-html a { text-decoration: underline; }
.rich blockquote { border-left: 2px solid var(--band); padding-left: 1rem; font-style: italic; }
.img-block { margin: 1.8rem auto; padding: 0 1rem; text-align: center; }
.img-block img { margin: 0 auto; }
.size-small { max-width: 18rem; }
.size-medium { max-width: 32rem; }
.size-large { max-width: 56rem; }
.size-full { max-width: none; padding: 0; }
.img-block figcaption { font-size: .85rem; margin-top: .6rem; color: var(--ink); }
.frame { display: block; position: relative; overflow: hidden; }
.about-right { flex-direction: row-reverse; }
.about-right .about-card { margin-left: 0; margin-right: -3.4rem; }
.banner { position: relative; }
.banner.hero-tall { height: min(80vh, 40rem); }
.banner.hero-full { height: 100svh; }
.hero-shade { position: absolute; inset: 0; background: #000; }
.hero-in { position: relative; text-align: center; color: #fff; padding: 0 1rem; }
.hero-in h1 { color: #fff; font: 500 2.3rem var(--font-head); text-transform: uppercase; letter-spacing: .07rem; }
.hero-sub { margin-top: .6rem; font-size: 1.05rem; text-align: center; }
.btn-row { text-align: center; margin: 1.6rem 0; }
.sbtn { position: relative; display: inline-block; isolation: isolate; padding: .7rem 1.8rem; font: 500 .9rem var(--font-head); letter-spacing: .08rem; text-transform: uppercase; border: 1px solid var(--ink); }
.sbtn-solid { background: var(--ink); color: var(--page); }
.sbtn-outline { color: var(--ink); }
.hero-in .sbtn { margin-top: 1.4rem; border-color: #fff; }
.spacer { display: flex; align-items: center; max-width: 56rem; margin: 0 auto; padding: 0 1rem; }
.sp-small { height: 1.5rem; }
.sp-medium { height: 3.5rem; }
.sp-large { height: 7rem; }
.spacer hr { flex: 1; border: 0; border-top: 1px solid var(--band); }
.cols { display: grid; gap: 2rem; max-width: 64rem; margin: 1.8rem auto; padding: 0 1rem; align-items: start; }
.cols-2 { grid-template-columns: 1fr 1fr; }
.cols-3 { grid-template-columns: repeat(3, 1fr); }
.gap-tight { gap: 1rem; }
.gap-roomy { gap: 3.5rem; }
.col > .hd, .col > .rich, .col > .img-block, .col > .custom-html, .col > .embed { padding: 0; }
.embed { max-width: 56rem; margin: 1.8rem auto; padding: 0 1rem; }
.embed iframe { display: block; width: 100%; height: auto; border: 0; background: var(--band); }
.r-16x9 iframe { aspect-ratio: 16 / 9; }
.r-4x3 iframe { aspect-ratio: 4 / 3; }
.r-1x1 iframe { aspect-ratio: 1 / 1; }
@media (max-width: 760px) {
  .cols-2, .cols-3 { grid-template-columns: 1fr; }
  .about-right { flex-direction: column; }
  .about-right .about-card { margin: -2rem 0 0; }
  .hd-large { font-size: 1.8rem; }
}

/* ---- hover effects on photos ---- */
.hv-zoom :is(.card, .m-item) { display: block; overflow: hidden; }
.hv-zoom img { transition: transform .5s ease; }
.hv-zoom :is(.card, .m-item):hover img, .img-block.hv-zoom:hover img, .about.hv-zoom .about-photo:hover { transform: scale(1.05); }
.hv-lift :is(.card, .m-item), .img-block.hv-lift .frame, .about.hv-lift .about-photo { display: block; transition: transform .3s ease; }
.hv-lift :is(.card, .m-item):hover, .img-block.hv-lift:hover .frame, .about.hv-lift .about-photo:hover { transform: translateY(-6px); }
.hv-darken :is(.card, .m-item) { display: block; position: relative; }
.hv-darken :is(.card, .m-item)::after, .img-block.hv-darken .frame::after { content: ""; position: absolute; inset: 0; background: #000; opacity: 0; transition: opacity .3s ease; pointer-events: none; }
.hv-darken :is(.card, .m-item):hover::after, .img-block.hv-darken:hover .frame::after { opacity: .28; }
.hv-caption .cap { opacity: 0; transform: translateY(.4rem); transition: opacity .3s ease, transform .3s ease; }
.hv-caption .card:is(:hover, :focus-visible) .cap, .img-block.hv-caption:is(:hover, :focus-within) .cap { opacity: 1; transform: none; }
@media (hover: none) { .hv-caption .cap { opacity: 1; transform: none; } }

/* ---- hover effects on buttons ---- */
.bh-fill { overflow: hidden; }
.bh-fill::before { content: ""; position: absolute; inset: 0; z-index: -1; background: var(--text); transform: scaleX(0); transform-origin: left; transition: transform .35s ease; }
.sbtn-outline.bh-fill::before { background: var(--ink); }
.bh-fill:hover::before { transform: scaleX(1); }
.sbtn-outline.bh-fill:hover { color: var(--page); }
.bh-lift { transition: transform .25s ease; }
.bh-lift:hover { transform: translateY(-3px); }
.bh-glow::after { content: ""; position: absolute; inset: 0; box-shadow: 0 0 1.2rem var(--ink); opacity: 0; transition: opacity .3s ease; pointer-events: none; }
.bh-glow:hover::after { opacity: .6; }

/* ---- entrances: hidden only once motion.js has added .anim, and only if the visitor allows motion ---- */
@media (prefers-reduced-motion: no-preference) {
  .anim .blk.m { transition: opacity var(--m-dur, 700ms) ease var(--m-delay, 0ms), transform var(--m-dur, 700ms) cubic-bezier(.2, .7, .2, 1) var(--m-delay, 0ms); }
  .anim .blk.m:not(.in) { opacity: 0; }
  .anim .m-slide-up:not(.in) { transform: translateY(2.5rem); }
  .anim .m-slide-down:not(.in) { transform: translateY(-2.5rem); }
  .anim .m-slide-left:not(.in) { transform: translateX(2.5rem); }
  .anim .m-slide-right:not(.in) { transform: translateX(-2.5rem); }
  .anim .m-zoom-in:not(.in) { transform: scale(.92); }
  .anim .m-blur-in:not(.in) { transform: scale(1.04); }
}

/* ---- less motion: hover effects stand still too ---- */
@media (prefers-reduced-motion: reduce) {
  .hv-zoom img, .hv-lift :is(.card, .m-item), .img-block.hv-lift .frame, .about.hv-lift .about-photo, .hv-darken :is(.card, .m-item)::after,
  .img-block.hv-darken .frame::after, .hv-caption .cap, .sbtn, .sbtn::before, .sbtn::after { transition: none !important; }
  .hv-zoom :is(.card, .m-item):hover img, .img-block.hv-zoom:hover img, .about.hv-zoom .about-photo:hover,
  .hv-lift :is(.card, .m-item):hover, .img-block.hv-lift:hover .frame, .about.hv-lift .about-photo:hover, .bh-lift:hover { transform: none; }
}
```

- [ ] **Step 4: Write `site/assets/motion.js`**

```js
// Block animations: entrance effects as blocks come into view, and parallax backgrounds.
// Nothing is hidden until this has run (blocks.css only hides under .anim), and nothing moves for visitors whose
// device asks for less motion. Only transform and opacity change.
(function () {
  if (!window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const entering = document.querySelectorAll('.blk.m');
  if (entering.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const c = e.target.classList;
        if (e.isIntersecting) { c.add('in'); if (c.contains('m-once')) io.unobserve(e.target); }
        else if (!c.contains('m-once')) c.remove('in');
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
    document.documentElement.classList.add('anim');
    entering.forEach(el => io.observe(el));
  }
  const layers = [...document.querySelectorAll('.blk.px > .blk-bg')];
  if (!layers.length) return;
  let ticking = false;
  function move() {
    ticking = false;
    const vh = innerHeight;
    for (const bg of layers) {
      const r = bg.parentNode.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue;
      const k = (r.top + r.height / 2 - vh / 2) / vh;
      bg.style.transform = `translate3d(0, ${(k * -10).toFixed(2)}%, 0)`;
    }
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(move); } }, { passive: true });
  addEventListener('resize', move);
  move();
})();
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test site/test/motion.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit (commit only after the user approves)**

```bash
git add site/assets/blocks.css site/assets/motion.js site/test/motion.test.mjs
git commit -m "Website: block stylesheet, entrance and hover effects, parallax script"
```

---

### Task 8: The builder renders pages

**Files:**
- Modify: `site/build.mjs` (whole file)
- Create: `site/assets/edit-bridge.js`
- Test: `site/test/build-pages.test.mjs` (plus the existing `golden.test.mjs` and `build.test.mjs` must stay green)

**Interfaces:**
- Consumes: `renderBlocks` (Task 3); `esc` (Task 3); `migratePages`, `resolvePages`, `isShownPage`, `pageHref` (Task 6); `blocks.css`, `motion.js` (Task 7).
- Produces: `build(state, { base = '/', siteUrl = '', editor = false }) => { files, images }`. `state.pages` may be absent/null (unsaved: pages made from settings, old CSS/JS) or a cleaned page list (blocks.css and motion.js appended). `editor: true` inlines the stylesheet, site script and `edit-bridge.js` (self-contained HTML for `iframe srcdoc`), wraps every block with `data-b`, includes hidden blocks and hidden-gallery pages. `export { esc }` and `HEADERS` stay.
- Editor preview messages (consumed by Task 11): from the preview `{ type: 'wb-select', id }`, `{ type: 'wb-scrolled', y }`; to the preview `{ type: 'wb-select', id, scroll }`, `{ type: 'wb-scroll', y }`.

- [ ] **Step 1: Write the failing tests**

`site/test/build-pages.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../build.mjs';
import { migratePages } from '../pages.mjs';
import { state } from './fixtures.mjs';
import { mk } from './block-helpers.mjs';

const asset = n => readFileSync(new URL(`../assets/${n}`, import.meta.url), 'utf8');
const saved = () => { const s = state(); s.pages = migratePages(s.settings, s.galleries); return s; };

test('saved pages made from the old settings build the same pages; only the stylesheet and script grow', () => {
  const old = build(state()), now = build(saved());
  assert.deepEqual([...now.files.keys()].sort(), [...old.files.keys()].sort());
  for (const [k, v] of old.files) {
    if (k === 'style.css') assert.equal(now.files.get(k), v + asset('blocks.css'));
    else if (k === 'site.js') assert.equal(now.files.get(k), v + asset('motion.js'));
    else assert.equal(now.files.get(k), v, k);
  }
  assert.deepEqual([...now.images].sort(), [...old.images].sort());
});

test('a site that never saved pages gets no block CSS or motion script', () => {
  const { files } = build(state());
  assert.equal(files.get('site.js'), asset('site.js'));
  assert.ok(!files.get('style.css').includes('.blk-bg'));
});

test('the menu lists the pages marked for it, in page order; a new page gets its own address and SEO fields', () => {
  const s = saved();
  s.pages.splice(1, 0, { id: 'pwork', title: 'Work & Play', slug: 'work', inMenu: true, seoTitle: 'Our work', seoDescription: 'What we made',
    galleryId: null, blocks: [mk('bw1', 'heading', { text: 'Hello <there>' })] });
  s.pages.find(p => p.id === 'contact').inMenu = false;
  const { files } = build(s);
  assert.match(files.get('index.html'), /<nav><a href="\/">Home<\/a><a href="\/work\/">Work &amp; Play<\/a><a href="\/about\/">About<\/a><\/nav>/);
  const work = files.get('work/index.html');
  assert.match(work, /<title>Our work - Example Studio<\/title>/);
  assert.match(work, /<meta name="description" content="What we made">/);
  assert.match(work, /<main>\n<h2 class="hd hd-medium">Hello &lt;there&gt;<\/h2>\n<\/main>/);
  assert.ok(files.has('contact/index.html'), 'off the menu is not off the site');
});

test('motion and style become classes and custom properties on a wrapper', () => {
  const s = saved();
  s.pages[0].blocks.push(mk('bm1', 'heading', { text: 'Moving' }, { padding: 'large', align: 'center' },
    { entrance: 'slide-up', duration: 900, delay: 150, repeat: 'every' }));
  assert.ok(build(s).files.get('index.html').includes(
    '<div class="blk pad-l al-center m m-slide-up" data-b="bm1" style="--m-dur:900ms;--m-delay:150ms"><h2 class="hd hd-medium">Moving</h2></div>'));
});

test('a parallax background photo is its own layer, and is published', () => {
  const s = saved();
  s.pages[0].blocks.push(mk('bp1', 'spacer', {}, { background: 'photo', bgPhotoId: 90 }, { background: 'parallax' }));
  const { files, images } = build(s);
  assert.ok(files.get('index.html').includes(`<div class="blk bg-photo px" data-b="bp1"><div class="blk-bg" style="background-image:url('/img/pfp-full.jpg')"></div><div class="spacer sp-medium" aria-hidden="true"></div></div>`));
  assert.ok(images.has('img/pfp-full.jpg'));
});

test('hidden blocks are left out of the site', () => {
  const s = saved();
  s.pages[0].blocks.push(mk('bh1', 'heading', { text: 'Secret words' }, { visible: 'none' }));
  assert.ok(!build(s).files.get('index.html').includes('Secret words'));
});

test('the editor build is self-contained, marks every block, and shows hidden ones', () => {
  const s = saved();
  s.pages[0].blocks.push(mk('bh2', 'heading', { text: 'Secret words' }, { visible: 'none' }));
  const html = build(s, { base: '/admin/site-preview/', editor: true }).files.get('index.html');
  assert.ok(!html.includes('<link rel="stylesheet"'));
  assert.ok(!html.includes('<script src='));
  assert.ok(html.includes('data-b="home-cards"'));
  assert.ok(html.includes('<div class="blk blk-off" data-b="bh2">'));
  assert.ok(html.includes('wb-select'), 'the editor bridge is inlined');
  assert.ok(html.includes('.blk-bg'), 'block CSS is inlined even before the first save');
  assert.equal((html.match(/<script>/g) || []).length, 2);
  assert.equal((html.match(/<\/script>/g) || []).length, 2, 'nothing inlined closes a script early');
  assert.ok(build(s, { editor: true }).files.has('Secret/index.html'), 'a hidden gallery’s page can still be edited');
  assert.ok(!build(s).files.has('Secret/index.html'));
});

test('an unsaved site in the editor uses the pages made from its settings', () => {
  const html = build(state(), { base: '/admin/site-preview/', editor: true }).files.get('about/index.html');
  assert.match(html, /<div class="blk" data-b="about-main"><section class="about">/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test site/test/build-pages.test.mjs`
Expected: FAIL — the first test fails with `style.css` lacking the blocks CSS (`build` ignores `state.pages`).

- [ ] **Step 3: Write `site/assets/edit-bridge.js`**

```js
// Only in the page editor's preview (inlined by build.mjs in editor mode, never published): clicking a block selects it
// in the editor instead of following links or opening the photo viewer, and the editor can highlight a block and keep
// the scroll position across redraws. The preview is an iframe srcdoc, whose origin is the editor's own (self.origin).
(function () {
  if (window.parent === window) return;
  const ORIGIN = self.origin;
  const post = m => parent.postMessage(m, ORIGIN);
  let current = null;
  function mark(id, scroll) {
    if (current) current.classList.remove('wb-sel');
    current = id ? document.querySelector(`[data-b="${CSS.escape(id)}"]`) : null;
    if (current) { current.classList.add('wb-sel'); if (scroll) current.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  addEventListener('click', ev => {
    ev.preventDefault(); ev.stopPropagation();
    const b = ev.target.closest('[data-b]');
    post({ type: 'wb-select', id: b ? b.dataset.b : null });
  }, true);
  addEventListener('message', ev => {
    if (ev.origin !== ORIGIN || ev.source !== window.parent) return;
    const m = ev.data || {};
    if (m.type === 'wb-select') mark(m.id, !!m.scroll);
    if (m.type === 'wb-scroll') scrollTo(0, Number(m.y) || 0);
  });
  let t = 0;
  addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => post({ type: 'wb-scrolled', y: scrollY }), 120); }, { passive: true });
})();
```

- [ ] **Step 4: Rewrite `site/build.mjs`**

The page template is kept character for character; only the stylesheet link, the `<nav>` contents, the description and the script tag become variables.

```js
/* Site state in, static website out. Pure: no disk, no network. Images are returned as
   references so the caller decides whether to stream them (preview) or upload them.
   Each page is a list of blocks (site/blocks). A site that never saved pages gets pages made from its old settings
   (site/pages.mjs) and exactly the old stylesheet and script, so it builds byte for byte as before (golden test).
   editor: true makes self-contained pages for the page editor's preview, with every block marked and selectable. */
import { readFileSync } from 'node:fs';
import { esc } from './blocks/common.mjs';
import { renderBlocks } from './blocks/registry.mjs';
import { migratePages, resolvePages, isShownPage, pageHref } from './pages.mjs';

const asset = n => readFileSync(new URL(`./assets/${n}`, import.meta.url), 'utf8');
const CSS = asset('site.css');
const JS = asset('site.js');
const BLOCKS_CSS = asset('blocks.css');
const MOTION_JS = asset('motion.js');
const BRIDGE_JS = asset('edit-bridge.js');
const EDIT_CSS = '[data-b]{cursor:pointer}[data-b]:hover{outline:2px dashed rgba(47,111,237,.55);outline-offset:-2px}'
  + '.wb-sel{outline:2px solid #2f6fed!important;outline-offset:-2px}.blk-off{opacity:.35}'
  + '.blk-empty{margin:1rem;padding:1.2rem;text-align:center;border:1px dashed #8a94a6;color:#5b6577;font:14px system-ui,sans-serif}';
const GAPS = { none: '0rem', tight: '.68rem', normal: '1.2rem', roomy: '2rem' };
const RATIOS = { tall: '226 / 276', square: '1 / 1', wide: '3 / 2' };
const SCALES = { smaller: 0.9, normal: 1, larger: 1.12 };
const GRID_W = 800;
export const HEADERS = '/img/*\n  Cache-Control: public, max-age=31536000, immutable\n'
  + "\n/logo.svg\n  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox\n  X-Content-Type-Options: nosniff\n";

export { esc };

const IG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">'
  + '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="0.6" fill="currentColor"/></svg>';
const UP = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">'
  + '<path d="M12 20V4M5 11l7-7 7 7"/></svg>';

const gridSize = p => (p.width > GRID_W ? [GRID_W, Math.round(p.height * GRID_W / p.width)] : [p.width, p.height]);
/* inlined text must not end its <script> or <style> early */
const inline = t => t.replace(/<\/(script|style)/gi, '<\\/$1');

function rootVars(st) {
  return `:root{--page:${st.page};--band:${st.band};--text:${st.text};--ink:${st.ink};`
    + `--font-head:'${st.headingFont}',system-ui,sans-serif;--font-body:'${st.bodyFont}',system-ui,sans-serif;`
    + `--scale:${SCALES[st.textSize]};--gap:${GAPS[st.gap]};--card-ratio:${RATIOS[st.cardShape]}}\n`;
}

export function build(state, { base = '/', siteUrl = '', editor = false } = {}) {
  const files = new Map(), images = new Map();
  const s = state.settings, st = s.style;
  const byId = new Map([...state.pagePhotos, ...state.galleries.flatMap(g => g.photos)].map(p => [p.id, p]));
  const galById = new Map(state.galleries.map(g => [g.id, g]));
  const shown = state.galleries.filter(g => !g.hidden && g.photos.length);
  const cover = g => byId.get(g.coverPhotoId) || g.photos[0];
  const name = s.siteName || 'Portfolio';
  const site = siteUrl.replace(/\/+$/, '');
  const pic = (p, v) => { const rel = `img/${p.fileKey}-${v}.jpg`; images.set(rel, rel); return base + rel; };
  if (st.logo) images.set(st.logo, st.logo);
  const logo = st.logo ? `<img src="${base}${st.logo}" alt="${esc(name)}" width="64" height="64">`
                       : `<span class="logo-text">${esc(name)}</span>`;
  const fonts = [...new Set([st.headingFont, st.bodyFont])]
    .map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500`).join('&');
  const desc = String(s.about.text || '').replace(/\s+/g, ' ').trim().slice(0, 155);

  const legacy = state.pages == null && !editor;
  const pages = resolvePages(state.pages ?? migratePages(s, state.galleries), state.galleries);
  const live = pages.filter(p => isShownPage(p, galById));
  const nav = live.filter(p => p.inMenu).map(p => `<a href="${pageHref(p, base)}">${esc(p.title)}</a>`).join('');
  const styleCss = rootVars(st) + CSS + (legacy ? '' : BLOCKS_CSS);
  const siteJs = JS + (legacy ? '' : MOTION_JS);
  const cssTag = editor ? `<style>${inline(styleCss + EDIT_CSS)}</style>` : `<link rel="stylesheet" href="${base}style.css">`;
  const jsTag = editor ? `<script>${inline(siteJs)}</script>\n<script>${inline(BRIDGE_JS)}</script>`
                       : `<script src="${base}site.js" defer></script>`;

  function page(title, body, path, { og = null, head = '', description = desc } = {}) {
    const full = title ? `${title} - ${name}` : name;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(full)}">
${og && site ? `<meta property="og:image" content="${esc(site + og)}">` : ''}
${site ? `<link rel="canonical" href="${esc(site + path)}">` : ''}
${st.logo ? `<link rel="icon" href="${base}${st.logo}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${fonts}&display=swap" rel="stylesheet">
${cssTag}
${head}
</head>
<body>
<header class="top">
  <a class="logo" href="${base}">${logo}</a>
  <nav>${nav}</nav>
</header>
<main>
${body}
</main>
<footer class="foot">
  <span>${esc(s.footer.copyright)}</span>
  ${s.footer.instagram ? `<a class="ig" href="${esc(s.footer.instagram)}" aria-label="Instagram" target="_blank" rel="noopener">${IG}</a>` : '<span></span>'}
  <a class="totop" href="#" aria-label="Back to top">${UP}</a>
</footer>
${jsTag}
</body>
</html>
`;
  }
  /* og images are absolute, so they are built from the published path, not the preview one */
  const ogOf = p => (p ? `/img/${p.fileKey}-full.jpg` : null);

  for (const p of editor ? pages : live) {
    const ctx = {
      base, editor, siteName: name, style: st, shownGalleries: shown, cover, pic, gridSize,
      photo: id => (id == null ? null : byId.get(id) || null),
      gallery: id => galById.get(id) || null,
      pageHref: id => { const t = live.find(x => x.id === id); return t ? pageHref(t, base) : null; },
      og: null, head: '',
      setOg(ph) { if (ph && !this.og) this.og = ph; },
      addHead(h) { this.head += h; },
      renderBlocks,
    };
    const body = renderBlocks(p.blocks, ctx);
    const title = p.slug ? (p.seoTitle || p.title) : p.seoTitle;
    files.set(p.slug ? `${p.slug}/index.html` : 'index.html',
      page(title, body, p.slug ? `/${p.slug}/` : '/', { og: ogOf(ctx.og), head: ctx.head, description: p.seoDescription || desc }));
  }

  files.set('404.html', page('Not found', `<section class="contact"><h2>Page not found</h2><a href="${base}">Back to home</a></section>`, '/404'));
  files.set('style.css', styleCss);
  files.set('site.js', siteJs);
  files.set('_headers', HEADERS);
  return { files, images };
}
```

- [ ] **Step 5: Run the new, golden and old build tests**

Run: `node --test site/test/build-pages.test.mjs site/test/golden.test.mjs site/test/build.test.mjs site/test/routes.test.mjs`
Expected: PASS (all). If the golden test fails, diff the named case's file against `legacy.json`; the page template and each legacy block must match character for character.

- [ ] **Step 6: Commit (commit only after the user approves)**

```bash
git add site/build.mjs site/assets/edit-bridge.js site/test/build-pages.test.mjs
git commit -m "Website: build pages from blocks, menu from pages, self-contained editor preview"
```

---

### Task 9: Store: pages draft, revision, snapshots and restore

**Files:**
- Modify: `site/store.mjs`
- Test: `site/test/store-pages.test.mjs` (existing `site/test/store.test.mjs` must stay green)

**Interfaces:**
- Consumes: `cleanPages` (Task 6).
- Produces on the store object: `pagesRev() => number`, `getPages() => page[] | null`, `putPages(expectedPagesRev: number | null, raw) => { pagesRev }` (throws `StaleError` when `expectedPagesRev` is a number that differs; throws `InputError` with `.errors: string[]` when invalid), `discardPages(snapshotJson: string | null) => { pagesRev }`. `getState()` gains `pages` (raw stored, or null). `snapshot()` gains `pages`. `restoreSnapshot(json)` restores `pages` when the snapshot has the key and sets null when it does not (old publishes), and bumps `pagesRev`. `slugFor` avoids saved page slugs.

- [ ] **Step 1: Write the failing tests**

`site/test/store-pages.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStore, StaleError, InputError } from '../store.mjs';
import { migratePages, resolvePages } from '../pages.mjs';

const fresh = () => createStore(new DatabaseSync(':memory:'), { now: () => 1000 });
const photo = (k = 'aa') => ({ fileKey: k, width: 2048, height: 1365, originalName: `${k}.jpg` });
const migrated = s => { const st = s.getState(); return resolvePages(migratePages(st.settings, st.galleries), st.galleries); };
const news = (over = {}) => ({ id: 'pnews', title: 'News', slug: 'news', inMenu: true, seoTitle: '', seoDescription: '', galleryId: null, blocks: [], ...over });

test('pages start unsaved; saving bumps the site revision and the pages revision', () => {
  const s = fresh();
  assert.equal(s.getPages(), null);
  assert.equal(s.getState().pages, null);
  assert.equal(s.pagesRev(), 0);
  assert.deepEqual(s.putPages(0, [...migrated(s), news()]), { pagesRev: 1 });
  assert.equal(s.rev(), 1);
  assert.deepEqual(s.getPages().map(p => p.id), ['home', 'about', 'contact', 'pnews']);
});

test('a save made from an older copy is refused; photo uploads do not make the pages stale', () => {
  const s = fresh();
  s.putPages(null, migrated(s));
  s.addPhoto(null, null, photo('p1'));
  assert.equal(s.pagesRev(), 1);
  s.putPages(1, migrated(s));
  assert.throws(() => s.putPages(1, migrated(s)), StaleError);
});

test('bad pages are refused with every reason, and nothing is stored', () => {
  const s = fresh();
  const bad = [...migrated(s), news({ slug: 'img' }), news({ id: 'pnews2', slug: 'about' })];
  assert.throws(() => s.putPages(null, bad), e => e instanceof InputError && e.errors.length === 2 && /\/img\//.test(e.message));
  assert.equal(s.getPages(), null);
  assert.equal(s.rev(), 0);
});

test('photos used by blocks are checked, kept and never pruned', () => {
  const s = fresh();
  const p = s.addPhoto(null, null, photo('blk'));
  s.putPages(null, [...migrated(s), news({ blocks: [
    { id: 'bimg', type: 'image', props: { photoId: p.id } }, { id: 'bgone', type: 'image', props: { photoId: 999 } }] })]);
  const blocks = s.getPages()[3].blocks;
  assert.equal(blocks[0].props.photoId, p.id);
  assert.equal(blocks[1].props.photoId, null);
  assert.ok(s.referencedFileKeys().has('blk'));
});

test('snapshots carry the pages; a version from before pages existed restores to the old fixed pages', () => {
  const s = fresh();
  const before = JSON.parse(s.snapshot());
  delete before.pages;                                   /* what every publish made before this change looks like */
  s.putPages(null, [...migrated(s), news()]);
  const id = s.recordPublish({ status: 'ok', deploymentId: 'd1', rev: s.rev() });
  assert.equal(JSON.parse(s.getPublish(id).snapshot).pages.length, 4);
  const r0 = s.pagesRev();
  s.restoreSnapshot(JSON.stringify(before));
  assert.equal(s.getPages(), null);
  assert.equal(s.pagesRev(), r0 + 1, 'an open editor learns its draft is stale');
  s.restoreSnapshot(s.getPublish(id).snapshot);
  assert.deepEqual(s.getPages().map(p => p.id), ['home', 'about', 'contact', 'pnews']);
});

test('new galleries avoid the addresses pages use', () => {
  const s = fresh();
  s.putPages(null, [...migrated(s), news({ slug: 'weddings' })]);
  assert.equal(s.addGallery(null, 'Weddings').slug, 'Weddings-2');
  assert.equal(s.addGallery(null, 'About').slug, 'About-2');
});

test('discarding puts back the pages of a snapshot, or the old fixed pages when there is none', () => {
  const s = fresh();
  s.putPages(null, [...migrated(s), news()]);
  const snap = s.snapshot();
  s.putPages(null, migrated(s));
  assert.deepEqual(s.discardPages(snap), { pagesRev: 3 });
  assert.equal(s.getPages().length, 4);
  s.discardPages(null);
  assert.equal(s.getPages(), null);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test site/test/store-pages.test.mjs`
Expected: FAIL with `s.getPages is not a function`.

- [ ] **Step 3: Change `site/store.mjs`**

Add the import under the header comment:

```js
import { cleanPages } from './pages.mjs';
```

Inside `createStore`, after `const rev = () => Number(meta('_rev') || 0);` add:

```js
  /* The pages are the editor's draft: the public site only changes when they are published. They have their own
     revision so an editor's autosave is refused only when the pages changed elsewhere, not on every photo upload. */
  const pagesRev = () => Number(meta('_pagesRev') || 0);
  function getPages() { const raw = meta('s:pages'); return raw == null ? null : JSON.parse(raw); }
  function setPages(pages) { setMeta('s:pages', pages == null ? null : JSON.stringify(pages)); setMeta('_pagesRev', pagesRev() + 1); }
```

Replace `slugFor`:

```js
  function slugFor(title) {
    const base = title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'gallery';
    const pageSlugs = new Set((getPages() || []).filter(p => p.galleryId == null).map(p => p.slug.toLowerCase()));
    for (let n = 1; ; n++) {
      const s = n === 1 ? base : `${base}-${n}`;
      if (!RESERVED.has(s.toLowerCase()) && !pageSlugs.has(s.toLowerCase()) && !q.galSlug.get(s)) return s;
    }
  }
```

Replace the `snapshot` line:

```js
  const snapshot = () => JSON.stringify({ settings: getSettings(), galleries: q.galAll.all(), photos: q.phoAll.all(), pages: getPages() });
```

In the returned object, change the first line to `rev, meta, setMeta, getSettings, pagesRev, getPages,`, and in `getState()` add `pages: getPages(),` after `pagePhotos: …`.

Add after `patchSettings(…) { … },`:

```js
    putPages(expectedPagesRev, raw) {
      if (expectedPagesRev != null && expectedPagesRev !== pagesRev()) throw new StaleError();
      const galleries = q.galAll.all().map(galDto);
      const photoIds = new Set(q.phoAll.all().map(p => p.id));
      const { pages, errors } = cleanPages(raw, { galleries, photoIds });
      if (!pages) { const e = new InputError(errors[0]); e.errors = errors; throw e; }
      mutate(null, () => setPages(pages));
      return { pagesRev: pagesRev() };
    },
    /* back to the pages of a published version; with none, back to the pages made from the settings */
    discardPages(snapshotJson) {
      const snap = snapshotJson ? JSON.parse(snapshotJson) : {};
      mutate(null, () => setPages(snap.pages ?? null));
      return { pagesRev: pagesRev() };
    },
```

In `restoreSnapshot`, after `putSettings(snap.settings);` add:

```js
        /* versions published before pages existed have no "pages": they go back to pages made from their settings */
        setPages(Object.hasOwn(snap, 'pages') ? snap.pages : null);
```

`referencedFileKeys` needs no change: photos used by blocks are rows in `site_photos`, and every snapshot lists all photo rows; the new test pins that down.

- [ ] **Step 4: Run the store tests to see them pass**

Run: `node --test site/test/store-pages.test.mjs site/test/store.test.mjs`
Expected: PASS (all).

- [ ] **Step 5: Commit (commit only after the user approves)**

```bash
git add site/store.mjs site/test/store-pages.test.mjs
git commit -m "Website: store the pages draft with its own revision, in versions and restore"
```

---

### Task 10: Admin API for pages, live render and discard

**Files:**
- Modify: `site/routes.mjs`
- Test: `site/test/builder-routes.test.mjs` (existing `site/test/routes.test.mjs` must stay green)

**Interfaces:**
- Consumes: store `putPages`, `discardPages`, `pagesRev`, `getPublish`, `listPublishes` (Task 9); `migratePages`, `resolvePages`, `cleanPages` (Task 6); `listBlockTypes`, `STYLE_SCHEMA`, `MOTION_SCHEMA`, `STYLE_DEFAULTS`, `MOTION_DEFAULTS` (Task 3); `build(..., { editor: true })` (Task 8).
- Produces (HTTP, all under the existing admin auth):
  - `GET /api/admin/site` adds `pages` (resolved), `pagesRev`, `pagesSaved`.
  - `GET /api/admin/site/blocks` → `{ types, style, motion, styleDefaults, motionDefaults }`.
  - `PUT /api/admin/site/pages` (header `x-pages-rev`, body `{ pages }`, up to 2 MB) → `200 { pagesRev, rev }` | `409 { error: 'stale' }` | `400 { error, errors }` | `413`.
  - `POST /api/admin/site/render` (body `{ pages, slug }`) → `200 { html, rev }` | `400 { error, errors }`; writes nothing.
  - `POST /api/admin/site/pages/discard` → `200 { pages, pagesRev, rev }`.
  - `respond()` passes `e.errors` through on 400.

- [ ] **Step 1: Write the failing tests**

`site/test/builder-routes.test.mjs`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSite } from '../routes.mjs';
import { startFakeImmich } from './fake-immich.mjs';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
let srv, base, site, fake, gid, deploys = [];

const cfFetch = async (url, init = {}) => {
  const ok = r => new Response(JSON.stringify({ success: true, errors: [], result: r }));
  if (url.endsWith('/upload-token')) return ok({ jwt: 'J' });
  if (url.endsWith('/check-missing')) return ok(JSON.parse(init.body).hashes);
  if (url.endsWith('/deployments')) { deploys.push(init.body); return ok({ id: `dep-${deploys.length}`, url: 'https://t.pages.dev' }); }
  if (url.endsWith('/rollback')) { deploys.push('rollback:' + url.split('/').at(-2)); return ok({}); }
  return ok(true);
};
const H = extra => ({ 'x-admin-token': 'T', ...extra });
const getSite = async () => (await fetch(base + '/api/admin/site', { headers: H() })).json();
async function call(method, path, body, headers = {}) {
  const r = await fetch(base + path, { method, headers: H({ 'content-type': 'application/json', ...headers }), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const putPages = (pages, pagesRev) => call('PUT', '/api/admin/site/pages', { pages }, { 'x-pages-rev': String(pagesRev) });
async function upload(gallery) {
  const f = new FormData();
  f.append('original', new File([JPEG], 'o.jpg')); f.append('grid', new File([JPEG], 'g.jpg')); f.append('full', new File([JPEG], 'f.jpg'));
  f.append('width', '2048'); f.append('height', '1365');
  return (await fetch(`${base}/api/admin/site/photos?gallery=${gallery}`, { method: 'POST', headers: H(), body: f })).json();
}
const newsPage = text => ({ id: 'pnews', title: 'News', slug: 'news', inMenu: true, seoTitle: '', seoDescription: '', galleryId: null,
  blocks: [{ id: 'bnews', type: 'heading', props: { text } }] });

before(async () => {
  fake = await startFakeImmich(0, { fail: { value: false } });
  const dir = mkdtempSync(join(tmpdir(), 'site-b-'));
  const json = (res, code, obj, headers) => { res.writeHead(code, { 'content-type': 'application/json', ...(headers || {}) }); res.end(JSON.stringify(obj)); };
  /* reads the whole body before refusing it, so the client always gets the answer */
  const readJson = async (req, limit = 64 * 1024) => { let n = 0, s = ''; for await (const c of req) { n += c.length; s += c; } if (n > limit) throw new Error('body too large'); return s ? JSON.parse(s) : {}; };
  const immich = (p, init = {}) => { const { write, ...rest } = init; return fetch(fake.url + p, rest); };
  site = createSite({ db: new DatabaseSync(':memory:'), json, readJson, immich, canUpload: () => true,
    adminOk: req => req.headers['x-admin-token'] === 'T', tellAdmin: async () => {}, fetch: cfFetch,
    cfg: { dataDir: dir, uploadMaxMb: 50, cfAccountId: 'acc', cfPagesToken: 'tok', cfPagesProject: 'test', siteUrl: '', allowTestHooks: true } });
  srv = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/admin/site-preview/')) return site.preview(req, res, url.pathname);
    if (req.headers['x-admin-token'] !== 'T') { res.writeHead(401); return res.end(); }
    return site.admin(req, res, url.pathname, url);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  gid = (await call('POST', '/api/admin/site/galleries', { title: 'Weddings' }, { 'x-site-rev': String((await getSite()).rev) })).body.gallery.id;
  await upload(gid);
});
after(() => { srv.close(); fake.srv.close(); });

test('an unsaved site shows the pages made from its settings', async () => {
  const st = await getSite();
  assert.deepEqual(st.pages.map(p => p.id), ['home', `g${gid}`, 'about', 'contact']);
  assert.equal(st.pagesSaved, false);
  assert.equal(st.pagesRev, 0);
});

test('block types come with their forms, and style and motion with theirs', async () => {
  const r = await call('GET', '/api/admin/site/blocks');
  assert.equal(r.status, 200);
  assert.equal(r.body.types.length, 13);
  for (const t of r.body.types) { assert.ok(Array.isArray(t.fields) && t.label && t.icon); assert.match(t.sketch, /^<svg/); }
  assert.deepEqual(r.body.style.map(f => f.key), Object.keys(r.body.styleDefaults));
  assert.deepEqual(r.body.motion.map(f => f.key), Object.keys(r.body.motionDefaults));
});

test('saving pages makes a draft: the preview shows it, nothing is deployed', async () => {
  const st = await getSite(), before = deploys.length;
  const r = await putPages([...st.pages, newsPage('Fresh news')], st.pagesRev);
  assert.equal(r.status, 200);
  assert.equal(r.body.pagesRev, st.pagesRev + 1);
  const now = await getSite();
  assert.equal(now.pagesSaved, true);
  assert.equal(now.dirty, true);
  const pv = await fetch(base + '/admin/site-preview/news/', { headers: H() });
  assert.match(await pv.text(), /Fresh news/);
  assert.equal(deploys.length, before);
});

test('a save from an older copy is refused; uploading a photo does not make the draft stale', async () => {
  const st = await getSite();
  await upload('pages');
  assert.equal((await putPages(st.pages, st.pagesRev)).status, 200);
  assert.deepEqual(await putPages(st.pages, st.pagesRev), { status: 409, body: { error: 'stale' } });
});

test('address clashes are refused with every reason', async () => {
  const st = await getSite();
  const bad = [...st.pages, { ...newsPage('x'), id: 'pimg', slug: 'img', blocks: [] }, { ...newsPage('y'), id: 'pwed', slug: 'weddings', blocks: [] }];
  const r = await putPages(bad, st.pagesRev);
  assert.equal(r.status, 400);
  assert.equal(r.body.errors.length, 3, '/img/ is the site’s own; /weddings/ is the gallery’s address, and its page already uses it');
  assert.match(r.body.error, /\/img\/ is used by the site itself/);
  assert.match(r.body.errors.join('\n'), /\/weddings\/ is a gallery’s address/);
});

test('too much at once is refused', async () => {
  const st = await getSite();
  const huge = [...st.pages, { ...newsPage('x'), id: 'pbig', slug: 'big', blocks: [{ id: 'bbig', type: 'rich-text', props: { html: 'x'.repeat(3 * 1024 * 1024) } }] }];
  assert.equal((await putPages(huge, st.pagesRev)).status, 413);
});

test('the live preview renders unsaved pages and saves nothing', async () => {
  const st = await getSite();
  const pages = st.pages.map(p => (p.id === 'pnews' ? newsPage('Unsaved words') : p));
  const r = await call('POST', '/api/admin/site/render', { pages, slug: 'news' });
  assert.equal(r.status, 200);
  assert.match(r.body.html, /Unsaved words/);
  assert.match(r.body.html, /data-b="bnews"/);
  assert.doesNotMatch(r.body.html, /<script src=/);
  assert.equal(r.body.rev, st.rev);
  assert.equal((await getSite()).pagesRev, st.pagesRev);
  const bad = await call('POST', '/api/admin/site/render', { pages: [], slug: '' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.errors.join('\n'), /one home page/);
});

test('publish carries the pages; discard goes back to them', async () => {
  const pub = await call('POST', '/api/admin/site/publish');
  assert.equal(pub.status, 200);
  const manifest = JSON.parse(deploys.at(-1).get('manifest'));
  assert.ok(manifest['/news/index.html']);
  const st = await getSite();
  await putPages(st.pages.map(p => (p.id === 'pnews' ? newsPage('Changed my mind') : p)), st.pagesRev);
  const d = await call('POST', '/api/admin/site/pages/discard');
  assert.equal(d.status, 200);
  assert.equal(d.body.pages.find(p => p.id === 'pnews').blocks[0].props.text, 'Fresh news');
  assert.equal((await getSite()).pagesRev, d.body.pagesRev);
});

test('restoring a version from before pages existed brings back the old fixed pages', async () => {
  const old = JSON.parse(site.store.snapshot());
  delete old.pages;
  const id = site.store.recordPublish({ status: 'ok', deploymentId: 'dep-old', rev: site.store.rev(), snapshot: JSON.stringify(old) });
  const r = await call('POST', '/api/admin/site/restore', { id });
  assert.equal(r.status, 200);
  const st = await getSite();
  assert.equal(st.pagesSaved, false);
  assert.deepEqual(st.pages.map(p => p.id), ['home', `g${gid}`, 'about', 'contact']);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test site/test/builder-routes.test.mjs`
Expected: FAIL — the first test fails with `Cannot read properties of undefined (reading 'map')` (no `pages` in the response).

- [ ] **Step 3: Change `site/routes.mjs`**

Imports, after the existing `import { build } from './build.mjs';`:

```js
import { migratePages, resolvePages, cleanPages } from './pages.mjs';
import { listBlockTypes, STYLE_SCHEMA, MOTION_SCHEMA, STYLE_DEFAULTS, MOTION_DEFAULTS } from './blocks/registry.mjs';
```

Constants, after `const FRESH_MS = 10 * 60_000;`:

```js
const PAGES_MAX = 2 * 1024 * 1024;     /* a whole site's pages in one save; larger is refused before parsing finishes */
```

Inside `createSite`, after the `/* ---- publish ---- */` block's `restore` function, add:

```js
  /* ---- pages ---- */
  const pagesOf = st => resolvePages(st.pages ?? migratePages(st.settings, st.galleries), st.galleries);
  const photoIdsOf = st => new Set([...st.pagePhotos, ...st.galleries.flatMap(g => g.photos)].map(p => p.id));
  /* the editor's live preview: the real build of pages that are not saved yet, as one self-contained page */
  function renderDraft(raw, slug) {
    const st = store.getState();
    const { pages, errors } = cleanPages(raw, { galleries: st.galleries, photoIds: photoIdsOf(st) });
    if (!pages) { const e = new InputError(errors[0]); e.errors = errors; throw e; }
    const { files } = build({ ...st, pages }, { base: '/admin/site-preview/', siteUrl: cfg.siteUrl, editor: true });
    return { html: files.get(slug ? `${slug}/index.html` : 'index.html') ?? files.get('404.html') };
  }
  /* back to the pages the live site shows (or, never published, the pages made from the settings) */
  function discardPages() {
    const ok = store.listPublishes().filter(p => p.status === 'ok');
    const live = ok.find(p => p.deploymentId === store.meta('liveDeploymentId')) || ok[0];
    store.discardPages(live ? store.getPublish(live.id).snapshot : null);
    return { pages: pagesOf(store.getState()), pagesRev: store.pagesRev() };
  }
```

In the helpers section, after `const revOf = …`, add:

```js
  const pagesRevOf = req => (req.headers['x-pages-rev'] == null ? null : Number(req.headers['x-pages-rev']));
  async function readBody(req, res, limit) {
    try { return await readJson(req, limit); }
    catch (e) {
      const big = /too large/.test(e.message);
      json(res, big ? 413 : 400, { error: big ? 'That is too much to save at once' : 'That request was not valid' });
      return null;
    }
  }
```

In `respond`, replace the InputError line with:

```js
      if (e instanceof InputError) return json(res, 400, { error: e.message, ...(e.errors ? { errors: e.errors } : {}) });
```

Replace the `GET /api/admin/site` handler with:

```js
    if (path === '/api/admin/site' && m === 'GET') {
      const st = store.getState();
      return json(res, 200, {
        state: st, rev: store.rev(), publishes: store.listPublishes(),
        dirty: store.rev() !== Number(store.meta('publishedRev') ?? -1),
        canPublish: publisher.ready,
        missing: publisher.ready ? null : 'Publishing is not set up yet: add CF_ACCOUNT_ID, CF_PAGES_TOKEN and CF_PAGES_PROJECT to galleryapp.',
        liveDeploymentId: store.meta('liveDeploymentId'),
        fonts: FONTS, defaults: DEFAULT_STYLE, liveUrl: cfg.siteUrl || null, publishing: busy === 'publish',
        pages: pagesOf(st), pagesRev: store.pagesRev(), pagesSaved: st.pages != null,
      });
    }
    if (path === '/api/admin/site/blocks' && m === 'GET') {
      return json(res, 200, { types: listBlockTypes(), style: STYLE_SCHEMA, motion: MOTION_SCHEMA,
                              styleDefaults: STYLE_DEFAULTS, motionDefaults: MOTION_DEFAULTS });
    }
    if (path === '/api/admin/site/pages' && m === 'PUT') {
      const b = await readBody(req, res, PAGES_MAX); if (!b) return;
      return respond(res, () => store.putPages(pagesRevOf(req), b.pages));
    }
    if (path === '/api/admin/site/pages/discard' && m === 'POST') return respond(res, () => discardPages());
    if (path === '/api/admin/site/render' && m === 'POST') {
      const b = await readBody(req, res, PAGES_MAX); if (!b) return;
      return respond(res, () => renderDraft(b.pages, String(b.slug ?? '')));
    }
```

The preview route (`preview()`) is unchanged: it serves the saved draft from `store.getState()`, which now includes the pages.

- [ ] **Step 4: Run the route tests to see them pass**

Run: `node --test site/test/builder-routes.test.mjs site/test/routes.test.mjs`
Expected: PASS (all).

- [ ] **Step 5: Run the whole suite**

Run: `node --test admin/test health/test zip/test mail/test config/test design/test setup/test site/test`
Expected: PASS.

- [ ] **Step 6: Commit (commit only after the user approves)**

```bash
git add site/routes.mjs site/test/builder-routes.test.mjs
git commit -m "Website: admin API for the pages draft, live preview render, discard and block types"
```

---
### Task 11: Page editor: shell, pages, live preview, autosave, publish

The full-screen editor with the pages rail, page settings, the live preview at three sizes, click-to-select, autosaved draft with undo/redo, stale-draft handling, Publish and Discard. The block outline here is a simple list; Task 12 adds drag, the picker and the block forms.

**Files:**
- Create: `web/builder-admin.js`
- Modify: `web/site-admin.js` (upload function, Pages tab, leaving the section), `web/admin.html` (script tag after `design-admin.js`, near line 2786)
- Test: `site/test/builder-ui.test.mjs`

**Interfaces:**
- Consumes: `window.AdminKit` (`$`, `api`, `esc`, `toast`, `chrome`, `lucide`); the Design editor's injected classes (`dzstage`, `dzcanvas`, `dzdevice`, `dzdev`, `dzoh`, `dzoht`, `dzsubs`, `dzob`, `dzpub`, `dzfoot`, `dzerr`, `dzh3`, `dzseg`, `dzrange`, `dzcol`) from `web/design-admin.js`, which `admin.html` loads first; the routes from Task 10; the preview messages from Task 8.
- Produces: `window.SiteBuilder = { open(pageId?), close(), isOpen() }`; `window.WebsiteKit = { upload(file, target) => Promise<photo> }` from `site-admin.js`. Functions Task 12 replaces: `paintOutline()`, `paintBlockPanel(f)`. Functions Task 12 calls: `commit(fn, key)`, `select(id, scroll)`, `find(id, list)`, `page()`, `typeOf(type)`, `newBlock(type)`, `reid(block)`, `sortable(container, itemSel, onDone)`, `field(label, inner, hint)`, `blockActions(f)`, `wireBlockActions(f)`, `duplicateBlock(id)`, `toggleHidden(id)`, `deleteBlock(id)`, `paintPanel()`, `photoById(id)`, `thumb(photo)`, and state `B`.

- [ ] **Step 1: Write the failing UI tests**

`site/test/builder-ui.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const admin = rd('web/admin.html'), builder = rd('web/builder-admin.js'), siteAdmin = rd('web/site-admin.js'), bridge = rd('site/assets/edit-bridge.js');

test('the page editor is loaded by the panel and opened from the Website section', () => {
  assert.match(admin, /<script src="\/design-admin\.js"><\/script>\n<script src="\/builder-admin\.js"><\/script>/, 'after the Design editor, whose styles it shares');
  assert.match(builder, /window\.SiteBuilder = \{ open: open, close: close, isOpen: isOpen \}/);
  assert.match(siteAdmin, /W\.active = false; SiteBuilder\.open\(\)/, 'the Website screens stop repainting under the editor');
  assert.match(siteAdmin, /if \(window\.SiteBuilder\) SiteBuilder\.close\(\)/, 'leaving the section closes the editor');
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

test('Publish waits for the last save; Discard only touches the pages', () => {
  assert.match(builder, /function settled\(\)/);
  assert.match(builder, /settled\(\)\.then\(function\(\)\{\s*if \(B\.bad\)/);
  assert.match(builder, /api\("\/site\/pages\/discard"/);
  assert.match(builder, /Your changes are a draft\. The public site shows the published pages until you publish\./);
});

test('pages: add, rename, address, menu, SEO, duplicate, delete, reorder; home and gallery pages are protected', () => {
  for (const id of ['wbAddPage', 'wbPTitle', 'wbPSlug', 'wbPMenu', 'wbPSeoT', 'wbPSeoD', 'wbPDup', 'wbPDel']) assert.ok(builder.includes(`"${id}"`), id);
  assert.match(builder, /sortable\(host, "\.wbpg"/);
  assert.match(builder, /home \|\| gal \? "" : '<button class="btn sm ghost" type="button" id="wbPDel">/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test site/test/builder-ui.test.mjs`
Expected: FAIL with `ENOENT: no such file or directory, open '.../web/builder-admin.js'`.

- [ ] **Step 3: Share the uploader and hand the Pages tab to the editor (`web/site-admin.js`)**

Replace the whole `function pump(){ … }` (lines 110–129) with:

```js
/* one photo: the web copies are made here, then sent with the original. The page editor uses this too. */
function uploadOne(file, target){
  return makeCopies(file).then(function(c){
    var f = new FormData();
    f.append("original", file, file.name);
    f.append("grid", c.grid, "grid.jpg"); f.append("full", c.full, "full.jpg");
    f.append("width", String(c.width)); f.append("height", String(c.height));
    return fetch("/api/admin/site/photos?gallery=" + target, { method:"POST", credentials:"same-origin", body:f })
      .then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || "Upload failed"); return j; }); });
  }).then(function(j){ W.rev = Math.max(W.rev, j.rev); return j.photo; });
}
window.WebsiteKit = { upload: uploadOne };
function pump(){
  if (W.uploading) return;
  var it = W.queue.shift();
  if (!it){ settled(); return; }
  W.uploading = true;
  var left = W.queue.length;
  var st = $(it.zone + "st"); if (st) st.textContent = "Uploading " + it.file.name + (left ? " (" + left + " more)" : "") + "…";
  uploadOne(it.file, it.target).then(function(photo){ if (it.after) return it.after(photo); })
    .catch(function(e){ toast(e.message); })
    .then(function(){ W.uploading = false; pump(); });
}
```

At the top of `window.websiteView = function(screen, gid){`, add as its first line:

```js
  if (window.SiteBuilder && SiteBuilder.isOpen()) SiteBuilder.close();
```

Replace everything from `/* ---------- pages ---------- */` through the end of `function pagesScreen(){ … }` (lines 305–348, which includes the now-unused `photoPicker`) with:

```js
/* ---------- pages ---------- */
/* the pages themselves are edited in the full-screen page editor (builder-admin.js); what stays here is site-wide */
function pagesScreen(){
  var s = W.state.settings;
  $("wbody").innerHTML = '<h3 class="sec">Pages</h3>'
    + '<p class="hint" style="margin:0 0 12px">Home, About, Contact, a page for each gallery and any page you add are made of blocks you can add, arrange, style and animate, with a live preview. Changes stay a draft until you publish.</p>'
    + '<button class="btn" id="wedit">Open the page editor</button>'
    + '<h3 class="sec">Site</h3>'
    + '<div class="field"><label>Site name</label><input type="text" id="wsn" value="'+esc(s.siteName)+'"><div class="hint">Shown in browser tabs, and instead of a logo if you have none.</div></div>'
    + '<h3 class="sec">Footer</h3>'
    + '<div class="row2"><div class="field"><label>Copyright line</label><input type="text" id="wfc" value="'+esc(s.footer.copyright)+'"></div>'
    + '<div class="field"><label>Instagram link</label><input type="url" id="wfi" value="'+esc(s.footer.instagram)+'" placeholder="https://www.instagram.com/…"></div></div>'
    + '<button class="btn" id="wsavep">Save changes</button>';
  $("wedit").onclick = function(){ if (window.SiteBuilder){ W.active = false; SiteBuilder.open(); } };
  $("wsavep").onclick = function(){
    send("/settings", "PUT", { siteName: $("wsn").value, footer: { copyright: $("wfc").value, instagram: $("wfi").value } })
      .then(function(r){ if (r) changed("Saved"); });
  };
}
```

Replace the last `K.addSection(…)` line with:

```js
K.addSection("website", "Website", K.icons.globe, function(){ websiteView("galleries"); }, function(){ W.active = false; if (window.SiteBuilder) SiteBuilder.close(); }, 30);
```

- [ ] **Step 4: Load the editor (`web/admin.html`)**

Replace `<script src="/design-admin.js"></script>` with:

```html
<script src="/design-admin.js"></script>
<script src="/builder-admin.js"></script>
```

- [ ] **Step 5: Write `web/builder-admin.js`**

```js
/* The page editor: a full-screen editor for the public website's pages. On the left, the pages and the blocks of the
   open page; in the middle, a live preview of the real page at phone, tablet or desktop size, where clicking a block
   selects it; on the right, the page's settings or the chosen block's content, style and motion. Changes preview at
   once and save as a draft a moment later; Undo and Redo cover mistakes; the public site changes only on Publish.
   Forms are built from the block descriptions the server sends (site/blocks), so they offer only what it accepts.
   Uses the panel's globals through window.AdminKit, photo uploads through window.WebsiteKit (site-admin.js), and the
   preview, device and footer styles the Design editor (design-admin.js) adds, which admin.html loads first. */
(function(){
var K = window.AdminKit, $ = K.$, api = K.api, esc = K.esc, toast = K.toast;
var DEVICES = { phone: { w: 390, h: 844, label: "Phone" }, tablet: { w: 820, h: 1180, label: "Tablet" }, desktop: { w: 1440, h: 900, label: "Desktop" } };
var B = { open: false, info: null, site: null, pages: [], pagesRev: 0, pageId: "home", sel: null, tab: "content",
  undo: [], redo: [], lastKey: null, lastAt: 0, saveT: null, saving: false, again: false, renderT: null, seq: 0,
  status: "Saved", bad: false, stale: false, errors: [], device: "desktop", scrollY: 0, frame: null, ro: null, keyFn: null, msgFn: null,
  dirty: false, canPublish: false, missing: null };

var css = document.createElement("style");
css.textContent = [
".wb{display:grid;grid-template-columns:268px minmax(0,1fr) 360px;height:100%;min-height:0}",
".wbrail{background:var(--panel);border-right:1px solid var(--line);overflow-y:auto;min-height:0;padding:14px 0}",
".wbh{display:flex;align-items:center;justify-content:space-between;padding:10px 16px 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}",
".wbh button{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;height:30px;padding:0 10px;cursor:pointer;font:inherit;font-size:13px;letter-spacing:0;text-transform:none}",
".wbpg,.wbbl{display:flex;align-items:center;gap:8px;padding:8px 16px;cursor:pointer;font-size:14px;border-left:3px solid transparent}",
".wbpg:hover,.wbbl:hover{background:var(--raised)}.wbpg.on,.wbbl.on{border-left-color:var(--primary);background:var(--raised);font-weight:600}",
".wbpg .nm,.wbbl .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wbpg small,.wbbl small{color:var(--muted);font-weight:400}",
".wbpg .hd,.wbbl .hd{cursor:grab;color:var(--muted)}.wbpg.drag,.wbit.drag{opacity:.4}",
".wbbl.off .nm{opacity:.45;text-decoration:line-through}",
".wbbl .acts{display:flex;gap:2px}.wbbl .acts button{border:0;background:none;color:var(--muted);cursor:pointer;width:26px;height:26px;border-radius:6px;font:inherit}",
".wbbl .acts button:hover{background:var(--card);color:var(--fg)}",
".wbkids{margin-left:22px;border-left:1px dashed var(--line)}",
".wbcolh{display:flex;justify-content:space-between;align-items:center;padding:4px 16px;font-size:12px;color:var(--muted)}",
".wbcolh button{border:0;background:none;color:var(--primary);cursor:pointer;font:inherit;font-size:12px}",
".wbpanel{background:var(--panel);border-left:1px solid var(--line);display:flex;flex-direction:column;min-height:0;overflow-y:auto}",
".dzfoot #wbStatus{flex:1;font-size:13px;color:var(--muted)}.dzfoot #wbStatus.bad{color:var(--bad)}",
".wbstale{background:var(--warn-bg);color:var(--warn);padding:12px 16px;font-size:13px;display:flex;flex-direction:column;gap:8px}",
".wbstale .acts{display:flex;gap:8px}",
".wbpick{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:20px}",
".wbpickin{background:var(--panel);border-radius:14px;max-width:760px;width:100%;max-height:86vh;overflow-y:auto;padding:20px}",
".wbpickin h2{margin:0 0 14px;font-size:20px}",
".wbtypes{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}",
".wbtype{display:flex;flex-direction:column;gap:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:10px;padding:10px;cursor:pointer;font:inherit;font-size:14px;text-align:left}",
".wbtype:hover,.wbtype:focus-visible{border-color:var(--primary)}.wbsk{display:block;aspect-ratio:5/3;background:var(--raised);border-radius:6px;color:var(--fg)}",
".wbsk svg{width:100%;height:100%;display:block}.wbsk svg *{fill:currentColor;opacity:.28}",
".wbphotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin-top:12px}",
".wbphotos button{border:2px solid transparent;padding:0;border-radius:6px;overflow:hidden;cursor:pointer;aspect-ratio:1;background:var(--raised)}",
".wbphotos button.on{border-color:var(--primary)}.wbphotos img{width:100%;height:100%;object-fit:cover;display:block}",
".wbrich{border:1px solid var(--input-line);border-radius:8px;background:var(--card)}",
".wbrich .bar{display:flex;gap:4px;padding:6px;border-bottom:1px solid var(--line);flex-wrap:wrap}",
".wbrich .bar button{border:1px solid var(--line);background:var(--panel);color:var(--fg);border-radius:6px;min-width:32px;height:30px;cursor:pointer;font:inherit;font-size:13px}",
".wbrich .ed{min-height:160px;padding:10px 12px;outline:none;line-height:1.6}",
"textarea.wbcode{width:100%;min-height:200px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.5}",
"@media(max-width:1199px){.wb{grid-template-columns:220px minmax(0,1fr) 320px}}",
"@media(max-width:899px){.wb{display:flex;flex-direction:column;overflow-y:auto}.wb .dzstage{height:42vh;height:42dvh;flex:0 0 auto}.wbrail,.wbpanel{border:0;overflow:visible}}"
].join("\n");
document.head.appendChild(css);

/* ---------- small helpers ---------- */
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function rid(prefix){ return prefix + (Math.random().toString(36).slice(2) + "0000000").slice(0, 7); }
function page(){ return B.pages.filter(function(p){ return p.id === B.pageId; })[0] || B.pages[0]; }
function typeOf(t){ return B.info.types.filter(function(x){ return x.type === t; })[0]; }
/* where a block is: its list (a page's blocks, or one column of a columns block) and its place in that list */
function find(id, list){
  list = list || page().blocks;
  for (var i = 0; i < list.length; i++){
    var b = list[i];
    if (b.id === id) return { list: list, i: i, block: b };
    if (b.type === "columns") for (var c = 0; c < b.props.columns.length; c++){ var f = find(id, b.props.columns[c]); if (f) return f; }
  }
  return null;
}
function allPhotos(){ var s = B.site; return s.pagePhotos.concat.apply(s.pagePhotos, s.galleries.map(function(g){ return g.photos; })); }
function photoById(id){ return allPhotos().filter(function(p){ return p.id === id; })[0]; }
function thumb(p){ return p ? "/api/admin/site/img/" + p.fileKey + "-grid.jpg" : ""; }
function dirtyLocal(){ return !!(B.saveT || B.saving); }
function field(label, inner, hint){ return '<div class="field"><label>' + esc(label) + '</label>' + inner + (hint ? '<div class="hint">' + esc(hint) + '</div>' : "") + '</div>'; }
function slugify(t){
  var base = String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
  var taken = { img: 1 };
  B.pages.forEach(function(p){ taken[p.slug.toLowerCase()] = 1; });
  B.site.galleries.forEach(function(g){ taken[g.slug.toLowerCase()] = 1; });
  for (var n = 1; ; n++){ var s = n === 1 ? base : base + "-" + n; if (!taken[s]) return s; }
}
function newBlock(type){
  var t = typeOf(type);
  return { id: rid("b"), type: type, props: clone(t.defaults), style: clone(B.info.styleDefaults), motion: clone(B.info.motionDefaults) };
}
function reid(b){ b.id = rid("b"); if (b.type === "columns") b.props.columns.forEach(function(c){ c.forEach(reid); }); return b; }
/* drag to reorder the direct children of one list (pages, a page's blocks, or one column) */
function sortable(container, itemSel, onDone){
  var dragging = null, start = "";
  function items(){ return Array.prototype.slice.call(container.querySelectorAll(":scope > " + itemSel)); }
  function order(){ return items().map(function(x){ return x.dataset.id; }); }
  items().forEach(function(el){
    el.draggable = true;
    el.ondragstart = function(e){ e.stopPropagation(); dragging = el; start = order().join(","); el.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", el.dataset.id); };
    el.ondragend = function(e){ e.stopPropagation(); el.classList.remove("drag"); dragging = null; var now = order(); if (now.join(",") !== start) onDone(now); };
    el.ondragover = function(e){
      if (!dragging || dragging === el || dragging.parentNode !== container) return;
      e.preventDefault(); e.stopPropagation();
      var all = items();
      container.insertBefore(dragging, all.indexOf(dragging) < all.indexOf(el) ? el.nextSibling : el);
    };
  });
}

/* ---------- entry points ---------- */
function isOpen(){ return B.open; }
function open(pageId){
  if (B.open) return;
  B.open = true; B.undo = []; B.redo = []; B.sel = null; B.tab = "content"; B.stale = false; B.errors = []; B.scrollY = 0;
  B.status = "Saved"; B.bad = false; B.device = window.innerWidth < 900 ? "phone" : "desktop";
  chrome();
  $("root").innerHTML = '<div class="spin" style="margin:60px auto"></div>';
  var mine = ++B.seq;
  Promise.all([api("/site"), B.info ? Promise.resolve(null) : api("/site/blocks")]).then(function(rs){
    if (!B.open || mine !== B.seq) return;
    if (!rs[0].ok) throw new Error((rs[0].body && rs[0].body.error) || "Couldn’t load the website");
    if (rs[1]){ if (!rs[1].ok) throw new Error("Couldn’t load the block types"); B.info = rs[1].body; }
    take(rs[0].body);
    B.pageId = pageId && B.pages.some(function(p){ return p.id === pageId; }) ? pageId : B.pages[0].id;
    buildShell(); paintAll(); render(0);
    B.keyFn = onKey; document.addEventListener("keydown", B.keyFn);
    B.msgFn = onMessage; window.addEventListener("message", B.msgFn);
  }).catch(function(e){ if (B.open) $("root").innerHTML = '<p class="empty" style="padding:30px">' + esc(e.message) + '</p>'; });
}
function take(body){
  B.site = body.state; B.pages = clone(body.pages); B.pagesRev = body.pagesRev; B.dirty = body.dirty;
  B.canPublish = body.canPublish; B.missing = body.missing;
}
function close(){
  if (!B.open) return;
  if (B.saveT) saveNow();
  B.open = false; B.seq++; clearTimeout(B.renderT); clearTimeout(B.saveT); B.saveT = null;
  if (B.ro){ try { B.ro.disconnect(); } catch (e) {} B.ro = null; }
  if (B.keyFn){ document.removeEventListener("keydown", B.keyFn); B.keyFn = null; }
  if (B.msgFn){ window.removeEventListener("message", B.msgFn); B.msgFn = null; }
  B.frame = null;
  var app = document.getElementById("app"); if (app) app.classList.remove("dzfull");
}
function leave(){ close(); if (window.websiteView) window.websiteView("pages"); }
function chrome(){
  K.chrome({ title: "Pages", crumb: "Website", back: leave, section: "website", full: true, actions: [
    { label: "Open preview", onClick: function(){ var p = page(); window.open("/admin/site-preview/" + (p && p.slug ? encodeURIComponent(p.slug) + "/" : ""), "_blank", "noopener"); } },
    { label: "Publish", primary: true, id: "wbPublish", onClick: publish }
  ] });
}

/* ---------- shell ---------- */
function buildShell(){
  $("root").innerHTML = '<div class="wb" id="wb">'
    + '<nav class="wbrail" aria-label="Pages and blocks">'
    +   '<div class="wbh"><span>Pages</span><button type="button" id="wbAddPage">+ Page</button></div><div id="wbPages" role="list"></div>'
    +   '<div id="wbOutline"></div></nav>'
    + '<section class="dzstage" aria-label="Preview">'
    +   '<div class="dzcanvas" id="wbCanvas"><div class="dzdevice" id="wbDevice"><iframe id="wbFrame" title="Page preview"></iframe></div></div>'
    +   '<div class="dzdev" id="wbDev" role="group" aria-label="Preview size"></div></section>'
    + '<section class="wbpanel" aria-labelledby="wbTitle"><div id="wbStale"></div>'
    +   '<header class="dzoh"><div class="dzoht"><h2 id="wbTitle"></h2></div><div class="dzsubs" id="wbTabs"></div></header>'
    +   '<div class="dzob" id="wbBody"></div><div class="dzerr" id="wbErr" style="padding:0 24px 12px"></div>'
    +   '<div class="dzpub" id="wbPub"></div>'
    +   '<footer class="dzfoot"><span id="wbStatus" role="status" aria-live="polite"></span>'
    +   '<button id="wbUndo" type="button" aria-label="Undo" title="Undo">↶</button><button id="wbRedo" type="button" aria-label="Redo" title="Redo">↷</button></footer></section></div>';
  $("wbUndo").onclick = undo; $("wbRedo").onclick = redo;
  $("wbAddPage").onclick = addPage;
  B.frame = $("wbFrame");
  B.frame.addEventListener("load", function(){ fit(); send({ type: "wb-scroll", y: B.scrollY }); send({ type: "wb-select", id: B.sel }); });
  paintDevices();
  if (window.ResizeObserver){ B.ro = new ResizeObserver(fit); B.ro.observe($("wbCanvas")); }
}
function paintAll(){ paintPages(); paintOutline(); paintPanel(); paintHistory(); paintPub(); paintStale(); paintErrors(); setStatus(B.status, B.bad); }
function setStatus(t, bad, retry){
  B.status = t; B.bad = !!bad;
  var el = $("wbStatus"); if (!el) return;
  el.textContent = t; el.className = bad ? "bad" : "";
  if (retry){ var b = document.createElement("button"); b.type = "button"; b.textContent = "Retry"; b.style.marginLeft = "8px"; b.onclick = function(){ saveNow(); }; el.appendChild(b); }
}
function paintHistory(){ if ($("wbUndo")){ $("wbUndo").disabled = !B.undo.length; $("wbRedo").disabled = !B.redo.length; } }
function paintErrors(){ var e = $("wbErr"); if (e) e.textContent = B.errors.join("\n"); }

/* ---------- preview ---------- */
function paintDevices(){
  $("wbDev").innerHTML = Object.keys(DEVICES).map(function(k){ return '<button type="button" data-d="' + k + '" class="' + (B.device === k ? "on" : "") + '">' + DEVICES[k].label + '</button>'; }).join("");
  Array.prototype.forEach.call($("wbDev").querySelectorAll("button"), function(b){ b.onclick = function(){ B.device = b.dataset.d; paintDevices(); fit(); }; });
}
function fit(){
  var host = $("wbCanvas"), fr = B.frame; if (!host || !fr) return;
  var d = DEVICES[B.device], pad = B.device === "desktop" ? 0 : 20;
  var k = Math.min(1, (host.clientWidth - pad) / d.w, (host.clientHeight - pad) / d.h);
  if (!(k > 0)) return;
  fr.style.width = d.w + "px"; fr.style.height = d.h + "px"; fr.style.transform = "scale(" + k + ")";
  var box = $("wbDevice"); box.style.width = Math.round(d.w * k) + "px"; box.style.height = Math.round(d.h * k) + "px";
  box.className = "dzdevice " + (B.device === "desktop" ? "" : B.device);
}
function send(msg){ try { if (B.frame && B.frame.contentWindow) B.frame.contentWindow.postMessage(msg, location.origin); } catch (e) {} }
function onMessage(ev){
  if (ev.origin !== location.origin || !B.frame || ev.source !== B.frame.contentWindow) return;
  var m = ev.data || {};
  if (m.type === "wb-select") select(m.id || null, false);
  if (m.type === "wb-scrolled") B.scrollY = Number(m.y) || 0;
}
/* the real build of the pages on screen, saved or not, as one self-contained page (see site/routes.mjs renderDraft) */
function render(ms){
  clearTimeout(B.renderT);
  B.renderT = setTimeout(function(){
    var mine = ++B.seq, p = page();
    api("/site/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages: B.pages, slug: p.slug }) }).then(function(r){
      if (!B.open || mine !== B.seq) return;
      B.errors = r.ok ? [] : ((r.body && r.body.errors) || [(r.body && r.body.error) || "The preview could not be made"]);
      paintErrors();
      if (r.ok && B.frame) B.frame.srcdoc = r.body.html;
    });
  }, ms);
}
function select(id, scroll){
  B.sel = id && find(id) ? id : null; B.tab = "content";
  paintOutline(); paintPanel(); send({ type: "wb-select", id: B.sel, scroll: !!scroll });
}

/* ---------- changing things: undo, autosave ---------- */
function commit(fn, key){
  var now = Date.now();
  if (!(key && B.lastKey === key && now - B.lastAt < 800)){ B.undo.push(clone(B.pages)); if (B.undo.length > 100) B.undo.shift(); }
  B.lastKey = key || null; B.lastAt = now; B.redo = [];
  fn();
  changed();
}
function changed(){ B.dirty = true; setStatus("Saving…"); paintHistory(); paintPub(); paintPages(); paintOutline(); render(250); saveSoon(900); }
function undo(){ if (!B.undo.length) return; B.redo.push(clone(B.pages)); B.pages = B.undo.pop(); B.lastKey = null; afterHistory(); }
function redo(){ if (!B.redo.length) return; B.undo.push(clone(B.pages)); B.pages = B.redo.pop(); B.lastKey = null; afterHistory(); }
function afterHistory(){
  if (!B.pages.some(function(p){ return p.id === B.pageId; })) B.pageId = B.pages[0].id;
  if (B.sel && !find(B.sel)) B.sel = null;
  changed(); paintPanel();
}
function saveSoon(ms){ clearTimeout(B.saveT); B.saveT = setTimeout(saveNow, ms); }
function saveNow(){
  clearTimeout(B.saveT); B.saveT = null;
  if (B.stale) return;
  if (B.saving){ B.again = true; return; }
  var body = JSON.stringify({ pages: B.pages });
  if (body.length > 2 * 1024 * 1024){ setStatus("Not saved: these pages are too large. Remove some text or blocks.", true); return; }
  B.saving = true;
  api("/site/pages", { method: "PUT", headers: { "Content-Type": "application/json", "x-pages-rev": String(B.pagesRev) }, body: body }).then(function(r){
    B.saving = false;
    if (r.status === 409){ B.stale = true; paintStale(); setStatus("Not saved: changed somewhere else", true); return; }
    if (!r.ok){ B.errors = (r.body && r.body.errors) || []; paintErrors(); setStatus("Not saved: " + ((r.body && r.body.error) || "something went wrong"), true, true); paintPub(); return; }
    B.pagesRev = r.body.pagesRev; B.dirty = true;
    if (B.again){ B.again = false; saveSoon(0); } else setStatus("Draft saved");
    paintPub();
  }, function(){ B.saving = false; setStatus("Couldn’t save — check your connection", true, true); });
}
function reloadSite(){
  return api("/site").then(function(r){ if (!r.ok) throw new Error((r.body && r.body.error) || "Couldn’t load the website"); return r.body; })
    .catch(function(e){ toast(e.message); throw e; });
}
/* another tab, or a restored version, changed the pages: the owner chooses, nothing is overwritten silently */
function paintStale(){
  var box = $("wbStale"); if (!box) return;
  if (!B.stale){ box.innerHTML = ""; return; }
  box.innerHTML = '<div class="wbstale" role="alert"><b>These pages were changed somewhere else</b>'
    + '<span>Another tab, or restoring an earlier version, changed them after you opened the editor. Your latest edits are not saved yet.</span>'
    + '<div class="acts"><button class="btn sm" type="button" id="wbKeep">Keep my version</button><button class="btn sm ghost" type="button" id="wbTheirs">Load the latest</button></div></div>';
  $("wbKeep").onclick = function(){ reloadSite().then(function(body){ B.site = body.state; B.pagesRev = body.pagesRev; B.stale = false; paintStale(); saveNow(); }); };
  $("wbTheirs").onclick = function(){ reloadSite().then(function(body){
    take(body); B.stale = false; B.undo = []; B.redo = [];
    if (!B.pages.some(function(p){ return p.id === B.pageId; })) B.pageId = B.pages[0].id;
    if (B.sel && !find(B.sel)) B.sel = null;
    paintAll(); render(0); setStatus("Saved");
  }); };
}
function settled(){
  return new Promise(function(done){ (function wait(){ if (B.saveT) saveNow(); if (B.saving) return setTimeout(wait, 100); done(); })(); });
}
function publish(){
  if (!B.canPublish) return toast(B.missing || "Publishing isn’t set up on this server");
  if (B.stale) return toast("First choose which version of the pages to keep");
  if (B.errors.length) return toast("Fix this first: " + B.errors[0]);
  var btn = $("wbPublish"); if (btn) btn.disabled = true;
  settled().then(function(){
    if (B.bad) throw new Error("Your last change is not saved yet");
    return api("/site/publish", { method: "POST" });
  }).then(function(r){
    if (!r.ok) throw new Error((r.body && r.body.error) || "Couldn’t publish");
    B.dirty = false; paintPub(); toast("Published — live in about a minute");
  }).catch(function(e){ toast(e.message); }).then(function(){ var x = $("wbPublish"); if (x) x.disabled = false; });
}
function discard(){
  if (!confirm("Throw away your unpublished page changes?\n\nThe pages go back to what the public site shows now. Galleries and photos are not affected.")) return;
  settled().then(function(){ return api("/site/pages/discard", { method: "POST" }); }).then(function(r){
    if (!r.ok) return toast((r.body && r.body.error) || "Couldn’t discard");
    B.pages = clone(r.body.pages); B.pagesRev = r.body.pagesRev; B.undo = []; B.redo = []; B.stale = false; B.errors = [];
    if (!B.pages.some(function(p){ return p.id === B.pageId; })) B.pageId = B.pages[0].id;
    if (B.sel && !find(B.sel)) B.sel = null;
    paintAll(); render(0); setStatus("Saved"); toast("Back to the published pages.");
  });
}
function paintPub(){
  var box = $("wbPub"); if (!box) return;
  var wait = B.dirty || dirtyLocal();
  box.className = "dzpub" + (wait ? " wait" : "");
  box.innerHTML = '<p>' + (wait ? "Your changes are a draft. The public site shows the published pages until you publish." : "Published. The public site shows exactly these pages.") + '</p>'
    + '<div class="acts"><button class="btn sm ghost" id="wbDiscard" type="button"' + (wait ? "" : " disabled") + '>Discard changes</button></div>';
  $("wbDiscard").onclick = discard;
}
function onKey(ev){
  var t = ev.target && ev.target.tagName;
  if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || (ev.target && ev.target.isContentEditable)) return;
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z"){ ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); }
}
window.addEventListener("beforeunload", function(ev){ if (B.open && dirtyLocal()){ ev.preventDefault(); ev.returnValue = ""; } });

/* ---------- pages ---------- */
function paintPages(){
  var host = $("wbPages"); if (!host) return;
  host.innerHTML = B.pages.map(function(p){
    var where = p.slug ? "/" + p.slug + "/" : "/";
    return '<div class="wbpg' + (p.id === B.pageId ? " on" : "") + '" role="listitem" data-id="' + esc(p.id) + '"><span class="hd" title="Drag to reorder">☰</span>'
      + K.lucide(p.slug ? (p.galleryId != null ? "images" : "type") : "house", 16)
      + '<span class="nm">' + esc(p.title) + ' <small>' + esc(where) + (p.inMenu ? "" : " · not in menu") + '</small></span></div>';
  }).join("");
  Array.prototype.forEach.call(host.querySelectorAll(".wbpg"), function(el){
    el.onclick = function(){ B.pageId = el.dataset.id; B.sel = null; B.scrollY = 0; paintPages(); paintOutline(); paintPanel(); render(0); };
  });
  sortable(host, ".wbpg", function(ids){
    commit(function(){ B.pages = ids.map(function(id){ return B.pages.filter(function(p){ return p.id === id; })[0]; }); });
  });
}
function addPage(){
  var t = prompt("Name of the new page", "New page"); if (!t || !t.trim()) return;
  var p = { id: rid("p"), title: t.trim().slice(0, 120), slug: slugify(t), inMenu: true, seoTitle: "", seoDescription: "", galleryId: null, blocks: [newBlock("heading")] };
  p.blocks[0].props.text = p.title; p.blocks[0].props.level = 1;
  commit(function(){ B.pages.push(p); });
  B.pageId = p.id; B.sel = null; paintAll(); render(0);
}
function duplicatePage(p){
  var c = clone(p); c.id = rid("p"); c.galleryId = null; c.title = (p.title + " copy").slice(0, 120); c.slug = slugify(c.title); c.blocks.forEach(reid);
  commit(function(){ B.pages.splice(B.pages.indexOf(p) + 1, 0, c); });
  B.pageId = c.id; B.sel = null; paintAll(); render(0);
}
function deletePage(p){
  if (!confirm("Delete the page “" + p.title + "”?\n\nUndo brings it back. The public site keeps it until you publish.")) return;
  commit(function(){ B.pages = B.pages.filter(function(x){ return x !== p; }); });
  B.pageId = B.pages[0].id; B.sel = null; paintAll(); render(0);
}
function paintPanel(){
  if (!$("wbBody")) return;
  var f = B.sel ? find(B.sel) : null;
  if (!f){ B.sel = null; return paintPagePanel(); }
  paintBlockPanel(f);
}
function paintPagePanel(){
  var p = page(), gal = p.galleryId != null, home = p.slug === "" && !gal;
  $("wbTitle").textContent = p.title; $("wbTabs").innerHTML = "";
  $("wbBody").innerHTML = field("Name", '<input type="text" id="wbPTitle" maxlength="120" value="' + esc(p.title) + '"' + (gal ? " disabled" : "") + '>',
        gal ? "A gallery page takes its name and address from the gallery. Change them in the Galleries tab." : "")
    + (home ? "" : field("Web address", '<input type="text" id="wbPSlug" maxlength="60" value="' + esc(p.slug) + '"' + (gal ? " disabled" : "") + '>',
        gal ? "" : "Lower-case letters, numbers and dashes. Changing it breaks links people already have."))
    + '<div class="field"><label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:14px;font-weight:400"><input type="checkbox" id="wbPMenu"' + (p.inMenu ? " checked" : "") + '> Show in the menu</label></div>'
    + '<div class="dzh3">Search engines</div>'
    + field("Title in search results", '<input type="text" id="wbPSeoT" maxlength="120" value="' + esc(p.seoTitle) + '" placeholder="' + esc(home ? "Your site name" : p.title) + '">')
    + field("Description", '<textarea id="wbPSeoD" rows="3" maxlength="300">' + esc(p.seoDescription) + '</textarea>', "Up to 300 characters. Empty uses your About text.")
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="btn sm ghost" type="button" id="wbPDup">Duplicate page</button>'
    + (home || gal ? "" : '<button class="btn sm ghost" type="button" id="wbPDel">Delete page</button>') + '</div>'
    + (home ? '<p class="hint">The home page can’t be deleted.</p>' : gal ? '<p class="hint">To remove a gallery page, delete or hide the gallery in the Galleries tab.</p>' : "");
  var set = function(key, v, k){ commit(function(){ page()[key] = v; }, k); };
  if (!gal) $("wbPTitle").oninput = function(){ set("title", this.value, "pt"); };
  if ($("wbPSlug") && !gal) $("wbPSlug").oninput = function(){ set("slug", this.value.toLowerCase(), "ps"); };
  $("wbPMenu").onchange = function(){ set("inMenu", this.checked); };
  $("wbPSeoT").oninput = function(){ set("seoTitle", this.value, "pst"); };
  $("wbPSeoD").oninput = function(){ set("seoDescription", this.value, "psd"); };
  $("wbPDup").onclick = function(){ duplicatePage(page()); };
  if ($("wbPDel")) $("wbPDel").onclick = function(){ deletePage(page()); };
}

/* ---------- blocks ---------- */
function paintOutline(){
  var host = $("wbOutline"); if (!host) return;
  var p = page();
  host.innerHTML = '<div class="wbh"><span>On this page</span></div>' + p.blocks.map(function(b){
    return '<div class="wbbl' + (B.sel === b.id ? " on" : "") + '" data-sel="' + esc(b.id) + '">' + K.lucide(typeOf(b.type).icon, 16)
      + '<span class="nm">' + esc(typeOf(b.type).label) + '</span></div>';
  }).join("");
  Array.prototype.forEach.call(host.querySelectorAll("[data-sel]"), function(row){ row.onclick = function(){ select(row.dataset.sel, true); }; });
}
function blockActions(f){
  var off = f.block.style.visible === "none";
  return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 16px"><button class="btn sm ghost" type="button" id="wbBBack">← Page settings</button>'
    + '<button class="btn sm ghost" type="button" id="wbBDup">Duplicate</button>'
    + '<button class="btn sm ghost" type="button" id="wbBHide">' + (off ? "Show" : "Hide") + '</button>'
    + '<button class="btn sm ghost" type="button" id="wbBDel">Delete</button></div>';
}
function wireBlockActions(f){
  $("wbBBack").onclick = function(){ select(null); };
  $("wbBDup").onclick = function(){ duplicateBlock(f.block.id); };
  $("wbBHide").onclick = function(){ toggleHidden(f.block.id); };
  $("wbBDel").onclick = function(){ deleteBlock(f.block.id); };
}
function paintBlockPanel(f){
  $("wbTitle").textContent = typeOf(f.block.type).label; $("wbTabs").innerHTML = "";
  $("wbBody").innerHTML = blockActions(f);
  wireBlockActions(f);
}
function duplicateBlock(id){
  var c;
  commit(function(){ var f = find(id); c = reid(clone(f.block)); f.list.splice(f.i + 1, 0, c); });
  select(c.id, true);
}
function toggleHidden(id){
  commit(function(){ var b = find(id).block; b.style.visible = b.style.visible === "none" ? "all" : "none"; });
  paintPanel();
}
function deleteBlock(id){
  commit(function(){ var f = find(id); f.list.splice(f.i, 1); });
  select(null);
}

window.SiteBuilder = { open: open, close: close, isOpen: isOpen };
})();
```

- [ ] **Step 6: Run the UI tests and the existing admin UI tests**

Run: `node --test site/test/builder-ui.test.mjs design/test/admin-ui.test.mjs`
Expected: PASS.

- [ ] **Step 7: Check it by hand in the local server**

Start the app as usual for local work, sign in to `/admin`, open Website → Pages → Open the page editor. Check: the pages rail lists Home, each gallery, About, Contact; the preview shows the real page and switches Phone/Tablet/Desktop; clicking a block in the preview highlights it and lists Duplicate/Hide/Delete; renaming a page updates the menu in the preview within a second and the status shows "Draft saved"; Undo/Redo work (also Cmd-Z); a second tab saving makes the first show "These pages were changed somewhere else"; Discard returns to the published pages; the Website "Galleries" tab still works after closing the editor.

- [ ] **Step 8: Commit (commit only after the user approves)**

```bash
git add web/builder-admin.js web/site-admin.js web/admin.html site/test/builder-ui.test.mjs
git commit -m "Website: full-screen page editor with live preview, autosaved draft and publishing"
```

---

### Task 12: Page editor: block outline, add-block picker, content, style and motion forms

**Files:**
- Modify: `web/builder-admin.js` (replace `paintOutline` and `paintBlockPanel`; add the functions below)
- Test: `site/test/builder-ui.test.mjs` (append)

**Interfaces:**
- Consumes: everything listed as "Produces" in Task 11; `listBlockTypes()` field descriptions (kinds `text`, `textarea`, `select`, `number`, `toggle`, `color`, `photo`, `gallery`, `galleries`, `url`, `link`, `richtext`, `html`, `css`), `STYLE_SCHEMA`, `MOTION_SCHEMA` via `B.info` (Task 10); `window.WebsiteKit.upload` (Task 11).
- Produces: `paintOutline()` (nested outline with drag, duplicate, hide, delete, add to a column), `picker(target)`, `insert(type, target)`, `listOf(key)`, `paintBlockPanel(f)` (Content/Style/Motion tabs), `buildForm(fields, values, blockId, part)`, `control(f, v, set)`, `photoPicker(current, done)`.

- [ ] **Step 1: Write the failing tests**

Append to `site/test/builder-ui.test.mjs`:

```js
import { listBlockTypes, STYLE_SCHEMA, MOTION_SCHEMA } from '../blocks/registry.mjs';

test('every kind of field the server describes has a control', () => {
  const kinds = new Set([...listBlockTypes().flatMap(t => t.fields), ...STYLE_SCHEMA, ...MOTION_SCHEMA].map(f => f.kind));
  for (const k of kinds) assert.ok(builder.includes(`k === "${k}"`), `no control for "${k}" fields`);
  assert.match(builder, /B\.info\.style/); assert.match(builder, /B\.info\.motion/);
  assert.match(builder, /function shown\(f, values\)/, 'fields that only apply sometimes follow their "when"');
});

test('custom HTML and CSS are edited as plain text, never rendered into the admin page', () => {
  assert.match(builder, /if \(k === "html" \|\| k === "css"\)\{ var c = el\('<textarea class="wbcode"/);
});

test('the outline can drag, duplicate, hide and delete blocks, including inside columns', () => {
  for (const a of ['dup', 'hide', 'del']) assert.ok(builder.includes(`data-act="${a}"`), a);
  assert.match(builder, /sortable\(l, "\.wbit"/);
  assert.match(builder, /data-addto=/);
});

test('the add-block picker shows a sketch of each type and keeps columns out of columns', () => {
  assert.match(builder, /t\.sketch/);
  assert.match(builder, /!nested \|\| t\.nestable/);
  assert.match(builder, /Add a block/);
});

test('photos are chosen from the website’s photos or uploaded through the same pipeline', () => {
  assert.match(builder, /window\.WebsiteKit\.upload\(f, "pages"\)/);
  assert.match(builder, /Choose a photo/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test site/test/builder-ui.test.mjs`
Expected: FAIL — `no control for "text" fields` (and the outline/picker tests).

- [ ] **Step 3: Replace `paintOutline` with the full outline**

In `web/builder-admin.js`, replace the whole `function paintOutline(){ … }` from Task 11 with:

```js
function snippet(b){
  var p = b.props, s = p.text || p.heading || p.label || p.caption || p.place || "";
  if (!s && p.html) s = String(p.html).replace(/<[^>]*>/g, " ");
  return String(s).replace(/\s+/g, " ").trim().slice(0, 40);
}
function outlineList(list){
  return list.map(function(b){
    var t = typeOf(b.type), off = b.style.visible === "none", kids = "";
    if (b.type === "columns") kids = '<div class="wbkids">' + b.props.columns.slice(0, b.props.count).map(function(col, ci){
      return '<div class="wbcolh"><span>Column ' + (ci + 1) + '</span><button type="button" data-addto="' + esc(b.id) + '" data-col="' + ci + '">+ Block</button></div>'
        + '<div class="wblist" data-list="' + esc(b.id) + ':' + ci + '">' + outlineList(col) + '</div>';
    }).join("") + '</div>';
    return '<div class="wbit" data-id="' + esc(b.id) + '"><div class="wbbl' + (B.sel === b.id ? " on" : "") + (off ? " off" : "") + '" data-sel="' + esc(b.id) + '">'
      + '<span class="hd" title="Drag to reorder">☰</span>' + K.lucide(t.icon, 16)
      + '<span class="nm">' + esc(t.label) + ' <small>' + esc(snippet(b)) + '</small></span>'
      + '<span class="acts"><button type="button" data-act="dup" title="Duplicate" aria-label="Duplicate">⧉</button>'
      + '<button type="button" data-act="hide" title="' + (off ? "Show" : "Hide") + '" aria-label="' + (off ? "Show" : "Hide") + '">' + (off ? "◌" : "◉") + '</button>'
      + '<button type="button" data-act="del" title="Delete" aria-label="Delete">✕</button></span></div>' + kids + '</div>';
  }).join("");
}
/* a list by its key: "page" for the page's own blocks, "<columns block id>:<column>" for one column */
function listOf(key){
  if (key === "page") return page().blocks;
  var parts = key.split(":"), f = find(parts[0]);
  return f.block.props.columns[Number(parts[1])];
}
function paintOutline(){
  var host = $("wbOutline"); if (!host) return;
  var p = page();
  host.innerHTML = '<div class="wbh"><span>On this page</span><button type="button" id="wbAddBlock">+ Block</button></div>'
    + '<div class="wblist" data-list="page">' + outlineList(p.blocks) + '</div>'
    + (p.blocks.length ? "" : '<p class="hint" style="padding:0 16px">This page has no blocks yet. Press + Block.</p>');
  $("wbAddBlock").onclick = function(){ picker({ list: "page" }); };
  Array.prototype.forEach.call(host.querySelectorAll("[data-sel]"), function(row){
    row.onclick = function(ev){
      var a = ev.target.closest("[data-act]"), id = row.dataset.sel;
      if (!a) return select(id, true);
      ev.stopPropagation();
      if (a.dataset.act === "dup") duplicateBlock(id);
      if (a.dataset.act === "hide") toggleHidden(id);
      if (a.dataset.act === "del") deleteBlock(id);
    };
  });
  Array.prototype.forEach.call(host.querySelectorAll("[data-addto]"), function(b){
    b.onclick = function(){ picker({ list: b.dataset.addto + ":" + b.dataset.col }); };
  });
  Array.prototype.forEach.call(host.querySelectorAll(".wblist"), function(l){
    sortable(l, ".wbit", function(ids){
      commit(function(){
        var arr = listOf(l.dataset.list), by = {};
        arr.forEach(function(b){ by[b.id] = b; });
        var next = ids.map(function(id){ return by[id]; });
        arr.length = 0; Array.prototype.push.apply(arr, next);
      });
    });
  });
}
```

- [ ] **Step 4: Add the picker**

Add after `paintOutline`:

```js
/* the add-block picker: a sketch of each type; inside columns, only the types that may go there */
function picker(target){
  var nested = target.list !== "page";
  var types = B.info.types.filter(function(t){ return !nested || t.nestable; });
  var box = document.createElement("div"); box.className = "wbpick";
  box.innerHTML = '<div class="wbpickin" role="dialog" aria-modal="true" aria-labelledby="wbPickT"><div style="display:flex;justify-content:space-between;align-items:center"><h2 id="wbPickT">Add a block</h2><button class="btn sm ghost" type="button" data-x>Close</button></div>'
    + '<div class="wbtypes">' + types.map(function(t){
        return '<button type="button" class="wbtype" data-t="' + esc(t.type) + '"><span class="wbsk">' + t.sketch + '</span><span>' + esc(t.label) + '</span></button>'; }).join("") + '</div></div>';
  document.body.appendChild(box);
  function onEsc(ev){ if (ev.key === "Escape") done(); }
  function done(){ box.remove(); document.removeEventListener("keydown", onEsc); }
  document.addEventListener("keydown", onEsc);
  box.onclick = function(ev){
    if (ev.target === box || ev.target.closest("[data-x]")) return done();
    var b = ev.target.closest("[data-t]"); if (!b) return;
    done(); insert(b.dataset.t, target);
  };
  var first = box.querySelector(".wbtype"); if (first) first.focus();
}
/* a new block goes after the selected one when that is in the same list, else at the end */
function insert(type, target){
  var nb = newBlock(type);
  commit(function(){
    var list = listOf(target.list), at = list.length;
    if (B.sel){ var f = find(B.sel); if (f && f.list === list) at = f.i + 1; }
    list.splice(at, 0, nb);
  });
  select(nb.id, true);
}
```

- [ ] **Step 5: Replace `paintBlockPanel` with the tabbed forms, and add the controls**

Replace the whole `function paintBlockPanel(f){ … }` from Task 11 with:

```js
var TABS = [["content", "Content"], ["style", "Style"], ["motion", "Motion"]];
function paintBlockPanel(f){
  var b = f.block, t = typeOf(b.type);
  $("wbTitle").textContent = t.label;
  $("wbTabs").innerHTML = TABS.map(function(x){ return '<button type="button" data-tab="' + x[0] + '" class="' + (B.tab === x[0] ? "on" : "") + '">' + x[1] + '</button>'; }).join("");
  Array.prototype.forEach.call($("wbTabs").querySelectorAll("button"), function(x){ x.onclick = function(){ B.tab = x.dataset.tab; paintPanel(); }; });
  var host = $("wbBody");
  host.innerHTML = blockActions(f);
  if (B.tab === "content") host.appendChild(buildForm(t.fields, b.props, b.id, "props"));
  if (B.tab === "style") host.appendChild(buildForm(B.info.style, b.style, b.id, "style"));
  if (B.tab === "motion") host.appendChild(buildForm(B.info.motion, b.motion, b.id, "motion"));
  wireBlockActions(f);
}
function shown(f, values){
  if (!f.when) return true;
  var v = String(values[f.when[0]]), want = f.when[1];
  return want.charAt(0) === "!" ? v !== want.slice(1) : v === want;
}
/* every control changes the draft through commit(), so it previews, saves and can be undone; typing merges into one undo step */
function setProp(blockId, part, key, v, merge){ commit(function(){ find(blockId).block[part][key] = v; }, merge ? blockId + part + key : null); }
function buildForm(fields, values, blockId, part){
  var box = document.createElement("div");
  fields.forEach(function(f){
    if (!shown(f, values)) return;
    var wrap = document.createElement("div"); wrap.className = "field";
    wrap.innerHTML = '<label>' + esc(f.label) + '</label>';
    wrap.appendChild(control(f, values[f.key], function(v, merge, redraw){ setProp(blockId, part, f.key, v, merge); if (redraw) paintPanel(); }));
    if (f.hint){ var h = document.createElement("div"); h.className = "hint"; h.textContent = f.hint; wrap.appendChild(h); }
    box.appendChild(wrap);
  });
  return box;
}
function el(html){ var d = document.createElement("div"); d.innerHTML = html; return d.firstChild; }
function control(f, v, set){
  var k = f.kind;
  if (k === "text" || k === "url"){
    var i = el('<input type="text" maxlength="' + (f.max || 2000) + '">'); i.value = v == null ? "" : v;
    if (k === "url") i.placeholder = "https://…";
    i.oninput = function(){ set(i.value, true); }; return i;
  }
  if (k === "textarea"){ var ta = el('<textarea rows="7"></textarea>'); ta.value = v || ""; ta.oninput = function(){ set(ta.value, true); }; return ta; }
  if (k === "html" || k === "css"){ var c = el('<textarea class="wbcode" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>'); c.value = v || ""; c.oninput = function(){ set(c.value, true); }; return c; }
  if (k === "number"){
    var r = el('<div class="dzrange"><input type="range" min="' + f.min + '" max="' + f.max + '" step="' + (f.step || 1) + '"><output></output></div>');
    var inp = r.querySelector("input"), out = r.querySelector("output"), unit = f.unit ? " " + f.unit : "";
    inp.value = v; out.textContent = v + unit;
    inp.oninput = function(){ out.textContent = inp.value + unit; set(Number(inp.value), true); }; return r;
  }
  if (k === "toggle"){
    var tg = el('<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:14px;font-weight:400"><input type="checkbox"> On</label>');
    var cb = tg.querySelector("input"); cb.checked = !!v; cb.onchange = function(){ set(cb.checked, false); }; return tg;
  }
  if (k === "select" && f.options.length <= 4){
    var seg = el('<div class="dzseg"></div>');
    f.options.forEach(function(o){ var b = document.createElement("button"); b.type = "button"; b.textContent = o[1]; if (o[0] === v) b.className = "on"; b.onclick = function(){ set(o[0], false, true); }; seg.appendChild(b); });
    return seg;
  }
  if (k === "select"){
    var s = el("<select></select>");
    f.options.forEach(function(o, idx){ var op = document.createElement("option"); op.value = String(idx); op.textContent = o[1]; if (o[0] === v) op.selected = true; s.appendChild(op); });
    s.onchange = function(){ set(f.options[Number(s.value)][0], false, true); };
    return s;
  }
  if (k === "color"){
    var cw = el('<div class="dzcol"><input type="color"><input type="text" maxlength="7" style="max-width:104px"></div>');
    var ci = cw.querySelector("[type=color]"), ct = cw.querySelector("[type=text]"); ci.value = v || "#ffffff"; ct.value = v || "";
    ci.oninput = function(){ ct.value = ci.value; set(ci.value.toLowerCase(), true); };
    ct.oninput = function(){ if (/^#[0-9a-f]{6}$/i.test(ct.value)){ ci.value = ct.value; set(ct.value.toLowerCase(), true); } };
    return cw;
  }
  if (k === "photo"){
    var p = photoById(v);
    var pw = el('<div>' + (p ? '<img class="wthumb" alt="" src="' + thumb(p) + '">' : "") + '<div style="display:flex;gap:8px"><button class="btn sm ghost" type="button" data-pick>' + (p ? "Change photo" : "Choose a photo") + '</button>'
      + (p ? '<button class="btn sm ghost" type="button" data-none>Remove</button>' : "") + '</div></div>');
    pw.querySelector("[data-pick]").onclick = function(){ photoPicker(v, function(id){ set(id, false, true); }); };
    if (p) pw.querySelector("[data-none]").onclick = function(){ set(null, false, true); };
    return pw;
  }
  if (k === "gallery"){
    var gs = el("<select></select>");
    gs.innerHTML = '<option value="">Choose a gallery</option>' + B.site.galleries.map(function(g){
      return '<option value="' + g.id + '"' + (g.id === v ? " selected" : "") + '>' + esc(g.title) + (g.hidden ? " (hidden)" : "") + '</option>'; }).join("");
    gs.onchange = function(){ set(gs.value ? Number(gs.value) : null, false, true); };
    return gs;
  }
  if (k === "galleries"){
    var all = v == null;
    var gw = el('<div><label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:14px;font-weight:400"><input type="checkbox" data-all' + (all ? " checked" : "") + '> All visible galleries</label>'
      + '<div data-list style="margin:8px 0 0 22px' + (all ? ";display:none" : "") + '"></div></div>');
    var lw = gw.querySelector("[data-list]");
    lw.innerHTML = B.site.galleries.map(function(g){
      return '<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:14px;font-weight:400"><input type="checkbox" value="' + g.id + '"' + (!all && v.indexOf(g.id) >= 0 ? " checked" : "") + '> ' + esc(g.title) + '</label>'; }).join("");
    gw.querySelector("[data-all]").onchange = function(){
      set(this.checked ? null : B.site.galleries.filter(function(g){ return !g.hidden; }).map(function(g){ return g.id; }), false, true); };
    Array.prototype.forEach.call(lw.querySelectorAll("input"), function(c){ c.onchange = function(){
      set(Array.prototype.filter.call(lw.querySelectorAll("input"), function(x){ return x.checked; }).map(function(x){ return Number(x.value); }), false); }; });
    return gw;
  }
  if (k === "link"){
    var cur = v || { kind: "url", url: "", pageId: "" };
    var lk = el('<div><select data-k><option value="page">A page on this site</option><option value="url">A web address, email or phone</option></select><div data-v style="margin-top:8px"></div></div>');
    var ks = lk.querySelector("[data-k]"), vh = lk.querySelector("[data-v]"); ks.value = cur.kind;
    if (cur.kind === "page"){
      vh.innerHTML = '<select>' + B.pages.map(function(p){ return '<option value="' + esc(p.id) + '"' + (p.id === cur.pageId ? " selected" : "") + '>' + esc(p.title) + '</option>'; }).join("") + '</select>';
      vh.firstChild.onchange = function(){ set({ kind: "page", url: "", pageId: this.value }, false); };
    } else {
      vh.innerHTML = '<input type="text" placeholder="https://… or mailto:… or tel:…">'; vh.firstChild.value = cur.url;
      vh.firstChild.oninput = function(){ set({ kind: "url", url: this.value, pageId: "" }, true); };
    }
    ks.onchange = function(){ set(ks.value === "page" ? { kind: "page", url: "", pageId: (B.pages[0] || {}).id || "" } : { kind: "url", url: "", pageId: "" }, false, true); };
    return lk;
  }
  if (k === "richtext"){
    /* the text is the server-sanitised HTML of this block; what is typed here is sanitised again when it is saved */
    var rw = el('<div class="wbrich"><div class="bar"><button type="button" data-c="bold"><b>B</b></button><button type="button" data-c="italic"><i>I</i></button>'
      + '<button type="button" data-c="h2">Heading</button><button type="button" data-c="ul">• List</button><button type="button" data-c="link">Link</button><button type="button" data-c="p">Plain</button></div>'
      + '<div class="ed" contenteditable="true"></div></div>');
    var ed = rw.querySelector(".ed"); ed.innerHTML = v || "";
    var push = function(){ set(ed.innerHTML, true); };
    ed.oninput = push;
    rw.querySelector(".bar").onmousedown = function(ev){ ev.preventDefault(); };   /* keep the selection in the text */
    Array.prototype.forEach.call(rw.querySelectorAll("[data-c]"), function(b){ b.onclick = function(){
      var c = b.dataset.c;
      if (c === "bold" || c === "italic") document.execCommand(c);
      if (c === "h2" || c === "p") document.execCommand("formatBlock", false, c);
      if (c === "ul") document.execCommand("insertUnorderedList");
      if (c === "link"){ var u = prompt("Link to (https://…, mailto:… or tel:…)"); if (u) document.execCommand("createLink", false, u); }
      push();
    }; });
    return rw;
  }
  return el('<p class="hint">This setting can’t be edited here.</p>');
}
```

- [ ] **Step 6: Add the photo picker**

Add after `control`:

```js
/* choose one of the website's photos, or upload a new one into the "Website – Pages" Immich album, as the old forms did */
function photoPicker(current, done){
  var box = document.createElement("div"); box.className = "wbpick";
  var groups = [["Page photos", B.site.pagePhotos]].concat(B.site.galleries.map(function(g){ return [g.title, g.photos]; }));
  box.innerHTML = '<div class="wbpickin" role="dialog" aria-modal="true" aria-labelledby="wbPhT"><div style="display:flex;justify-content:space-between;align-items:center"><h2 id="wbPhT">Choose a photo</h2><button class="btn sm ghost" type="button" data-x>Close</button></div>'
    + '<div class="wdrop" data-up>Upload a new photo<input type="file" accept="image/*" hidden></div><div class="hint" data-st></div>'
    + groups.filter(function(g){ return g[1].length; }).map(function(g){
        return '<div class="dzh3">' + esc(g[0]) + '</div><div class="wbphotos">' + g[1].map(function(p){
          return '<button type="button" data-p="' + p.id + '" class="' + (p.id === current ? "on" : "") + '" aria-label="Photo ' + p.id + '"><img src="' + thumb(p) + '" alt="" loading="lazy"></button>'; }).join("") + '</div>';
      }).join("") + '</div>';
  document.body.appendChild(box);
  function onEsc(ev){ if (ev.key === "Escape") finish(); }
  function finish(){ box.remove(); document.removeEventListener("keydown", onEsc); }
  document.addEventListener("keydown", onEsc);
  var zone = box.querySelector("[data-up]"), inp = zone.querySelector("input"), st = box.querySelector("[data-st]");
  zone.onclick = function(){ inp.click(); };
  inp.onclick = function(ev){ ev.stopPropagation(); };
  inp.onchange = function(){
    var f = inp.files[0]; if (!f) return;
    st.textContent = "Uploading " + f.name + "…";
    window.WebsiteKit.upload(f, "pages").then(function(ph){ B.site.pagePhotos.push(ph); finish(); done(ph.id); }, function(e){ st.textContent = e.message; });
  };
  box.onclick = function(ev){
    if (ev.target === box || ev.target.closest("[data-x]")) return finish();
    var b = ev.target.closest("[data-p]"); if (!b) return;
    finish(); done(Number(b.dataset.p));
  };
}
```

- [ ] **Step 7: Run the UI tests**

Run: `node --test site/test/builder-ui.test.mjs design/test/admin-ui.test.mjs`
Expected: PASS.

- [ ] **Step 8: Check it by hand in the local server**

In the editor: + Block opens the picker with a sketch per type; adding a Heading inserts it after the selected block and selects it; Content/Style/Motion tabs edit it and the preview follows within a second; Style → Background → Photo shows the photo picker, upload works and the photo appears; Motion → Entrance "Slide up" plays in the preview; a Columns block shows "+ Block" per column and refuses Columns and Photo grid in its picker; dragging blocks in the outline reorders them (and in a column); Hide fades the block in the preview and removes it from "Open preview"; a bad link shows "Not saved: … links must start with https://…" and the draft keeps the typed text; custom HTML `<script>` disappears from the preview.

- [ ] **Step 9: Commit (commit only after the user approves)**

```bash
git add web/builder-admin.js site/test/builder-ui.test.mjs
git commit -m "Website: page editor block outline, add-block picker, and content, style and motion forms"
```

---

### Task 13: Deploy list covers the new files

`deploy.sh` copies an explicit list of files; anything not listed never reaches the NAS (the Docker image copies whole folders, so only the script needs it).

**Files:**
- Modify: `deploy.sh` (the `FILES=( … )` array, lines 37–40)
- Test: `site/test/deploy-files.test.mjs`

**Interfaces:**
- Consumes: the files created in Tasks 2–12.
- Produces: a test that fails whenever a runtime file under `site/` or `web/` is missing from `FILES`.

- [ ] **Step 1: Write the failing test**

`site/test/deploy-files.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'test' ? [] : walk(p)) : [p]; });

test('deploy.sh copies every file the website and the admin panel run on', () => {
  const sh = readFileSync(join(ROOT, 'deploy.sh'), 'utf8');
  const m = sh.match(/^FILES=\(([\s\S]*?)\)$/m);
  assert.ok(m, 'FILES=( … ) not found');
  const listed = new Set(m[1].split(/\s+/).filter(Boolean));
  const need = [...walk(join(ROOT, 'site')), ...readdirSync(join(ROOT, 'web')).map(f => join(ROOT, 'web', f))]
    .map(p => relative(ROOT, p)).filter(p => /\.(mjs|js|css|html)$/.test(p));
  assert.deepEqual(need.filter(p => !listed.has(p)), []);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/deploy-files.test.mjs`
Expected: FAIL listing the missing files: `site/pages.mjs`, `site/sanitize.mjs`, the 15 files in `site/blocks/`, `site/assets/blocks.css`, `site/assets/motion.js`, `site/assets/edit-bridge.js`, `web/builder-admin.js`.

- [ ] **Step 3: Add them to `deploy.sh`**

Replace the `FILES=(` block with:

```bash
FILES=(server.mjs web/admin.html web/index.html web/site-admin.js web/design-admin.js web/builder-admin.js web/home.js web/admin-theme.css admin/overview.mjs admin/cover.mjs admin/logo.mjs
       site/blake3.mjs site/store.mjs site/build.mjs site/publish.mjs site/watch.mjs site/routes.mjs site/pages.mjs site/sanitize.mjs
       site/blocks/common.mjs site/blocks/registry.mjs site/blocks/hero.mjs site/blocks/heading.mjs site/blocks/rich-text.mjs site/blocks/image.mjs
       site/blocks/image-text.mjs site/blocks/gallery-cards.mjs site/blocks/photo-grid.mjs site/blocks/button.mjs site/blocks/spacer.mjs
       site/blocks/columns.mjs site/blocks/contact.mjs site/blocks/embed.mjs site/blocks/custom-html.mjs
       site/assets/site.css site/assets/site.js site/assets/blocks.css site/assets/motion.js site/assets/edit-bridge.js
       zip/writer.mjs zip/queue.mjs health/watchdog.mjs mail/blast.mjs
       design/design.mjs design/css.mjs config/settings.mjs config/store.mjs config/request.mjs setup/claim.mjs setup/checks.mjs setup/provision.mjs setup/server.mjs web/setup.html)
```

(`deploy.sh` already runs `mkdir -p "$DEST/$(dirname "$f")"` before copying, so `site/blocks/` is created on the first deploy.)

- [ ] **Step 4: Run it to see it pass**

Run: `node --test site/test/deploy-files.test.mjs && bash -n deploy.sh`
Expected: PASS, and `bash -n` prints nothing.

- [ ] **Step 5: Commit (commit only after the user approves)**

```bash
git add deploy.sh site/test/deploy-files.test.mjs
git commit -m "Deploy: copy the website builder's files, with a test that none are missed"
```

---

### Task 14: Docs

**Files:**
- Modify: `README.md` ("Public website" section, around line 251)
- Modify: `RUNBOOK.md` (the file table under "Three files, no dependencies", around line 31; the test command line stays as it is)
- NOTICE: no change (no third-party code or icons added).

**Interfaces:** none.

- [ ] **Step 1: README**

Replace the first paragraph of "### Public website" (from `Optional. The admin panel's **Website** section edits a simple portfolio site` to `using the write key.`) with:

```markdown
Optional. The admin panel's **Website** section builds a portfolio site and publishes it to Cloudflare Pages, so the
public site never depends on this machine. Pages are made of blocks (banner, heading, text, photo, image and text,
gallery cards, photo grid, button, space or line, columns, contact details, video or map, custom HTML) that you add,
arrange, style and animate in a full-screen page editor with a live preview at phone, tablet and desktop size.
Edits are an autosaved draft with undo and redo; the public site changes only when you press **Publish**. A site
made before the page editor existed keeps looking exactly the same until you change it. Entrance and hover effects
respect visitors who ask their device for less motion, and pages work without JavaScript. Uploaded originals also go
to Immich, into a `Website – <gallery>` (or `Website – Pages`) album, using the write key.
```

- [ ] **Step 2: RUNBOOK file table**

Add these rows to the table under "### Three files, no dependencies", after the `zip/writer.mjs` row:

```markdown
| `site/*.mjs`, `site/blocks/*.mjs`, `site/assets/*` | The public website: the store (settings, galleries, photos, the pages draft, publish history), the pages model and how pages are made from the old fixed pages, one module per block type, the HTML sanitiser, the builder that turns it all into static files, and publishing to Cloudflare Pages. Pure where possible, tested in `site/test`, including a golden test that a site which never used the page editor builds byte for byte as before. **New files here must be added to `FILES` in `deploy.sh`**; `site/test/deploy-files.test.mjs` fails until they are. |
| `web/site-admin.js`, `web/builder-admin.js`, `web/design-admin.js` | The admin panel's Website section, its full-screen page editor, and the gallery Design editor. Classic scripts that use `window.AdminKit`; the page editor reuses the Design editor's preview styles, so `design-admin.js` must load first. |
```

- [ ] **Step 3: Run the docs tests**

Run: `node --test docs/test`
Expected: PASS.

- [ ] **Step 4: Commit (commit only after the user approves)**

```bash
git add README.md RUNBOOK.md
git commit -m "Docs: the website page editor and where its files live"
```

---

### Task 15: Deploy and verify

- [ ] **Step 1: Run the whole suite**

Run: `node --test admin/test health/test zip/test mail/test config/test design/test setup/test site/test docs/test`
Expected: PASS.

- [ ] **Step 2: Deploy**

Run `./deploy.sh` from the `website-editor` branch (the user's standing instruction is to deploy after changes). Expected: every new file reported as `copied`, `✓ back up after …`, and the smoke test passing.

- [ ] **Step 3: Verify in the admin panel preview**

On the deployed admin panel: Website → Preview opens and looks exactly as before (the site's pages have not been saved yet); Website → Pages → Open the page editor shows Home, the galleries, About and Contact; make one small change, check it in the editor preview and in "Open preview", then press Discard changes so the live site and its draft stay as they were. Do not publish unless the user asks.

---

## Spec deviations / open questions

1. **No separate draft table.** The website's working state already is a draft: the public site only changes on Publish (`publishedRev` vs `_rev` drives "Unpublished changes"). Pages are stored as working state (`s:pages`) with their own `_pagesRev`, autosaved by the editor; "Discard changes" puts back the pages of the live version. Galleries, photos and site style keep saving straight into the working state as they do today. Confirm this is acceptable rather than a second draft copy of the whole site.
2. **Pages gain a `galleryId` field** (null for ordinary pages) beyond the spec's page shape, so gallery pages stay tied to their gallery: name and address come from the gallery, new galleries get a page automatically, a deleted gallery's page goes, and the editor will not delete a gallery page.
3. **Every gallery gets a page, not only visible ones.** Hidden or empty galleries' pages are left out of the build, exactly as today, so un-hiding a gallery needs no new page. The spec says "each visible gallery becomes a page".
4. **The animation script is a separate asset.** The spec puts the IntersectionObserver in `site/assets/site.js`; adding it there would change every unmigrated site's `site.js` and break byte-identity. It lives in `site/assets/motion.js` and, with `blocks.css`, is appended to the published `site.js`/`style.css` only once pages have been saved.
5. **"Byte-identical" is held for unsaved sites only.** Once the pages are saved (even unchanged), the HTML pages are still identical but `style.css` and `site.js` grow by the block CSS and motion script (tested).
6. **Blur-in uses opacity and a slight scale, not `filter: blur`**, to keep "only transform and opacity are animated". Button "fill" and "glow" likewise animate a pseudo-element's transform/opacity rather than colours or shadows.
7. **Button hover offers fill, lift and glow only (no "none")**, as listed in the spec; default is fill. Image "caption reveal" is offered only on blocks with captions (photo, gallery cards); image and text offers none/zoom/lift; photo grid none/zoom/lift/darken.
8. **"Hide" in the outline is a fourth visibility value** (`style.visible: 'none'`) beside phones-and-computers, computers only and phones only.
9. **Meta description:** a page's empty SEO description falls back to the old About text (that is today's behaviour and keeps output identical). Should it instead fall back to the page's own first text?
10. **One photo grid per page, never inside columns.** `site.js` lays out and opens only the first `.masonry` on a page, and changing it would break byte-identity.
11. **`compileCustomCss` gains a `scope` option.** The gallery scope `:where(#app,#lb)` is hard-wired today; custom HTML blocks scope their CSS to `#b-<block id>`.
12. **Custom HTML does not allow `<img>` or frames.** "The same rules as gallery custom CSS" forbid loading anything from another site; photos go in photo blocks, videos and maps in the embed block. Confirm, or allow `https` images.
13. **Embeds load YouTube (privacy-enhanced `youtube-nocookie.com`), Vimeo and Google Maps** in iframes on the public site; the map needs no API key. Confirm Google Maps, or prefer OpenStreetMap.
14. **"Adding a type is one file"** is one module plus one import line in `site/blocks/registry.mjs` (explicit list, so the picker order is fixed and nothing is loaded from disk at runtime).
15. **The live preview is built from unsaved pages** via `POST /api/admin/site/render` into an `iframe srcdoc`, so it updates before autosave; "Open preview" (`/admin/site-preview/`) still shows the saved draft. Editor-mode pages inline their CSS and scripts and use `self.origin` for messages, because a `srcdoc` document's `location.origin` is `"null"`.
16. **The old Pages tab's About/Contact forms are removed**; that content now lives in blocks. Site name and footer stay in the Pages tab (site-wide settings are roadmap piece 3). The old `settings.about`/`settings.contact` fields are kept untouched so older versions restore.
17. **Removing a photo does not edit pages.** A block that points at a removed photo simply shows nothing (and the editor's picker shows "Choose a photo"), so restoring an older version brings the photo back into place. `referencedFileKeys()` needs no change because block photos are rows in `site_photos`; a test pins this down.
18. **Contact email is now checked** when pages are saved. A site whose old Contact email is not a valid address will see "that does not look like an email address" on its first save from the editor until it is corrected.
