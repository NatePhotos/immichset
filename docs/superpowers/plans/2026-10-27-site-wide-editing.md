# Site-wide Editing (Header, Menu, Footer, Theme, Wording) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make everything on the public site editable in the page editor: the header and its menu, the footer, the theme (colours, fonts, sizes, spacing) and the fixed wording, sharing the page editor's autosaved draft, undo/redo and Publish, while a site that never saved them builds byte for byte as it does today.

**Architecture:** The site-wide part of the website is one object, `site = { name, header, footer, theme, wording }`, stored beside the pages draft as the setting `s:site` (null until first saved) and written together with `s:pages` under the same `_pagesRev` by the existing `PUT /api/admin/site/pages`, so there is one save path, one revision, one snapshot and one Discard. Validation and limits live in one module per area: `site/theme.mjs` (theme schema, font allow-list, CSS variables), `site/wording.mjs` (fixed wording and the photo viewer's labels), `site/bands.mjs` (header/footer element types, band style, checks and markup) and `site/sitewide.mjs` (migration from the old settings and the whole-object check). `site/build.mjs` stays pure: it renders the header and footer through `bands.mjs`, using `migrateSite(settings)` when `state.site` is null, which writes exactly today's markup. New CSS and JS (`site/assets/bands.css`, `site/assets/bands.js`, the viewer-label script) are appended only once the site has been saved, as `blocks.css`/`motion.js` were for pages. The editor (`web/builder-admin.js`) keeps the draft as `{ pages, sw }`, and a new classic script `web/sitewide-admin.js` adds the Header, Footer, Theme and Wording panels through a small kit the editor exposes. The logo stays a file in `settings.style.logo`, changed at once by the existing logo routes, with its controls moved into the Theme panel.

**Checked:** the code in Tasks 1–14 was assembled against the current `website-editor` tree in a scratch copy (outside the repo): the full suite `node --test admin/test health/test zip/test mail/test config/test design/test setup/test site/test docs/test` passes (461 tests), including both golden byte-identity tests; `web/builder-admin.js`, `web/sitewide-admin.js` and `web/site-admin.js` pass `node --check`; `bash -n deploy.sh` passes. The editor scripts (Tasks 12–14) were **not** run in a browser; Task 16 is that check.

**Tech Stack:** Node (v26) ESM built-ins only (`node:sqlite`, `node:test`, `node:vm`, `node:fs`), no dependencies, no build step. Admin UI is classic browser scripts using `window.AdminKit`.

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-10-27-site-wide-editing-design.md`):

- Everything that appears on the public site can be edited in the page editor: the header and its menu, the footer, the theme (colours, fonts, sizes, spacing) and the fixed wording that is hard-coded today. Nothing visibly changes until the owner edits it.
- Stored with the pages draft (same autosave, undo/redo, revision and publish snapshot): `site = { header: band, footer: band, theme: theme, wording: wording }`, `band = { style: bandStyle, elements: element[] }`, `bandStyle = { background, padding, alignment, sticky (header only) }`, `element = { id, type, props, motion }`.
- Element types: `logo`, `siteName`, `menu`, `link`, `button`, `social`, `text`, `spacer`.
- `menu` is automatic by default (pages marked "show in menu", in page order). It can be reordered and can gain custom items (label, address); an address is checked as http(s), mailto, tel or a site path.
- `link`, `button` and `social` addresses use the same check as the page blocks.
- `theme` extends today's style settings: page, band, text and ink colours, an accent colour, heading and body fonts, text size, grid gap and card shape, plus the logo.
- `wording` holds the text that is fixed today: the gallery-card caption ("Click For More!"), the 404 page heading and its "Back to home" link, and the photo viewer labels. Each has a default equal to today's text.
- All limits and validation live in one module per area, as `site/pages.mjs` and `site/blocks/*` do.
- A site that never saved these keys builds byte-for-byte as it does today (the golden test stays). On first load the defaults are generated from the existing settings: the logo, site name and menu become the header, the copyright line and Instagram link become the footer, and the current style becomes the theme. Old settings fields are kept so restoring an earlier published version still works. Snapshots without `site` restore to the generated defaults.
- `site/build.mjs` stays a pure function. The header and footer element lists render to the same markup and class names as today's when unchanged. The phone layout collapses the menu behind a menu button when there is no room. Theme values feed the existing CSS variables. Wording flows into the block renderers and the 404 page. Entrance and hover effects follow the existing rules (transform and opacity only, reduced motion respected, content visible without JavaScript).
- The left rail gains Header, Footer, Theme and Wording beside the pages. Clicking the header or footer in the preview selects it. The right panel edits the selected band's style and elements (add, reorder, duplicate, delete, hide). Theme and Wording are form panels with a live preview. The old Style tab and the site name and footer fields on the Pages tab move into these panels. The autosaved draft, undo and redo, stale/413 handling and Publish are shared with the page editor.
- Text is escaped; addresses are checked; logo upload keeps the existing PNG/SVG checks. Header and footer cannot contain arbitrary HTML or scripts.
- Testing: per element: validation and rendered output. Migration: an untouched site builds identically (golden test). Theme and wording: values reach the output. Routes: draft save, publish, restore (old snapshots without `site`), discard, slug and address checks. Editor: source-level tests as for the page editor, plus a browser check.
- Out of scope: per-page header or footer overrides, arbitrary blocks inside the header or footer, custom CSS for the whole site, whole-site zip upload and theme packages.

Repo rules that apply to every task:

- No dependencies, no build step, Node built-ins only.
- Full test command: `node --test admin/test health/test zip/test mail/test config/test design/test setup/test site/test docs/test`.
- Every new runtime file under `site/` or `web/` goes into `FILES` in `deploy.sh` in the same task that creates it: `site/test/deploy-files.test.mjs` fails until it is.
- Commit messages describe the change only; no mention of who asked, no AI or Co-Authored-By lines. Commit only after the user approves. Never push.
- Do not write markdown links in docs (the docs test checks every relative link under `docs/`).
- The editor preview stays a same-origin `iframe srcdoc` without `sandbox` (user decision).

## Decision: where the site-wide data lives

`s:site` is a **sibling key** of `s:pages`, not a field inside it, and shares `_pagesRev`:

- `s:pages` keeps its exact format, so `snapshotMax` (id high-water marks), `slugFor`, `referencedFileKeys`, every published snapshot and every existing test read it unchanged.
- One write (`setDraft(pages, site)`) stores both and bumps `_pagesRev` once, inside the same `mutate` transaction, so the draft can never be half saved and a stale tab is refused for either part.
- `PUT /api/admin/site/pages` accepts `{ pages, site }`; a body without `site` (an editor tab opened before deploy) keeps the stored site, so nothing is lost by an old tab.
- Snapshots gain `site: getSite()`; `restoreSnapshot` writes `snap.site` only when the key exists, else null, so versions published before this feature go back to the site made from their settings. `discardPages` checks a published site with `cleanSite` and refuses (leaving the draft alone) rather than silently fall back.
- The site holds no database ids (no photos, no galleries), so no new id high-water mark is needed and no table is added. Element and menu-item ids are made by the editor (`rid("e")`, `rid("m")`) and only need to be unique within the site / within one menu.
- `PAGES_MAX` (2 MB) covers both; the site adds at most a few KB (20 elements per band, 20 menu items, short texts), and the client's existing `body.length > 2 * 1024 * 1024` check now measures the combined body.

## File Structure

| File | Responsibility |
|---|---|
| `site/test/golden/saved-cases.mjs` (new) | The sites the second golden test builds: pages saved, site never saved; logo present/absent, Instagram present/absent, live address, preview, a changed menu, changed style. |
| `site/test/golden/capture-saved.mjs` (new) | One-off script that records today's output for those cases to `saved.json`; refuses to overwrite. |
| `site/test/golden/saved.json` (new, generated) | Today's build output for the saved-pages cases, captured before `build.mjs` changes. |
| `site/test/golden-saved.test.mjs` (new) | A site whose header/footer/theme/wording were never saved builds exactly as recorded. |
| `site/theme.mjs` (new) | `FONTS`, `GAPS`, `RATIOS`, `SCALES`, `THEME_DEFAULTS`, `THEME_SCHEMA`, `cleanTheme`, `themeFromStyle`, `rootVars`. |
| `site/wording.mjs` (new) | `WORDING_DEFAULTS`, `WORDING_SCHEMA`, `cleanWording`, `viewerScript`. |
| `site/bands.mjs` (new) | Header/footer element types, `menuUrl`, band style and element motion schemas, `cleanElement`, `cleanBand`, `renderElement`, `renderHeader`, `renderFooter`, `IG`, `UP`. |
| `site/sitewide.mjs` (new) | `migrateSite(settings)`, `cleanSite(raw)`, `SITE_LIMITS`. |
| `site/assets/bands.css` (new) | Band style classes, element styles, the CSS-only phone menu, element hover and entrance CSS. |
| `site/assets/bands.js` (new) | IntersectionObserver entrances for header/footer elements. |
| `site/assets/edit-bridge.js` (modify) | Preview clicks report blocks, elements and bands; highlight by kind. |
| `site/build.mjs` (modify) | Renders header, footer, theme variables, wording and the 404 page from `state.site ?? migrateSite(settings)`; appends `bands.css`/`bands.js`/viewer labels once the site is saved (or in the editor). |
| `site/store.mjs` (modify) | `getSite`, `setDraft`; site in `putPages`, `discardPages`, `snapshot`, `restoreSnapshot`, `getState`; `FONTS` comes from `theme.mjs`. |
| `site/routes.mjs` (modify) | `GET /site` gains `site`, `siteSaved`; `GET /blocks` gains element/band/theme/wording forms; `PUT /pages` and `POST /render` take `site`; discard returns `site`; logo routes answer with the file name; preview never caches the logo. |
| `site/blocks/photo-grid.mjs` (modify) | Option label "Same as the theme". |
| `web/builder-admin.js` (modify) | Draft is `{ pages, sw }` for save, preview, undo/redo, discard and stale reload; `B.area` and `selectArea`; preview selection by kind; `buildForm(fields, values, onSet, extra)`; `window.SiteBuilder.kit`. |
| `web/sitewide-admin.js` (new) | Rail entries, band element outline and picker, Header/Footer/element panels, the menu editor, Theme panel with logo upload, Wording panel. |
| `web/site-admin.js` (modify) | Style tab and Pages-tab site name/footer fields removed; Pages tab points at the editor. |
| `web/admin.html` (modify) | Loads `/sitewide-admin.js` after `/builder-admin.js`. |
| `deploy.sh` (modify) | Copies the new files. |
| `README.md`, `RUNBOOK.md` (modify) | Public website section; file table. |
| Tests (new): `site/test/theme.test.mjs`, `wording.test.mjs`, `bands.test.mjs`, `bands-render.test.mjs`, `sitewide.test.mjs`, `bands-assets.test.mjs`, `build-site.test.mjs`, `store-site.test.mjs`, `sitewide-routes.test.mjs`, `edit-bridge.test.mjs`, `builder-draft.test.mjs`, `sitewide-ui.test.mjs`, `website-tabs.test.mjs`; `site/test/builder-ui.test.mjs` (modify). |

NOTICE stays unchanged: no third-party code or icons are added (rail and element icons reuse Lucide shapes already embedded in `web/admin.html`; the social icons on the public site are simple line drawings like the existing Instagram one, not brand marks).

---
### Task 1: Golden record of today's build for sites with saved pages

The existing golden test (`site/test/golden.test.mjs`, `legacy.json`) covers sites that never saved pages. A site whose pages were saved from the editor but whose header, footer, theme and wording never were must also build exactly as it does today. Capture that output **before** `build.mjs` changes. The cases cover a logo present and absent, an Instagram link present and absent, a live address, the admin preview, a menu changed through the pages, and changed Style settings.

**Files:**
- Create: `site/test/golden/saved-cases.mjs`
- Create: `site/test/golden/capture-saved.mjs`
- Create (generated): `site/test/golden/saved.json`
- Test: `site/test/golden-saved.test.mjs`

**Interfaces:**
- Consumes: `build(state, opts)` from `site/build.mjs` (unchanged); `state()` from `site/test/fixtures.mjs`; `migratePages` from `site/pages.mjs`; `mk(id, type, props)` from `site/test/block-helpers.mjs`.
- Produces: `SAVED_CASES` (`{ name: [make: () => state, opts] }`) from `site/test/golden/saved-cases.mjs`; `site/test/golden/saved.json` (`{ name: { files: {path: content}, images: [[rel, rel]] } }`).

- [ ] **Step 1: Write the cases**

`site/test/golden/saved-cases.mjs`:

```js
/* The sites the second golden test builds: pages saved from the editor, but the header, footer, theme and wording
   never saved. A logo or none, an Instagram link or none, a live address, the admin preview, and a site whose menu
   was changed through its pages. */
import { state } from '../fixtures.mjs';
import { migratePages } from '../../pages.mjs';
import { mk } from '../block-helpers.mjs';

const saved = (edit = () => {}) => () => { const s = state(); s.pages = migratePages(s.settings, s.galleries); edit(s); return s; };
const logo = s => { s.settings.style = { ...s.settings.style, logo: 'logo.svg' }; };
const noInstagram = s => { s.settings.footer = { copyright: '© Example', instagram: '' }; };
const menu = s => {
  s.pages.splice(1, 0, { id: 'pwork', title: 'Work & Play', slug: 'work', inMenu: true, seoTitle: '', seoDescription: '', galleryId: null,
    blocks: [mk('bw1', 'heading', { text: 'Hi <there>' })] });
  s.pages.find(p => p.id === 'contact').inMenu = false;
};
const styled = s => { s.settings.style = { ...s.settings.style, page: '#ffffff', ink: '#112233', headingFont: 'Lora', bodyFont: 'Lora', textSize: 'larger', gap: 'roomy', cardShape: 'square' }; };

export const SAVED_CASES = {
  full: [saved(), {}],
  logo: [saved(logo), { siteUrl: 'https://example.com' }],
  noInstagram: [saved(noInstagram), {}],
  preview: [saved(logo), { base: '/admin/site-preview/' }],
  menu: [saved(menu), {}],
  styled: [saved(styled), {}],
};
```

- [ ] **Step 2: Write the capture script**

`site/test/golden/capture-saved.mjs`:

```js
/* Run once, before build.mjs learns about the header, footer, theme and wording:
     node site/test/golden/capture-saved.mjs
   Records what today's builder makes for each case in saved-cases.mjs. It refuses to overwrite. */
import { writeFileSync, existsSync } from 'node:fs';
import { build } from '../../build.mjs';
import { SAVED_CASES } from './saved-cases.mjs';

const out = new URL('./saved.json', import.meta.url);
if (existsSync(out)) { console.error('saved.json already exists and must not change'); process.exit(1); }
const all = {};
for (const [name, [make, opts]] of Object.entries(SAVED_CASES)) {
  const { files, images } = build(make(), opts);
  all[name] = { files: Object.fromEntries([...files].sort()), images: [...images].sort() };
}
writeFileSync(out, JSON.stringify(all, null, 1) + '\n');
console.log('wrote', out.pathname);
```

- [ ] **Step 3: Write the test**

`site/test/golden-saved.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../build.mjs';
import { SAVED_CASES } from './golden/saved-cases.mjs';

/* recorded by golden/capture-saved.mjs from the builder as it was before the header, footer, theme and wording
   could be edited */
const want = JSON.parse(readFileSync(new URL('./golden/saved.json', import.meta.url), 'utf8'));

test('a site whose pages were saved but whose header, footer, theme and wording never were builds exactly as before', () => {
  assert.deepEqual(Object.keys(want).sort(), Object.keys(SAVED_CASES).sort());
  for (const [name, [make, opts]] of Object.entries(SAVED_CASES)) {
    const { files, images } = build(make(), opts);
    assert.deepEqual(Object.fromEntries([...files].sort()), want[name].files, name);
    assert.deepEqual([...images].sort(), want[name].images, name);
  }
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `node --test site/test/golden-saved.test.mjs`
Expected: FAIL with `ENOENT: no such file or directory, open '…/site/test/golden/saved.json'`.

- [ ] **Step 5: Capture today's output (once, before anything else changes)**

Run: `git status --short site/build.mjs && node site/test/golden/capture-saved.mjs`
Expected: `git status` prints nothing for `site/build.mjs` (unchanged), then `wrote …/site/test/golden/saved.json`. Running the script a second time prints `saved.json already exists and must not change` and exits 1.

- [ ] **Step 6: Run it to see it pass**

Run: `node --test site/test/golden-saved.test.mjs site/test/golden.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit (commit only after the user approves)**

```bash
git add site/test/golden/saved-cases.mjs site/test/golden/capture-saved.mjs site/test/golden/saved.json site/test/golden-saved.test.mjs
git commit -m "Website tests: golden record of today's build for sites with saved pages"
```

---

### Task 2: Theme module: fonts, theme schema, CSS variables

Move the font list, the size/gap/ratio tables and `rootVars` out of `build.mjs`/`store.mjs` into `site/theme.mjs`, and add the theme's schema (today's Style settings plus an accent colour), its check, and the conversion from the old Style settings. `rootVars` writes `--accent` only when asked, so every existing site keeps its bytes.

**Files:**
- Create: `site/theme.mjs`
- Modify: `site/build.mjs` (imports, remove `GAPS`/`RATIOS`/`SCALES`/`rootVars`)
- Modify: `site/store.mjs` (`FONTS` comes from `theme.mjs`)
- Modify: `deploy.sh` (`FILES`)
- Test: `site/test/theme.test.mjs`

**Interfaces:**
- Consumes: `cleanFields(raw, fields, defaults)` from `site/blocks/common.mjs`.
- Produces: `FONTS: string[]`, `GAPS`, `RATIOS`, `SCALES`, `THEME_DEFAULTS` (`{ page, band, text, ink, accent, headingFont, bodyFont, textSize, gap, cardShape, colsDesktop, colsPhone }`), `THEME_SCHEMA: field[]` (fields may carry `group`), `cleanTheme(raw) -> { theme, errors }`, `themeFromStyle(style) -> theme`, `rootVars(st, { accent = false }) -> string`. `site/store.mjs` keeps exporting `FONTS` (re-export).

- [ ] **Step 1: Write the failing test**

`site/test/theme.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FONTS, THEME_DEFAULTS, THEME_SCHEMA, cleanTheme, themeFromStyle, rootVars } from '../theme.mjs';
import { FONTS as STORE_FONTS, DEFAULT_STYLE } from '../store.mjs';

test('the theme describes every value it has, and its defaults are today’s look', () => {
  assert.deepEqual(THEME_SCHEMA.map(f => f.key), Object.keys(THEME_DEFAULTS));
  assert.deepEqual(themeFromStyle(DEFAULT_STYLE), THEME_DEFAULTS);
  assert.equal(STORE_FONTS, FONTS, 'one list of fonts');
});

test('colours must be six-digit, fonts must be on the list, sizes must be known', () => {
  const r = cleanTheme({ ...THEME_DEFAULTS, page: 'red', accent: '#ABCDEF', headingFont: 'Comic Sans', textSize: 'huge', colsDesktop: 9 });
  assert.deepEqual(Object.keys(r.errors).sort(), ['colsDesktop', 'headingFont', 'page', 'textSize']);
  assert.equal(r.theme.page, THEME_DEFAULTS.page);
  assert.equal(r.theme.accent, '#abcdef');
  assert.equal(r.theme.headingFont, 'Roboto');
  assert.deepEqual(cleanTheme(THEME_DEFAULTS), { theme: { ...THEME_DEFAULTS }, errors: {} });
  assert.deepEqual(cleanTheme('nope').theme, { ...THEME_DEFAULTS });
});

test('the CSS variables are written as before, with the accent only when asked for', () => {
  const old = ":root{--page:#f4f5f0;--band:#e3e8df;--text:#373737;--ink:#343b2f;--font-head:'Roboto',system-ui,sans-serif;"
    + "--font-body:'Figtree',system-ui,sans-serif;--scale:1;--gap:.68rem;--card-ratio:226 / 276}\n";
  assert.equal(rootVars(DEFAULT_STYLE), old);
  assert.equal(rootVars({ ...THEME_DEFAULTS, accent: '#aa0000' }, { accent: true }), old.replace('}\n', ';--accent:#aa0000}\n'));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/theme.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `site/theme.mjs`.

- [ ] **Step 3: Write the module**

`site/theme.mjs`:

```js
/* The website's theme: colours, fonts, text size, photo spacing, card shape and gallery columns, how they are checked,
   and the CSS variables they become. A site that never saved its theme uses its old Style settings instead
   (themeFromStyle), and their variables are written exactly as before. Pure. */
import { cleanFields } from './blocks/common.mjs';

/* the only fonts a theme may use: the Google Fonts address is built from these names */
export const FONTS = ['Roboto', 'Figtree', 'Montserrat', 'Inter', 'Lato', 'Lora',
                      'Playfair Display', 'Cormorant Garamond', 'EB Garamond', 'Josefin Sans'];
export const GAPS = { none: '0rem', tight: '.68rem', normal: '1.2rem', roomy: '2rem' };
export const RATIOS = { tall: '226 / 276', square: '1 / 1', wide: '3 / 2' };
export const SCALES = { smaller: 0.9, normal: 1, larger: 1.12 };

export const THEME_DEFAULTS = Object.freeze({
  page: '#f4f5f0', band: '#e3e8df', text: '#373737', ink: '#343b2f', accent: '#343b2f',
  headingFont: 'Roboto', bodyFont: 'Figtree', textSize: 'normal', gap: 'tight', cardShape: 'tall', colsDesktop: 4, colsPhone: 2,
});
const fontOptions = FONTS.map(f => [f, f]);
/* group starts a new heading in the editor's Theme panel */
export const THEME_SCHEMA = [
  { key: 'page', label: 'Page background', kind: 'color', group: 'Colours' },
  { key: 'band', label: 'Header and footer', kind: 'color' },
  { key: 'text', label: 'Body text', kind: 'color' },
  { key: 'ink', label: 'Headings and menu', kind: 'color' },
  { key: 'accent', label: 'Buttons in the header and footer', kind: 'color' },
  { key: 'headingFont', label: 'Heading font', kind: 'select', options: fontOptions, group: 'Text' },
  { key: 'bodyFont', label: 'Body font', kind: 'select', options: fontOptions },
  { key: 'textSize', label: 'Text size', kind: 'select', options: [['smaller', 'Smaller'], ['normal', 'Normal'], ['larger', 'Larger']] },
  { key: 'gap', label: 'Space between photos', kind: 'select', options: [['none', 'None'], ['tight', 'Tight'], ['normal', 'Normal'], ['roomy', 'Roomy']], group: 'Spacing and layout' },
  { key: 'cardShape', label: 'Gallery card shape', kind: 'select', options: [['tall', 'Tall'], ['square', 'Square'], ['wide', 'Wide']] },
  { key: 'colsDesktop', label: 'Gallery columns on computers', kind: 'select', options: [[2, '2'], [3, '3'], [4, '4'], [5, '5']] },
  { key: 'colsPhone', label: 'Gallery columns on phones', kind: 'select', options: [[1, '1'], [2, '2']] },
];

export function cleanTheme(raw) {
  const r = cleanFields(raw, THEME_SCHEMA, THEME_DEFAULTS);
  return { theme: r.props, errors: r.errors };
}

/* the theme a site had before it could be edited here: its Style settings, with the accent taken from the ink */
export function themeFromStyle(st) {
  return { page: st.page, band: st.band, text: st.text, ink: st.ink, accent: st.ink, headingFont: st.headingFont, bodyFont: st.bodyFont,
           textSize: st.textSize, gap: st.gap, cardShape: st.cardShape, colsDesktop: st.colsDesktop, colsPhone: st.colsPhone };
}

/* the :root line build.mjs puts above site.css; --accent only once the theme has been saved, so older sites keep their bytes */
export function rootVars(st, { accent = false } = {}) {
  return `:root{--page:${st.page};--band:${st.band};--text:${st.text};--ink:${st.ink};`
    + `--font-head:'${st.headingFont}',system-ui,sans-serif;--font-body:'${st.bodyFont}',system-ui,sans-serif;`
    + `--scale:${SCALES[st.textSize]};--gap:${GAPS[st.gap]};--card-ratio:${RATIOS[st.cardShape]}${accent ? `;--accent:${st.accent}` : ''}}\n`;
}
```

- [ ] **Step 4: Use it from the builder and the store**

In `site/build.mjs`, replace:

```js
import { migratePages, resolvePages, isShownPage, pageHref } from './pages.mjs';
```

with:

```js
import { migratePages, resolvePages, isShownPage, pageHref } from './pages.mjs';
import { rootVars } from './theme.mjs';
```

In `site/build.mjs`, delete (including the blank line after it, where shown):

```js
const GAPS = { none: '0rem', tight: '.68rem', normal: '1.2rem', roomy: '2rem' };
const RATIOS = { tall: '226 / 276', square: '1 / 1', wide: '3 / 2' };
const SCALES = { smaller: 0.9, normal: 1, larger: 1.12 };
```

In `site/build.mjs`, delete (including the blank line after it, where shown):

```js
function rootVars(st) {
  return `:root{--page:${st.page};--band:${st.band};--text:${st.text};--ink:${st.ink};`
    + `--font-head:'${st.headingFont}',system-ui,sans-serif;--font-body:'${st.bodyFont}',system-ui,sans-serif;`
    + `--scale:${SCALES[st.textSize]};--gap:${GAPS[st.gap]};--card-ratio:${RATIOS[st.cardShape]}}\n`;
}

```

In `site/store.mjs`, replace:

```js
import { cleanPages } from './pages.mjs';

export const FONTS = ['Roboto', 'Figtree', 'Montserrat', 'Inter', 'Lato', 'Lora',
                      'Playfair Display', 'Cormorant Garamond', 'EB Garamond', 'Josefin Sans'];
```

with:

```js
import { cleanPages } from './pages.mjs';
import { FONTS } from './theme.mjs';

export { FONTS };
```

In `deploy.sh` (the second line of `FILES`), replace:

```bash
site/watch.mjs site/routes.mjs
```

with:

```bash
site/watch.mjs site/routes.mjs site/theme.mjs
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test site/test`
Expected: PASS, including `theme.test.mjs`, both golden tests and `deploy-files.test.mjs`.

- [ ] **Step 6: Commit (commit only after the user approves)**

```bash
git add site/theme.mjs site/test/theme.test.mjs site/build.mjs site/store.mjs deploy.sh
git commit -m "Website: theme module with the font list, theme checks and CSS variables"
```

---

### Task 3: Wording module

The site's fixed wording, each defaulting to today's text: the not-found page's tab title, heading and home link, the photo viewer's three button names, the back-to-top arrow's name and the phone menu button's name. The viewer's buttons are made by `site.js`, which must not change (byte identity), so a small script appended after it renames them once the wording has been saved.

**Files:**
- Create: `site/wording.mjs`
- Modify: `deploy.sh` (`FILES`)
- Test: `site/test/wording.test.mjs`

**Interfaces:**
- Consumes: `cleanFields` from `site/blocks/common.mjs`.
- Produces: `WORDING_DEFAULTS` (`{ notFoundTitle, notFoundHeading, backHome, viewerClose, viewerPrev, viewerNext, toTop, menu }`), `WORDING_SCHEMA: field[]` (all `kind: 'text'`, may carry `group`), `cleanWording(raw) -> { wording, errors }` (empty values become their default), `viewerScript(wording) -> string` (JavaScript).

- [ ] **Step 1: Write the failing test**

`site/test/wording.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { WORDING_DEFAULTS, WORDING_SCHEMA, cleanWording, viewerScript } from '../wording.mjs';

const SITE_JS = readFileSync(new URL('../assets/site.js', import.meta.url), 'utf8');

test('every piece of fixed wording is described, and its default is today’s text', () => {
  assert.deepEqual(WORDING_SCHEMA.map(f => f.key), Object.keys(WORDING_DEFAULTS));
  assert.match(SITE_JS, /aria-label="Close".*aria-label="Previous".*aria-label="Next"/s, 'the viewer still names its buttons like this');
  assert.deepEqual(cleanWording({}), { wording: { ...WORDING_DEFAULTS }, errors: {} });
});

test('wording is trimmed and cut to length; emptied wording goes back to its default', () => {
  const { wording } = cleanWording({ notFoundHeading: '  Oops <b>  ', backHome: '', viewerClose: 'x'.repeat(100), menu: 42 });
  assert.equal(wording.notFoundHeading, 'Oops <b>', 'escaped where it is written, not here');
  assert.equal(wording.backHome, 'Back to home');
  assert.equal(wording.viewerClose.length, 40);
  assert.equal(wording.menu, '42');
});

test('the viewer script renames the buttons site.js made, and nothing else', () => {
  const made = {};
  const btn = sel => ({ setAttribute: (k, v) => { made[sel] = [k, v]; } });
  const document = { querySelector: s => (/^\.lb \.lb-(close|prev|next)$/.test(s) ? btn(s) : null) };
  vm.runInNewContext(viewerScript({ ...WORDING_DEFAULTS, viewerClose: 'Schließen "x"', viewerNext: '</script>' }), { document });
  assert.deepEqual(made, { '.lb .lb-close': ['aria-label', 'Schließen "x"'], '.lb .lb-prev': ['aria-label', 'Previous'], '.lb .lb-next': ['aria-label', '</script>'] });
  vm.runInNewContext(viewerScript(WORDING_DEFAULTS), { document: { querySelector: () => null } });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/wording.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `site/wording.mjs`.

- [ ] **Step 3: Write the module**

`site/wording.mjs`:

```js
/* The website's fixed wording: the words the site itself writes that are not part of any page - the "not found" page,
   the photo viewer's buttons, the back-to-top arrow and the phone menu button. Each defaults to today's text, and an
   emptied one goes back to its default, so no button is ever left without a name. Pure. */
import { cleanFields } from './blocks/common.mjs';

export const WORDING_DEFAULTS = Object.freeze({
  notFoundTitle: 'Not found', notFoundHeading: 'Page not found', backHome: 'Back to home',
  viewerClose: 'Close', viewerPrev: 'Previous', viewerNext: 'Next', toTop: 'Back to top', menu: 'Menu',
});
export const WORDING_SCHEMA = [
  { key: 'notFoundTitle', label: 'Browser tab title', kind: 'text', max: 80, group: 'Page not found' },
  { key: 'notFoundHeading', label: 'Heading', kind: 'text', max: 120 },
  { key: 'backHome', label: 'Link back to the home page', kind: 'text', max: 60 },
  { key: 'viewerClose', label: 'Close button', kind: 'text', max: 40, group: 'Photo viewer (read out by screen readers)' },
  { key: 'viewerPrev', label: 'Previous photo button', kind: 'text', max: 40 },
  { key: 'viewerNext', label: 'Next photo button', kind: 'text', max: 40 },
  { key: 'toTop', label: 'Back-to-top arrow', kind: 'text', max: 40, group: 'Header and footer (read out by screen readers)' },
  { key: 'menu', label: 'Phone menu button', kind: 'text', max: 40 },
];

export function cleanWording(raw) {
  const r = cleanFields(raw, WORDING_SCHEMA, WORDING_DEFAULTS);
  for (const k of Object.keys(WORDING_DEFAULTS)) if (!r.props[k]) r.props[k] = WORDING_DEFAULTS[k];
  return { wording: r.props, errors: r.errors };
}

/* added to the published site.js once the wording has been saved: site.js makes the photo viewer's buttons with
   today's names, and this renames them. JSON keeps the words a plain string; build.mjs's inline() stops a "</script"
   inside them from ending the editor preview's script. */
export function viewerScript(w) {
  const names = { '.lb-close': w.viewerClose, '.lb-prev': w.viewerPrev, '.lb-next': w.viewerNext };
  return `// The photo viewer's buttons, in the site's own words\n(function () {\n  const names = ${JSON.stringify(names)};\n`
    + `  for (const sel in names) { const b = document.querySelector('.lb ' + sel); if (b) b.setAttribute('aria-label', names[sel]); }\n})();\n`;
}
```

In `deploy.sh`, replace:

```bash
site/routes.mjs site/theme.mjs
```

with:

```bash
site/routes.mjs site/theme.mjs site/wording.mjs
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test site/test`
Expected: PASS.

- [ ] **Step 5: Commit (commit only after the user approves)**

```bash
git add site/wording.mjs site/test/wording.test.mjs deploy.sh
git commit -m "Website: the site's fixed wording, with today's text as defaults"
```

---

### Task 4: Header and footer elements: types and checks

One module for the bands: the eight element types (each with label, Lucide icon name, defaults, a form description using the existing field kinds plus `menu`, a check and its markup), the band style schemas, the element motion schema (entrance, duration, delay from the block motion schema, plus a hover effect), visibility (the block "Show on" field), and `cleanElement`/`cleanBand`. Links, buttons and social links are checked by `cleanFields` exactly as blocks are (`link` and `url` kinds → `safeUrl`); menu links may also be a path on this site (`menuUrl`). An empty menu link address is allowed (the item is not shown); a non-empty bad one is refused.

**Files:**
- Create: `site/bands.mjs` (first part; Task 5 appends the rendering)
- Modify: `deploy.sh` (`FILES`)
- Test: `site/test/bands.test.mjs`

**Interfaces:**
- Consumes: `cleanFields`, `esc`, `text`, `safeUrl`, `linkHref`, `MOTION_SCHEMA`, `STYLE_SCHEMA` from `site/blocks/common.mjs`.
- Produces: `BAND_LIMITS` (`{ elements: 20, menuItems: 20, label: 60 }`), `MENU_LINK_ERROR`, `menuUrl(u) -> string` ('' when refused), `IG`, `UP` (SVG strings, moved from `build.mjs` unchanged), `ELEMENT_TYPES: Map<type, { type, label, icon, hint?, defaults, fields, validate(props) -> { props, errors }, render(el, ctx) -> string }>`, `listElementTypes() -> [{ type, label, icon, hint, defaults, fields }]`, `ELEMENT_MOTION_DEFAULTS` (`{ entrance, duration, delay, hover }`), `ELEMENT_HOVER`, `ELEMENT_MOTION_SCHEMA`, `ELEMENT_VISIBLE` (the `visible` field), `HEADER_STYLE_SCHEMA`/`HEADER_STYLE_DEFAULTS` (`{ background, bgColor, padding, alignment, sticky }`), `FOOTER_STYLE_SCHEMA`/`FOOTER_STYLE_DEFAULTS` (`{ background, bgColor, padding, alignment, toTop }`), `cleanElement(raw, ids: Set) -> { element | null, errors: string[] }` with `element = { id, type, props, motion, visible }`, `cleanBand(raw, 'header' | 'footer', ids: Set) -> { band: { style, elements } | null, errors: string[] }`. Menu props: `{ items: null | [{ id, kind: 'page', pageId } | { id, kind: 'link', label, url }], phone: 'row' | 'button' }`.

- [ ] **Step 1: Write the failing test**

`site/test/bands.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/bands.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `site/bands.mjs`.

- [ ] **Step 3: Write the module**

`site/bands.mjs`:

```js
/* The header and footer: the elements a band holds, how each is checked and written, and the band's own style.
   band = { style, elements }; element = { id, type, props, motion, visible }. A site that never saved its header and
   footer gets them made from its old settings (sitewide.mjs migrateSite), and those render to exactly the markup
   build.mjs wrote before. Text is escaped and every address is checked (safeUrl, or a path on this site for menu
   items); there is no way to put HTML or a script in a band. Pure. */
import { cleanFields, esc, text, safeUrl, linkHref, MOTION_SCHEMA, STYLE_SCHEMA } from './blocks/common.mjs';

export const BAND_LIMITS = Object.freeze({ elements: 20, menuItems: 20, label: 60 });
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/* ---- addresses ---- */
const SITE_PATH = /^\/(?![\/\\])[^\s"'<>\\]*$/;
export const MENU_LINK_ERROR = 'menu links must start with https://, http://, mailto:, tel: or / for a page on this site';
/* a menu item may also point at a path on this site, such as /about/ */
export function menuUrl(u) {
  const s = text(u, 300);
  if (!s || /[\u0000-\u001f\u007f]/.test(s)) return '';
  return SITE_PATH.test(s) ? s : safeUrl(s);
}

/* ---- icons: trusted constants, never user text ---- */
const svg = (inner, w = 16, sw = 1.6) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="${sw}" aria-hidden="true">${inner}</svg>`;
export const IG = svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="0.6" fill="currentColor"/>');
export const UP = svg('<path d="M12 20V4M5 11l7-7 7 7"/>', 18, 1.4);
const SOCIAL = {
  instagram: ['Instagram', IG],
  facebook: ['Facebook', svg('<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z"/>')],
  youtube: ['YouTube', svg('<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.5v5l4.5-2.5z"/>')],
  linkedin: ['LinkedIn', svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-7M12 13a3 3 0 0 1 6 0v4"/>')],
};

/* ---- element types ---- */
const plain = t => ({ ...t, validate: props => cleanFields(props, t.fields, t.defaults) });
const tabAttr = p => (p.newTab ? ' target="_blank" rel="noopener noreferrer"' : '');

const logo = plain({
  type: 'logo', label: 'Logo', icon: 'image', hint: 'Upload or remove the logo in Theme. Without one, the site name is shown.',
  defaults: Object.freeze({ size: 'normal' }),
  fields: [{ key: 'size', label: 'Size', kind: 'select', options: [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']] }],
  render: (e, ctx) => `<a class="logo${e.props.size === 'normal' ? '' : ` lg-${e.props.size}`}" href="${ctx.base}">${ctx.logoHtml}</a>`,
});
const siteName = plain({
  type: 'siteName', label: 'Site name', icon: 'type', hint: 'The name itself is set at the top of the Header panel.',
  defaults: Object.freeze({}), fields: [],
  render: (e, ctx) => (ctx.siteName ? `<a class="site-name" href="${ctx.base}">${esc(ctx.siteName)}</a>` : ''),
});

const MENU_FIELDS = [
  { key: 'items', label: 'Menu items', kind: 'menu', hint: 'Automatic lists the pages marked “Show in the menu”, in page order.' },
  { key: 'phone', label: 'On phones', kind: 'select', options: [['row', 'Keep the links in a row'], ['button', 'Fold them into a menu button']], hint: 'Only in the header.' },
];
const menu = {
  type: 'menu', label: 'Menu', icon: 'ellipsis',
  defaults: Object.freeze({ items: null, phone: 'button' }), fields: MENU_FIELDS,
  validate(props) {
    const r = cleanFields(props, MENU_FIELDS.filter(f => f.kind !== 'menu'), this.defaults);
    const raw = props && typeof props === 'object' ? props.items : null;
    let items = null;
    if (raw != null && !Array.isArray(raw)) r.errors.items = 'must be a list, or nothing for automatic';
    if (Array.isArray(raw)) {
      items = [];
      if (raw.length > BAND_LIMITS.menuItems) r.errors.items = `at most ${BAND_LIMITS.menuItems} items`;
      const seen = new Set();
      for (const it of raw.slice(0, BAND_LIMITS.menuItems)) {
        const id = String(it?.id ?? '');
        if (!it || typeof it !== 'object' || !ID.test(id) || seen.has(id)) { r.errors.items = 'an item has a missing or repeated id'; continue; }
        seen.add(id);
        if (it.kind === 'page') {
          const pageId = String(it.pageId ?? '');
          if (ID.test(pageId)) items.push({ id, kind: 'page', pageId }); else r.errors.items = 'an item points at no page';
        } else if (it.kind === 'link') {
          const raw = text(it.url, 300), url = menuUrl(raw);
          if (raw && !url) r.errors.items = MENU_LINK_ERROR;
          items.push({ id, kind: 'link', label: text(it.label, BAND_LIMITS.label), url });
        } else r.errors.items = 'an item is neither a page nor a link';
      }
    }
    return { props: { items, phone: r.props.phone }, errors: r.errors };
  },
  render(e, ctx) {
    const a = (href, label) => `<a href="${esc(href)}">${esc(label)}</a>`;
    const auto = ctx.menuPages;
    let links;
    if (!e.props.items) links = auto.map(p => a(p.href, p.title));
    else {
      /* the owner's order; a page shows while it is marked for the menu, and one marked later joins at the end */
      const byId = new Map(auto.map(p => [p.id, p])), used = new Set();
      links = [];
      for (const it of e.props.items) {
        if (it.kind === 'page') { const p = byId.get(it.pageId); if (p && !used.has(p.id)) { used.add(p.id); links.push(a(p.href, p.title)); } }
        else if (it.label && it.url) links.push(a(ctx.siteHref(it.url), it.label));
      }
      for (const p of auto) if (!used.has(p.id)) links.push(a(p.href, p.title));
    }
    const nav = links.join('');
    if (e.props.phone !== 'button' || ctx.band !== 'header') return `<nav>${nav}</nav>`;
    /* a checkbox and its label open the menu on phones, so it works without JavaScript */
    const id = `nav-${e.id}`;
    return `<input type="checkbox" id="${id}" class="nav-t" aria-label="${esc(ctx.wording.menu)}">`
      + `<label for="${id}" class="nav-b" aria-hidden="true"><span></span></label><nav class="nav-c">${nav}</nav>`;
  },
};

const LINK_DEFAULT = Object.freeze({ kind: 'page', url: '', pageId: 'contact' });
const link = plain({
  type: 'link', label: 'Link', icon: 'chevron-right',
  defaults: Object.freeze({ label: 'Contact', link: LINK_DEFAULT, newTab: false }),
  fields: [
    { key: 'label', label: 'Words', kind: 'text', max: BAND_LIMITS.label },
    { key: 'link', label: 'Goes to', kind: 'link' },
    { key: 'newTab', label: 'Open in a new tab', kind: 'toggle' },
  ],
  render(e, ctx) {
    const href = linkHref(e.props.link, ctx);
    return href && e.props.label ? `<a class="el-link" href="${esc(href)}"${tabAttr(e.props)}>${esc(e.props.label)}</a>` : '';
  },
});
const button = plain({
  type: 'button', label: 'Button', icon: 'chevron-right',
  defaults: Object.freeze({ label: 'Get in touch', link: LINK_DEFAULT, look: 'solid', newTab: false }),
  fields: [
    { key: 'label', label: 'Words on the button', kind: 'text', max: BAND_LIMITS.label },
    { key: 'link', label: 'Goes to', kind: 'link' },
    { key: 'look', label: 'Look', kind: 'select', options: [['solid', 'Solid'], ['outline', 'Outline']] },
    { key: 'newTab', label: 'Open in a new tab', kind: 'toggle' },
  ],
  render(e, ctx) {
    const href = linkHref(e.props.link, ctx);
    return href && e.props.label ? `<a class="hbtn hbtn-${e.props.look}" href="${esc(href)}"${tabAttr(e.props)}>${esc(e.props.label)}</a>` : '';
  },
});
const social = plain({
  type: 'social', label: 'Social link', icon: 'heart',
  defaults: Object.freeze({ network: 'instagram', url: '' }),
  fields: [
    { key: 'network', label: 'Site', kind: 'select', options: Object.entries(SOCIAL).map(([k, [name]]) => [k, name]) },
    { key: 'url', label: 'Address of your page', kind: 'url' },
  ],
  render(e) {
    const net = SOCIAL[e.props.network];
    if (!net || !e.props.url) return '';
    const cls = e.props.network === 'instagram' ? 'ig' : `soc soc-${e.props.network}`;
    return `<a class="${cls}" href="${esc(e.props.url)}" aria-label="${net[0]}" target="_blank" rel="noopener">${net[1]}</a>`;
  },
});
const textEl = plain({
  type: 'text', label: 'Text', icon: 'type',
  defaults: Object.freeze({ text: '' }),
  fields: [{ key: 'text', label: 'Text', kind: 'text', max: 200 }],
  render: e => (e.props.text ? `<span>${esc(e.props.text)}</span>` : ''),
});
const spacer = plain({
  type: 'spacer', label: 'Space', icon: 'sliders-horizontal',
  defaults: Object.freeze({ size: 'medium' }),
  fields: [{ key: 'size', label: 'Size', kind: 'select', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['fill', 'All the room left']] }],
  render: e => `<span class="esp esp-${e.props.size}" aria-hidden="true"></span>`,
});

const TYPES = [logo, siteName, menu, link, button, social, textEl, spacer];
export const ELEMENT_TYPES = new Map(TYPES.map(t => [t.type, t]));
export function listElementTypes() {
  return TYPES.map(t => ({ type: t.type, label: t.label, icon: t.icon, hint: t.hint || '', defaults: t.defaults, fields: t.fields }));
}

/* ---- motion and visibility, the same for every element ---- */
export const ELEMENT_MOTION_DEFAULTS = Object.freeze({ entrance: 'none', duration: 700, delay: 0, hover: 'none' });
export const ELEMENT_HOVER = [['none', 'None'], ['fade', 'Fade'], ['lift', 'Lift'], ['grow', 'Grow']];
export const ELEMENT_MOTION_SCHEMA = [...MOTION_SCHEMA.slice(0, 3), { key: 'hover', label: 'On hover', kind: 'select', options: ELEMENT_HOVER }];
export const ELEMENT_VISIBLE = STYLE_SCHEMA.find(f => f.key === 'visible');

/* ---- the bands' own style ---- */
const BAND_COMMON = [
  { key: 'background', label: 'Background', kind: 'select', options: [['theme', 'Theme colour'], ['color', 'Its own colour']] },
  { key: 'bgColor', label: 'Background colour', kind: 'color', when: ['background', 'color'] },
  { key: 'padding', label: 'Height', kind: 'select', options: [['compact', 'Compact'], ['normal', 'Normal'], ['roomy', 'Roomy']] },
  { key: 'alignment', label: 'Arrangement', kind: 'select', options: [['spread', 'Spread out'], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] },
];
export const HEADER_STYLE_SCHEMA = [...BAND_COMMON, { key: 'sticky', label: 'Stay at the top while scrolling', kind: 'toggle' }];
export const FOOTER_STYLE_SCHEMA = [...BAND_COMMON, { key: 'toTop', label: 'Back-to-top arrow', kind: 'toggle' }];
export const HEADER_STYLE_DEFAULTS = Object.freeze({ background: 'theme', bgColor: '#ffffff', padding: 'normal', alignment: 'spread', sticky: false });
export const FOOTER_STYLE_DEFAULTS = Object.freeze({ background: 'theme', bgColor: '#ffffff', padding: 'normal', alignment: 'spread', toTop: true });
const BANDS = {
  header: { name: 'Header', schema: HEADER_STYLE_SCHEMA, defaults: HEADER_STYLE_DEFAULTS },
  footer: { name: 'Footer', schema: FOOTER_STYLE_SCHEMA, defaults: FOOTER_STYLE_DEFAULTS },
};

/* ---- checking ---- */
/* ids: element ids already taken anywhere on the site (header and footer share one set) */
export function cleanElement(raw, ids = new Set()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { element: null, errors: ['an element must be an object'] };
  const t = ELEMENT_TYPES.get(raw.type);
  if (!t) return { element: null, errors: [`unknown element "${String(raw.type).slice(0, 40)}"`] };
  const id = String(raw.id ?? '');
  if (!ID.test(id)) return { element: null, errors: [`${t.label}: the element id "${id.slice(0, 40)}" is not valid`] };
  if (ids.has(id)) return { element: null, errors: [`${t.label}: the element id "${id}" is used twice`] };
  ids.add(id);
  const p = t.validate(raw.props), m = cleanFields(raw.motion, ELEMENT_MOTION_SCHEMA, ELEMENT_MOTION_DEFAULTS);
  const v = cleanFields(raw, [ELEMENT_VISIBLE], { visible: 'all' });
  const errors = [...Object.entries(p.errors), ...Object.entries(m.errors), ...Object.entries(v.errors)].map(([k, e]) => `${t.label}, ${k}: ${e}`);
  return { element: { id, type: t.type, props: p.props, motion: m.props, visible: v.props.visible }, errors };
}

export function cleanBand(raw, which, ids = new Set()) {
  const b = BANDS[which];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { band: null, errors: [`${b.name}: missing`] };
  const s = cleanFields(raw.style, b.schema, b.defaults);
  const errors = Object.entries(s.errors).map(([k, e]) => `${b.name}, ${k}: ${e}`);
  if (!Array.isArray(raw.elements)) errors.push(`${b.name}: the elements must be a list`);
  const list = Array.isArray(raw.elements) ? raw.elements : [];
  if (list.length > BAND_LIMITS.elements) errors.push(`${b.name}: at most ${BAND_LIMITS.elements} elements`);
  const elements = [];
  for (const r of list.slice(0, BAND_LIMITS.elements)) {
    const c = cleanElement(r, ids);
    if (c.element) elements.push(c.element);
    errors.push(...c.errors.map(e => `${b.name}: ${e}`));
  }
  return { band: { style: s.props, elements }, errors };
}

```

In `deploy.sh`, replace:

```bash
site/theme.mjs site/wording.mjs
```

with:

```bash
site/theme.mjs site/wording.mjs site/bands.mjs
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test site/test`
Expected: PASS.

- [ ] **Step 5: Commit (commit only after the user approves)**

```bash
git add site/bands.mjs site/test/bands.test.mjs deploy.sh
git commit -m "Website: header and footer element types, band style and their checks"
```

---

### Task 5: Header and footer elements: markup

`renderHeader`/`renderFooter` write a band, `renderElement` one element. An element with default motion and visibility is written as its own markup with no wrapper, and one with nothing to show keeps its slot as `<span></span>`, so the bands made from the old settings come out exactly as `build.mjs` writes them today (the test pins the exact strings). Motion or visibility wrap the element in `<div class="el …">`; the editor wraps every element with `data-e` and marks bands with `data-band`. A "spread out" footer stays the old three-column grid; any other element count gets its own `grid-template-columns` inline, so the default footer's bytes never change.

**Files:**
- Modify: `site/bands.mjs` (append)
- Test: `site/test/bands-render.test.mjs`

**Interfaces:**
- Consumes: Task 4's element types and schemas; `WORDING_DEFAULTS` from `site/wording.mjs` (test only).
- Produces: `renderElement(el, ctx) -> string | null` (null: left out), `renderHeader(band, ctx) -> string`, `renderFooter(band, ctx) -> string`, where `ctx = { base, editor, siteName, logoHtml, wording, menuPages: [{ id, title, href }], pageHref(id) -> string | null, siteHref(path) -> string }`. Class names: band `top`/`foot` + `bp-compact|bp-roomy`, `ba-left|ba-center|ba-right`, `bg-own` (with `--band-bg`), `sticky`; element wrapper `el`, `vis-desktop|vis-phone`, `blk-off` (editor only), `m m-<entrance>`, `eh-<hover>`; phone menu `nav-t` (checkbox), `nav-b` (label), `nav-c` (nav).

- [ ] **Step 1: Write the failing test**

`site/test/bands-render.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/bands-render.test.mjs`
Expected: FAIL with `SyntaxError: The requested module '../bands.mjs' does not provide an export named …` (one of the render functions).

- [ ] **Step 3: Add the rendering**

Append to the end of `site/bands.mjs`:

```js
/* ---- writing ----
   ctx: { base, editor, siteName, logoHtml, wording, menuPages: [{ id, title, href }], pageHref(id), siteHref(path) }.
   An element with nothing set in motion or visibility is written as its own markup, with no wrapper, and one with
   nothing to show keeps its place as an empty span: that is what keeps a band made from the old settings identical. */
export function renderElement(e, ctx) {
  const t = ELEMENT_TYPES.get(e.type);
  if (!t || (e.visible === 'none' && !ctx.editor)) return null;
  let inner = t.render(e, ctx);
  if (!inner) inner = ctx.editor ? `<span class="el-empty">${esc(t.label)}</span>` : '<span></span>';
  const m = e.motion, cls = ['el'], vars = [];
  if (e.visible === 'desktop' || e.visible === 'phone') cls.push(`vis-${e.visible}`);
  if (e.visible === 'none') cls.push('blk-off');
  if (m.entrance !== 'none') { cls.push('m', `m-${m.entrance}`); vars.push(`--m-dur:${m.duration}ms`, `--m-delay:${m.delay}ms`); }
  if (m.hover !== 'none') cls.push(`eh-${m.hover}`);
  if (cls.length === 1 && !ctx.editor) return inner;
  return `<div class="${cls.join(' ')}"${ctx.editor ? ` data-e="${esc(e.id)}"` : ''}${vars.length ? ` style="${vars.join(';')}"` : ''}>${inner}</div>`;
}

const PAD = { compact: ' bp-compact', normal: '', roomy: ' bp-roomy' };
function open(tag, cls, s, which, ctx, extraStyle = '') {
  let c = cls + PAD[s.padding] + (s.alignment === 'spread' ? '' : ` ba-${s.alignment}`);
  const style = [];
  if (s.background === 'color') { c += ' bg-own'; style.push(`--band-bg:${s.bgColor}`); }
  if (s.sticky) c += ' sticky';
  if (extraStyle) style.push(extraStyle);
  return `<${tag} class="${c}"${style.length ? ` style="${style.join(';')}"` : ''}${ctx.editor ? ` data-band="${which}"` : ''}>`;
}

export function renderHeader(h, ctx) {
  const c = { ...ctx, band: 'header' };
  const parts = h.elements.map(e => renderElement(e, c)).filter(x => x != null);
  return `${open('header', 'top', h.style, 'header', ctx)}\n  ${parts.join('\n  ')}\n</header>`;
}

/* spread out, the footer is a grid: the first element at the left, the last at the right and the rest between, as
   the old footer's three were; any other count gets its own columns */
export function renderFooter(f, ctx) {
  const c = { ...ctx, band: 'footer' };
  const parts = f.elements.map(e => renderElement(e, c)).filter(x => x != null);
  if (f.style.toTop) parts.push(`<a class="totop" href="#" aria-label="${esc(ctx.wording.toTop)}">${UP}</a>`);
  const n = parts.length;
  const cols = f.style.alignment === 'spread' && n !== 3
    ? `grid-template-columns:${n <= 1 ? '1fr' : `1fr${' auto'.repeat(n - 2)} 1fr`};column-gap:1.5rem` : '';
  return `${open('footer', 'foot', f.style, 'footer', ctx, cols)}\n  ${parts.join('\n  ')}\n</footer>`;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test site/test`
Expected: PASS.

- [ ] **Step 5: Commit (commit only after the user approves)**

```bash
git add site/bands.mjs site/test/bands-render.test.mjs
git commit -m "Website: header and footer markup, identical to today's for the old header and footer"
```

---

### Task 6: Site model: migration from the settings, and the whole-site check

`migrateSite(settings)` makes the site a never-saved site has: the logo (or site name) and the menu become the header (menu kept as a row on phones, as today), the copyright line and Instagram link the footer, the Style settings the theme (accent = ink), and today's wording. `cleanSite(raw)` checks name, both bands (element ids unique across header and footer), theme and wording, and reports every reason. What migration makes is always accepted unchanged.

**Files:**
- Create: `site/sitewide.mjs`
- Modify: `deploy.sh` (`FILES`)
- Test: `site/test/sitewide.test.mjs`

**Interfaces:**
- Consumes: `cleanBand`, `ELEMENT_TYPES`, `ELEMENT_MOTION_DEFAULTS`, `HEADER_STYLE_DEFAULTS`, `FOOTER_STYLE_DEFAULTS` (bands.mjs); `cleanTheme`, `themeFromStyle` (theme.mjs); `cleanWording`, `WORDING_DEFAULTS` (wording.mjs); `text` (blocks/common.mjs).
- Produces: `SITE_LIMITS` (`{ name: 80 }`), `migrateSite(settings) -> site`, `cleanSite(raw) -> { site: { name, header, footer, theme, wording } | null, errors: string[] }`. Migrated element ids: `hd-logo`, `hd-menu`, `ft-text`, `ft-social`.

- [ ] **Step 1: Write the failing test**

`site/test/sitewide.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateSite, cleanSite, SITE_LIMITS } from '../sitewide.mjs';
import { THEME_DEFAULTS } from '../theme.mjs';
import { WORDING_DEFAULTS } from '../wording.mjs';
import { DEFAULTS } from '../store.mjs';
import { state } from './fixtures.mjs';

test('an unsaved site’s header, footer and theme are made from its settings', () => {
  const s = state().settings;
  const m = migrateSite(s);
  assert.equal(m.name, 'Example Studio');
  assert.deepEqual(m.header.elements.map(e => [e.id, e.type]), [['hd-logo', 'logo'], ['hd-menu', 'menu']]);
  assert.equal(m.header.elements[1].props.phone, 'row', 'the old menu never folds');
  assert.deepEqual(m.footer.elements.map(e => e.props), [{ text: '© Example' }, { network: 'instagram', url: 'https://www.instagram.com/example' }]);
  assert.equal(m.footer.style.toTop, true);
  assert.deepEqual(migrateSite(structuredClone(DEFAULTS)).theme, THEME_DEFAULTS);
  assert.deepEqual(m.wording, WORDING_DEFAULTS);
});

test('what migration makes is always accepted unchanged, so the first save changes nothing', () => {
  for (const s of [state().settings, structuredClone(DEFAULTS)]) {
    const m = migrateSite(s);
    assert.deepEqual(cleanSite(structuredClone(m)), { site: m, errors: [] });
  }
});

test('a bad site is refused with every reason, from every part', () => {
  const m = migrateSite(state().settings);
  m.name = 'n'.repeat(200);
  m.header.elements.push({ id: 'ft-text', type: 'text', props: {}, motion: {} });
  m.footer.style.padding = 'huge';
  m.theme.page = 'pink';
  const r = cleanSite(m);
  assert.equal(r.site, null);
  assert.deepEqual(r.errors, ['Footer, padding: choose one of: Compact, Normal, Roomy', 'Footer: Text: the element id "ft-text" is used twice',
    'Theme, page: use a six-digit colour such as #1a1a1a']);
  assert.deepEqual(cleanSite([]).errors, ['The header, footer, theme and wording are missing']);
  const ok = migrateSite(state().settings); ok.name = 'n'.repeat(200);
  assert.equal(cleanSite(ok).site.name.length, SITE_LIMITS.name);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/sitewide.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `site/sitewide.mjs`.

- [ ] **Step 3: Write the module**

`site/sitewide.mjs`:

```js
/* The site-wide part of the website: its name, header, footer, theme and wording. They are saved with the pages draft
   (store.mjs, as s:site), so they share its autosave, undo, revision and publish. A site that never saved them gets
   them made from its old settings, on the fly and without writing anything, and builds exactly as before; the old
   settings are kept, so restoring an older version still works. Pure. */
import { text } from './blocks/common.mjs';
import { cleanBand, ELEMENT_TYPES, ELEMENT_MOTION_DEFAULTS, HEADER_STYLE_DEFAULTS, FOOTER_STYLE_DEFAULTS } from './bands.mjs';
import { cleanTheme, themeFromStyle } from './theme.mjs';
import { cleanWording, WORDING_DEFAULTS } from './wording.mjs';

export const SITE_LIMITS = Object.freeze({ name: 80 });

const element = (id, type, props = {}) => ({ id, type, props: { ...structuredClone(ELEMENT_TYPES.get(type).defaults), ...props },
  motion: { ...ELEMENT_MOTION_DEFAULTS }, visible: 'all' });

/* the logo (or the site name) and the menu become the header; the copyright line and Instagram link the footer;
   the Style settings the theme */
export function migrateSite(s) {
  return {
    name: s.siteName,
    header: { style: { ...HEADER_STYLE_DEFAULTS }, elements: [element('hd-logo', 'logo'), element('hd-menu', 'menu', { phone: 'row' })] },
    footer: { style: { ...FOOTER_STYLE_DEFAULTS }, elements: [
      element('ft-text', 'text', { text: s.footer.copyright }),
      element('ft-social', 'social', { network: 'instagram', url: s.footer.instagram }),
    ] },
    theme: themeFromStyle(s.style),
    wording: { ...WORDING_DEFAULTS },
  };
}

export function cleanSite(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { site: null, errors: ['The header, footer, theme and wording are missing'] };
  const ids = new Set();
  const h = cleanBand(raw.header, 'header', ids), f = cleanBand(raw.footer, 'footer', ids);
  const t = cleanTheme(raw.theme), w = cleanWording(raw.wording);
  const errors = [...h.errors, ...f.errors,
    ...Object.entries(t.errors).map(([k, e]) => `Theme, ${k}: ${e}`), ...Object.entries(w.errors).map(([k, e]) => `Wording, ${k}: ${e}`)];
  if (errors.length) return { site: null, errors };
  return { site: { name: text(raw.name, SITE_LIMITS.name), header: h.band, footer: f.band, theme: t.theme, wording: w.wording }, errors: [] };
}
```

In `deploy.sh`, replace:

```bash
site/wording.mjs site/bands.mjs
```

with:

```bash
site/wording.mjs site/bands.mjs site/sitewide.mjs
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test site/test`
Expected: PASS.

- [ ] **Step 5: Commit (commit only after the user approves)**

```bash
git add site/sitewide.mjs site/test/sitewide.test.mjs deploy.sh
git commit -m "Website: the site-wide model, made from the old settings until it is saved"
```

---

### Task 7: Band stylesheet and element entrance script

`bands.css` styles what only a saved site (or the editor) can produce: band style classes, the new elements, the element hover effects, entrance start states, and the phone menu. The phone menu is CSS only: a visually hidden checkbox (`.nav-t`, focusable, named by the wording), its label drawn as three lines (`.nav-b`), and `.nav-t:checked ~ .nav-c` showing the links under the header at phone width; it works without JavaScript and is emitted only for a menu set to "Fold into a menu button", which a migrated menu never is. `bands.js` adds `.in` to `.el.m` elements as they come into view (once), and does nothing for reduced motion or without IntersectionObserver; the slide/zoom start transforms come from the existing generic `.anim .m-*` rules in `blocks.css`.

**Files:**
- Create: `site/assets/bands.css`
- Create: `site/assets/bands.js`
- Modify: `deploy.sh` (`FILES`)
- Test: `site/test/bands-assets.test.mjs`

**Interfaces:**
- Consumes: class names from Task 5; `ENTRANCES` (blocks/common.mjs) and `ELEMENT_HOVER` (bands.mjs) in the test.
- Produces: `site/assets/bands.css`, `site/assets/bands.js` (read by `build.mjs` in Task 8).

- [ ] **Step 1: Write the failing test**

`site/test/bands-assets.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ENTRANCES } from '../blocks/common.mjs';
import { ELEMENT_HOVER } from '../bands.mjs';

const CSS = readFileSync(new URL('../assets/bands.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const BLOCKS_CSS = readFileSync(new URL('../assets/blocks.css', import.meta.url), 'utf8');
const JS = readFileSync(new URL('../assets/bands.js', import.meta.url), 'utf8');

function media(query) {
  const at = CSS.indexOf(`@media (${query})`);
  assert.ok(at >= 0, `missing @media (${query})`);
  let i = CSS.indexOf('{', at), d = 0;
  const start = i;
  for (; i < CSS.length; i++) { if (CSS[i] === '{') d++; else if (CSS[i] === '}' && --d === 0) break; }
  return { body: CSS.slice(start + 1, i), from: at, to: i + 1 };
}
const topLevel = s => { const out = []; let d = 0, cur = ''; for (const c of s) { if (c === '(') d++; if (c === ')') d--; if (c === ',' && !d) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };

test('an element’s hidden start applies only once the script has run, and never for reduced motion', () => {
  const m = media('prefers-reduced-motion: no-preference');
  const outside = CSS.slice(0, m.from) + CSS.slice(m.to);
  assert.doesNotMatch(outside, /\.anim\b/);
  assert.doesNotMatch(outside, /:not\(\.in\)/);
  assert.match(m.body, /\.anim \.el\.m:not\(\.in\) \{ opacity: 0; \}/);
  for (const e of ENTRANCES.filter(x => x !== 'none' && x !== 'fade')) assert.ok(BLOCKS_CSS.includes(`.anim .m-${e}:not(.in)`), `blocks.css moves ${e}`);
});

test('only transform and opacity are animated, and reduced motion stills the hover effects', () => {
  assert.doesNotMatch(CSS, /@keyframes|animation\s*:/);
  const decls = [...CSS.matchAll(/transition(?:-property)?\s*:\s*([^;}]+)/g)].map(m => m[1]);
  assert.ok(decls.length >= 2);
  for (const d of decls) for (const part of topLevel(d)) assert.ok(['opacity', 'transform', 'none'].includes(part.trim().split(/\s+/)[0]), d);
  const r = media('prefers-reduced-motion: reduce').body;
  assert.match(r, /transition: none !important/);
  assert.match(r, /transform: none/);
  for (const [v] of ELEMENT_HOVER.filter(o => o[0] !== 'none')) assert.ok(CSS.includes(`.eh-${v}:hover`), v);
});

test('the phone menu opens from its checkbox, on phones only', () => {
  const m = media('max-width: 760px').body;
  assert.match(m, /\.top \.nav-c \{ display: none;/);
  assert.match(m, /\.top \.nav-t:checked ~ \.nav-c \{ display: flex; \}/);
  assert.match(m, /\.nav-b \{ display: block;/);
  assert.match(CSS.slice(0, CSS.indexOf('@media')), /\.nav-b \{ display: none; \}/, 'no menu button on computers');
});

const classList = set => ({ add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c) });
function run({ reduce = false, io = true, els = [] } = {}) {
  const html = new Set(), observed = new Set();
  let cb = null;
  const ctx = { document: { documentElement: { classList: classList(html) }, querySelectorAll: sel => (sel === '.el.m' ? els : []) },
    matchMedia: q => ({ matches: reduce && q.includes('reduce') }) };
  if (io) ctx.IntersectionObserver = class { constructor(f) { cb = f; } observe(e) { observed.add(e); } unobserve(e) { observed.delete(e); } };
  ctx.window = ctx;
  vm.runInNewContext(JS, ctx);
  return { html, observed, fire: entries => cb(entries) };
}

test('elements enter once as they come into view; nothing hides without IntersectionObserver or with reduced motion', () => {
  const set = new Set(['el', 'm']), e = { set, classList: classList(set) };
  const p = run({ els: [e] });
  assert.ok(p.html.has('anim'));
  p.fire([{ target: e, isIntersecting: true }]);
  assert.ok(set.has('in'));
  assert.ok(!p.observed.has(e));
  assert.ok(!run({ reduce: true, els: [e] }).html.has('anim'));
  assert.ok(!run({ io: false, els: [e] }).html.has('anim'));
  assert.ok(!run({ els: [] }).html.has('anim'));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/bands-assets.test.mjs`
Expected: FAIL with `ENOENT` for `site/assets/bands.css`.

- [ ] **Step 3: Write the stylesheet and the script**

`site/assets/bands.css`:

```css
/* The header and footer once they have been saved from the page editor: band style, the elements, the phone menu
   button and the elements' hover and entrance effects. build.mjs adds this after site.css and blocks.css; a site that
   never saved them keeps exactly the old stylesheet. Only transform and opacity are ever animated. */

/* ---- bands ---- */
.top { position: relative; z-index: 4; }
.top.sticky { position: sticky; top: 0; }
.top.bg-own, .foot.bg-own { background: var(--band-bg); }
.top.bp-compact, .foot.bp-compact { height: 4.6rem; }
.top.bp-roomy, .foot.bp-roomy { height: 8.6rem; }
.top.ba-left, .top.ba-center, .top.ba-right { gap: 2rem; }
.top.ba-left { justify-content: flex-start; }
.top.ba-center { justify-content: center; }
.top.ba-right { justify-content: flex-end; }
.foot.ba-left, .foot.ba-center, .foot.ba-right { display: flex; flex-wrap: wrap; align-items: center; gap: 1.5rem; }
.foot.ba-left { justify-content: flex-start; }
.foot.ba-center { justify-content: center; }
.foot.ba-right { justify-content: flex-end; }
.foot > :last-child:not(:first-child) { justify-self: end; }

/* ---- elements ---- */
.el { display: flex; align-items: center; }
.el-empty { opacity: .6; font-style: italic; }
.site-name { font: 500 1.3rem var(--font-head); color: var(--ink); letter-spacing: .05rem; }
.lg-small img { width: 3.2rem; height: 3.2rem; }
.lg-large img { width: 5.6rem; height: 5.6rem; }
.foot .logo img { width: 3rem; height: 3rem; }
.foot nav { display: flex; flex-wrap: wrap; gap: 1.4rem; }
.el-link { font: 400 .94rem var(--font-head); color: var(--ink); }
.foot nav a:hover, .el-link:hover, .soc:hover { opacity: .6; }
.soc svg { width: 1.1rem; height: 1.1rem; }
.hbtn { display: inline-block; padding: .55rem 1.3rem; font: 500 .85rem var(--font-head); letter-spacing: .06rem; text-transform: uppercase; border: 1px solid var(--accent, var(--ink)); }
.hbtn-solid { background: var(--accent, var(--ink)); color: var(--page); }
.hbtn-outline { color: var(--accent, var(--ink)); }
.esp { display: block; }
.esp-small { width: 1rem; }
.esp-medium { width: 2.5rem; }
.esp-large { width: 5rem; }
.esp-fill { flex: 1; }

/* ---- the phone menu: a checkbox and its label, so it opens without JavaScript ---- */
.nav-t { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.nav-b { display: none; }

/* ---- hover effects ---- */
.eh-fade, .eh-lift, .eh-grow { transition: opacity .25s ease, transform .25s ease; }
.eh-fade:hover { opacity: .6; }
.eh-lift:hover { transform: translateY(-3px); }
.eh-grow:hover { transform: scale(1.06); }

@media (max-width: 760px) {
  .top.bp-compact, .foot.bp-compact { height: 4rem; }
  .top.bp-roomy, .foot.bp-roomy { height: 6.6rem; }
  .nav-b { display: block; position: relative; width: 2.2rem; height: 2.2rem; cursor: pointer; color: var(--ink); }
  .nav-b span, .nav-b span::before, .nav-b span::after { content: ""; position: absolute; height: 2px; background: currentColor; }
  .nav-b span { top: 50%; left: .3rem; right: .3rem; margin-top: -1px; }
  .nav-b span::before { top: -.5rem; left: 0; right: 0; }
  .nav-b span::after { top: .5rem; left: 0; right: 0; }
  .nav-t:focus-visible + .nav-b { outline: 2px solid var(--ink); outline-offset: 2px; }
  .top .nav-c { display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 6; flex-direction: column; gap: 1.1rem; padding: 1rem 1.2rem 1.4rem; background: var(--band-bg, var(--band)); }
  .top .nav-t:checked ~ .nav-c { display: flex; }
}

/* ---- entrances: hidden only once bands.js has added .anim, and only if the visitor allows motion ---- */
@media (prefers-reduced-motion: no-preference) {
  .anim .el.m { transition: opacity var(--m-dur, 700ms) ease var(--m-delay, 0ms), transform var(--m-dur, 700ms) cubic-bezier(.2, .7, .2, 1) var(--m-delay, 0ms); }
  .anim .el.m:not(.in) { opacity: 0; }
}

/* ---- less motion: hover effects stand still too ---- */
@media (prefers-reduced-motion: reduce) {
  .eh-fade, .eh-lift, .eh-grow { transition: none !important; }
  .eh-lift:hover, .eh-grow:hover { transform: none; }
}
```

`site/assets/bands.js`:

```js
// Header and footer: their elements' entrance effects, as motion.js does for blocks. They play once, as the page
// opens. Nothing is hidden until this has run (bands.css only hides under .anim), and nothing moves for visitors whose
// device asks for less motion.
(function () {
  if (!window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const entering = document.querySelectorAll('.el.m');
  if (!entering.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: [0, 0.15] });
  document.documentElement.classList.add('anim');
  entering.forEach(el => io.observe(el));
})();
```

In `deploy.sh`, replace:

```bash
site/assets/edit-bridge.js zip/writer.mjs
```

with:

```bash
site/assets/edit-bridge.js site/assets/bands.css site/assets/bands.js zip/writer.mjs
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test site/test`
Expected: PASS.

- [ ] **Step 5: Commit (commit only after the user approves)**

```bash
git add site/assets/bands.css site/assets/bands.js site/test/bands-assets.test.mjs deploy.sh
git commit -m "Website: header and footer styles, a phone menu that works without JavaScript, element entrances"
```

---

### Task 8: The builder renders the header, footer, theme and wording

`build.mjs` takes `sw = state.site ?? migrateSite(settings)`. `own = state.site != null` decides the theme source (saved theme plus the uploaded logo, or the old Style settings), whether `rootVars` writes `--accent`, and whether `bands.css`, `bands.js` and the viewer-label script are appended (always in editor mode, so a new header previews correctly before it is saved). The header and footer come from `renderHeader`/`renderFooter`; the 404 page uses the wording. Both golden tests must stay green with no change to their records.

**Files:**
- Modify: `site/build.mjs`
- Test: `site/test/build-site.test.mjs`

**Interfaces:**
- Consumes: `migrateSite` (sitewide.mjs), `renderHeader`, `renderFooter` (bands.mjs), `viewerScript` (wording.mjs), `rootVars` (theme.mjs).
- Produces: `build(state, opts)` where `state.site` may be null/undefined (made from settings) or a checked site; same return shape as before.

- [ ] **Step 1: Write the failing test**

`site/test/build-site.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../build.mjs';
import { migratePages } from '../pages.mjs';
import { migrateSite, cleanSite } from '../sitewide.mjs';
import { rootVars } from '../theme.mjs';
import { viewerScript, WORDING_DEFAULTS } from '../wording.mjs';
import { state } from './fixtures.mjs';

const asset = n => readFileSync(new URL(`../assets/${n}`, import.meta.url), 'utf8');
const pagesSaved = () => { const s = state(); s.pages = migratePages(s.settings, s.galleries); return s; };
/* a site whose header, footer, theme and wording were saved, after edit(site) */
const own = (edit = () => {}) => { const s = pagesSaved(); const m = migrateSite(s.settings); edit(m, s); const r = cleanSite(m); assert.deepEqual(r.errors, []); s.site = r.site; return s; };

test('saving the header, footer, theme and wording unchanged changes no page; only the stylesheet and script grow', () => {
  const old = build(pagesSaved()), now = build(own());
  assert.deepEqual([...now.files.keys()].sort(), [...old.files.keys()].sort());
  const st = state().settings.style;
  for (const [k, v] of old.files) {
    if (k === 'style.css') assert.equal(now.files.get(k), rootVars({ ...st, accent: st.ink }, { accent: true }) + v.slice(rootVars(st).length) + asset('bands.css'));
    else if (k === 'site.js') assert.equal(now.files.get(k), v + asset('bands.js') + viewerScript(WORDING_DEFAULTS));
    else assert.equal(now.files.get(k), v, k);
  }
  assert.deepEqual([...now.images].sort(), [...old.images].sort());
});

test('theme values reach the stylesheet, the fonts link and the photo grids', () => {
  const s = own(m => Object.assign(m.theme, { page: '#010203', accent: '#aa0000', headingFont: 'Lora', bodyFont: 'Inter', textSize: 'larger', gap: 'roomy', cardShape: 'wide', colsDesktop: 3, colsPhone: 1 }));
  const { files } = build(s);
  assert.match(files.get('style.css'), /^:root\{--page:#010203;.*--font-head:'Lora',system-ui,sans-serif;--font-body:'Inter',.*--scale:1\.12;--gap:2rem;--card-ratio:3 \/ 2;--accent:#aa0000\}\n/);
  assert.match(files.get('index.html'), /family=Lora:wght@400;500&family=Inter:wght@400;500&display=swap/);
  assert.match(files.get('Autumn-Wedding/index.html'), /data-cols="3" data-cols-phone="1"/);
});

test('the logo still comes from the logo upload, and the site name from the site', () => {
  const s = own(m => { m.name = 'New <Name>'; });
  s.settings.style = { ...s.settings.style, logo: 'logo.png' };
  const { files, images } = build(s);
  assert.match(files.get('index.html'), /<title>New &lt;Name&gt;<\/title>/);
  assert.match(files.get('index.html'), /<a class="logo" href="\/"><img src="\/logo\.png" alt="New &lt;Name&gt;" width="64" height="64"><\/a>/);
  assert.ok(images.has('logo.png'));
});

test('the wording reaches the not-found page, the footer and the photo viewer', () => {
  const s = own(m => Object.assign(m.wording, { notFoundTitle: 'Nicht gefunden', notFoundHeading: 'Hoppla <x>', backHome: 'Zur Startseite', toTop: 'Nach oben', viewerClose: 'Zu' }));
  const { files } = build(s);
  assert.match(files.get('404.html'), /<title>Nicht gefunden - Example Studio<\/title>/);
  assert.match(files.get('404.html'), /<h2>Hoppla &lt;x&gt;<\/h2><a href="\/">Zur Startseite<\/a>/);
  assert.match(files.get('index.html'), /<a class="totop" href="#" aria-label="Nach oben">/);
  assert.ok(files.get('site.js').endsWith(viewerScript({ ...WORDING_DEFAULTS, viewerClose: 'Zu' })));
});

test('a new header shows on every page; addresses resolve against the preview address', () => {
  const s = own(m => {
    m.header.elements = [{ id: 'e1', type: 'siteName' }, { id: 'e2', type: 'menu', props: { items: [{ id: 'm1', kind: 'link', label: 'Shop', url: '/shop/' }, { id: 'm2', kind: 'page', pageId: 'about' }], phone: 'button' } },
      { id: 'e3', type: 'button', props: { label: 'Book', link: { kind: 'page', pageId: 'contact' } } }];
    m.header.style.sticky = true;
  });
  const { files } = build(s, { base: '/admin/site-preview/' });
  for (const f of ['index.html', 'about/index.html', 'Autumn-Wedding/index.html', '404.html']) {
    assert.match(files.get(f), /<header class="top sticky">\n  <a class="site-name" href="\/admin\/site-preview\/">Example Studio<\/a>\n/, f);
    assert.match(files.get(f), /<nav class="nav-c"><a href="\/admin\/site-preview\/shop\/">Shop<\/a><a href="\/admin\/site-preview\/about\/">About<\/a><a href="\/admin\/site-preview\/">Home<\/a><a href="\/admin\/site-preview\/contact\/">Contact<\/a><\/nav>/, f);
    assert.match(files.get(f), /<a class="hbtn hbtn-solid" href="\/admin\/site-preview\/contact\/">Book<\/a>/, f);
  }
});

test('the editor preview marks the bands and their elements; the published site does not', () => {
  const s = own();
  const ed = build(s, { base: '/admin/site-preview/', editor: true }).files.get('index.html');
  assert.match(ed, /<header class="top" data-band="header">\n  <div class="el" data-e="hd-logo"><a class="logo"/);
  assert.match(ed, /<footer class="foot" data-band="footer">/);
  assert.match(ed, /<style>[^]*\.nav-t \{[^]*:is\(\[data-b\],\[data-e\],\[data-band\]\)\{cursor:pointer\}/);
  const pub = build(s).files.get('index.html');
  assert.doesNotMatch(pub, /data-e=|data-band=/);
});

test('an unsaved site in the editor preview gets the band styles too, so a new header looks right before it is saved', () => {
  const ed = build(pagesSaved(), { editor: true }).files.get('index.html');
  assert.match(ed, /\.nav-t \{/);
  assert.match(ed, /data-band="header"/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/build-site.test.mjs`
Expected: FAIL — the builder ignores `state.site` (for example `saving the header, footer, theme and wording unchanged…` fails on `style.css` lacking `--accent`, and the theme test finds the old colours).

- [ ] **Step 3: Change the builder**

In `site/build.mjs`, replace:

```js
   editor: true makes self-contained pages for the page editor's preview, with every block marked and selectable. */
```

with:

```js
   The header, footer, theme and wording come from state.site (site/sitewide.mjs); a site that never saved them gets
   them made from its old settings, written exactly as before (second golden test).
   editor: true makes self-contained pages for the page editor's preview, with every block, element and band marked
   and selectable. */
```

In `site/build.mjs`, replace:

```js
import { rootVars } from './theme.mjs';
```

with:

```js
import { rootVars } from './theme.mjs';
import { migrateSite } from './sitewide.mjs';
import { renderHeader, renderFooter } from './bands.mjs';
import { viewerScript } from './wording.mjs';
```

In `site/build.mjs`, replace:

```js
const BRIDGE_JS = asset('edit-bridge.js');
const EDIT_CSS = '[data-b]{cursor:pointer}[data-b]:hover{outline:2px dashed rgba(47,111,237,.55);outline-offset:-2px}'
```

with:

```js
const BRIDGE_JS = asset('edit-bridge.js');
const BANDS_CSS = asset('bands.css');
const BANDS_JS = asset('bands.js');
const EDIT_CSS = ':is([data-b],[data-e],[data-band]){cursor:pointer}:is([data-b],[data-e],[data-band]):hover{outline:2px dashed rgba(47,111,237,.55);outline-offset:-2px}'
```

In `site/build.mjs`, delete (including the blank line after it, where shown):

```js
const IG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">'
  + '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="0.6" fill="currentColor"/></svg>';
const UP = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">'
  + '<path d="M12 20V4M5 11l7-7 7 7"/></svg>';

```

In `site/build.mjs`, replace:

```js
  const s = state.settings, st = s.style;
```

with:

```js
  const s = state.settings;
  /* own: the header, footer, theme and wording were saved from the editor; until then they are made from the settings */
  const own = state.site != null;
  const sw = state.site ?? migrateSite(s);
  const st = own ? { ...sw.theme, logo: s.style.logo } : s.style;
```

In `site/build.mjs`, replace:

```js
  const name = s.siteName || 'Portfolio';
```

with:

```js
  const name = sw.name || 'Portfolio';
```

In `site/build.mjs`, replace:

```js
  const legacy = state.pages == null && !editor;
```

with:

```js
  const legacy = state.pages == null && !own && !editor;
  const bands = own || editor;
```

In `site/build.mjs`, replace:

```js
  const nav = live.filter(p => p.inMenu).map(p => `<a href="${pageHref(p, base)}">${esc(p.title)}</a>`).join('');
  const styleCss = rootVars(st) + CSS + (legacy ? '' : BLOCKS_CSS);
  const siteJs = JS + (legacy ? '' : MOTION_JS);
```

with:

```js
  const linkTo = id => { const t = live.find(x => x.id === id); return t ? pageHref(t, base) : null; };
  const bctx = { base, editor, siteName: name, logoHtml: logo, wording: sw.wording, pageHref: linkTo,
    menuPages: live.filter(p => p.inMenu).map(p => ({ id: p.id, title: p.title, href: pageHref(p, base) })),
    siteHref: u => (u.startsWith('/') ? base + u.slice(1) : u) };
  const header = renderHeader(sw.header, bctx), footer = renderFooter(sw.footer, bctx);
  const styleCss = rootVars(st, { accent: own }) + CSS + (legacy ? '' : BLOCKS_CSS) + (bands ? BANDS_CSS : '');
  const siteJs = JS + (legacy ? '' : MOTION_JS) + (bands ? BANDS_JS + viewerScript(sw.wording) : '');
```

In `site/build.mjs`, replace:

```js
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
```

with:

```js
<body>
${header}
<main>
${body}
</main>
${footer}
${jsTag}
```

In `site/build.mjs`, replace:

```js
      pageHref: id => { const t = live.find(x => x.id === id); return t ? pageHref(t, base) : null; },
```

with:

```js
      pageHref: linkTo,
```

In `site/build.mjs`, replace:

```js
  files.set('404.html', page('Not found', `<section class="contact"><h2>Page not found</h2><a href="${base}">Back to home</a></section>`, '/404'));
```

with:

```js
  const w = sw.wording;
  files.set('404.html', page(w.notFoundTitle, `<section class="contact"><h2>${esc(w.notFoundHeading)}</h2><a href="${base}">${esc(w.backHome)}</a></section>`, '/404'));
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test site/test`
Expected: PASS, including `golden.test.mjs` and `golden-saved.test.mjs` with their records unchanged (`git status --short site/test/golden` prints nothing).

- [ ] **Step 5: Commit (commit only after the user approves)**

```bash
git add site/build.mjs site/test/build-site.test.mjs
git commit -m "Website builder: header, footer, theme and wording from the site-wide settings"
```

---

### Task 9: Store: the site in the pages draft

`s:site` sits beside `s:pages` and is written with it by `setDraft`, which bumps `_pagesRev` once (see "Decision" above). `putPages(expected, pages, site)` checks both before writing anything; `site` undefined keeps the stored one. Snapshots carry `site`; restoring a snapshot without the key sets it to null (made from that version's settings). Discard checks a published site and refuses with the reason, leaving the draft alone.

**Files:**
- Modify: `site/store.mjs`
- Test: `site/test/store-site.test.mjs`

**Interfaces:**
- Consumes: `cleanSite` (sitewide.mjs).
- Produces: store methods `getSite() -> site | null`; `getState()` gains `site`; `putPages(expectedPagesRev, rawPages, rawSite?) -> { pagesRev }` (throws `StaleError`, or `InputError` with `.errors`); `discardPages(snapshotJson | null) -> { pagesRev }`; `snapshot()` JSON gains `site`; `restoreSnapshot(json)` restores `site` (missing key → null).

- [ ] **Step 1: Write the failing test**

`site/test/store-site.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStore, StaleError, InputError } from '../store.mjs';
import { migratePages, resolvePages } from '../pages.mjs';
import { migrateSite } from '../sitewide.mjs';

const fresh = () => createStore(new DatabaseSync(':memory:'), { now: () => 1000 });
const pagesOf = s => { const st = s.getState(); return resolvePages(st.pages ?? migratePages(st.settings, st.galleries), st.galleries); };
const siteOf = s => { const st = s.getState(); return st.site ?? migrateSite(st.settings); };
const named = (s, name) => ({ ...siteOf(s), name });

test('the site starts unsaved and is saved with the pages, under one revision bump', () => {
  const s = fresh();
  assert.equal(s.getSite(), null);
  assert.equal(s.getState().site, null);
  assert.deepEqual(s.putPages(0, pagesOf(s), named(s, 'Studio')), { pagesRev: 1 });
  assert.equal(s.getSite().name, 'Studio');
  assert.equal(s.rev(), 1);
  assert.throws(() => s.putPages(0, pagesOf(s), named(s, 'Late')), StaleError);
});

test('a save without the site keeps the saved one; a bad site is refused with every reason and nothing is stored', () => {
  const s = fresh();
  s.putPages(null, pagesOf(s), named(s, 'Kept'));
  s.putPages(null, pagesOf(s));
  assert.equal(s.getSite().name, 'Kept');
  const bad = named(s, 'Nope'); bad.theme.page = 'red'; bad.footer.style.padding = 'huge';
  assert.throws(() => s.putPages(null, pagesOf(s), bad), e => e instanceof InputError && e.errors.length === 2 && /Footer, padding/.test(e.message));
  assert.equal(s.getSite().name, 'Kept');
  assert.equal(s.pagesRev(), 2);
});

test('snapshots carry the site; restoring a version from before it existed goes back to the one made from the settings', () => {
  const s = fresh();
  s.putPages(null, pagesOf(s), named(s, 'Published'));
  const snap = s.snapshot();
  assert.equal(JSON.parse(snap).site.name, 'Published');
  s.putPages(null, pagesOf(s), named(s, 'Draft'));
  s.restoreSnapshot(snap);
  assert.equal(s.getSite().name, 'Published');
  const old = JSON.parse(snap); delete old.site;
  s.restoreSnapshot(JSON.stringify(old));
  assert.equal(s.getSite(), null);
  assert.ok(s.getPages(), 'the pages of that version are kept');
});

test('discard goes back to the published site, and refuses one that no longer passes the checks', () => {
  const s = fresh();
  s.putPages(null, pagesOf(s), named(s, 'Live'));
  const snap = s.snapshot();
  s.putPages(null, pagesOf(s), named(s, 'Draft'));
  s.discardPages(snap);
  assert.equal(s.getSite().name, 'Live');
  const broken = JSON.parse(snap); broken.site.header.elements.push({ id: 'hd-logo', type: 'logo' });
  s.putPages(null, pagesOf(s), named(s, 'Draft again'));
  assert.throws(() => s.discardPages(JSON.stringify(broken)), e => e instanceof InputError && /can’t be restored as they are: Header: Logo: the element id "hd-logo" is used twice/.test(e.message));
  assert.equal(s.getSite().name, 'Draft again', 'the draft is left alone');
  s.discardPages(null);
  assert.equal(s.getSite(), null, 'never published: back to the site made from the settings');
});

test('saving the site needs no new ids from the database', () => {
  const s = fresh();
  const before = ['_photoSeq', '_gallerySeq'].map(k => s.meta(k));
  s.putPages(null, pagesOf(s), named(s, 'x'));
  assert.deepEqual(['_photoSeq', '_gallerySeq'].map(k => s.meta(k)), before);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/store-site.test.mjs`
Expected: FAIL with `TypeError: s.getSite is not a function`.

- [ ] **Step 3: Change the store**

In `site/store.mjs`, replace:

```js
import { cleanPages } from './pages.mjs';
```

with:

```js
import { cleanPages } from './pages.mjs';
import { cleanSite } from './sitewide.mjs';
```

In `site/store.mjs`, replace:

```js
  /* The pages are the editor's draft: the public site only changes when they are published. They have their own
     revision so an editor's autosave is refused only when the pages changed elsewhere, not on every photo upload. */
  const pagesRev = () => Number(meta('_pagesRev') || 0);
  function getPages() { const raw = meta('s:pages'); return raw == null ? null : JSON.parse(raw); }
  function setPages(pages) { setMeta('s:pages', pages == null ? null : JSON.stringify(pages)); setMeta('_pagesRev', pagesRev() + 1); }
```

with:

```js
  /* The pages are the editor's draft: the public site only changes when they are published. They have their own
     revision so an editor's autosave is refused only when the pages changed elsewhere, not on every photo upload.
     The site's name, header, footer, theme and wording (s:site) are part of the same draft: saved, discarded,
     published and restored together with the pages, under the same revision. null means never saved. */
  const pagesRev = () => Number(meta('_pagesRev') || 0);
  function getPages() { const raw = meta('s:pages'); return raw == null ? null : JSON.parse(raw); }
  function getSite() { const raw = meta('s:site'); return raw == null ? null : JSON.parse(raw); }
  function setDraft(pages, site) {
    setMeta('s:pages', pages == null ? null : JSON.stringify(pages));
    setMeta('s:site', site == null ? null : JSON.stringify(site));
    setMeta('_pagesRev', pagesRev() + 1);
  }
  function checkSite(raw, prefix = '') {
    const r = cleanSite(raw);
    if (!r.site) { const e = new InputError(prefix + r.errors[0]); e.errors = r.errors; throw e; }
    return r.site;
  }
```

In `site/store.mjs`, replace:

```js
  const snapshot = () => JSON.stringify({ settings: getSettings(), galleries: q.galAll.all(), photos: q.phoAll.all(), pages: getPages() });
```

with:

```js
  const snapshot = () => JSON.stringify({ settings: getSettings(), galleries: q.galAll.all(), photos: q.phoAll.all(), pages: getPages(), site: getSite() });
```

In `site/store.mjs`, replace:

```js
    rev, meta, setMeta, getSettings, pagesRev, getPages,
```

with:

```js
    rev, meta, setMeta, getSettings, pagesRev, getPages, getSite,
```

In `site/store.mjs`, replace:

```js
        pages: getPages(),
      };
```

with:

```js
        pages: getPages(),
        site: getSite(),
      };
```

In `site/store.mjs`, replace:

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
```

with:

```js
    /* rawSite undefined keeps the saved header, footer, theme and wording as they are (an editor opened before they
       could be edited sends pages only) */
    putPages(expectedPagesRev, raw, rawSite) {
      if (expectedPagesRev != null && expectedPagesRev !== pagesRev()) throw new StaleError();
      const galleries = q.galAll.all().map(galDto);
      const photoIds = new Set(q.phoAll.all().map(p => p.id));
      const { pages, errors } = cleanPages(raw, { galleries, photoIds });
      if (!pages) { const e = new InputError(errors[0]); e.errors = errors; throw e; }
      const site = rawSite === undefined ? getSite() : checkSite(rawSite);
      mutate(null, () => setDraft(pages, site));
      return { pagesRev: pagesRev() };
    },
```

In `site/store.mjs`, replace:

```js
        pages = r.pages;
      }
      mutate(null, () => setPages(pages));
      return { pagesRev: pagesRev() };
    },
```

with:

```js
        pages = r.pages;
      }
      /* likewise the header, footer, theme and wording; a version without them goes back to the ones made from the settings */
      const site = snap.site == null ? null : checkSite(snap.site, 'The published header, footer, theme or wording can’t be restored as they are: ');
      mutate(null, () => setDraft(pages, site));
      return { pagesRev: pagesRev() };
    },
```

In `site/store.mjs`, replace:

```js
        /* versions published before pages existed have no "pages": they go back to pages made from their settings */
        setPages(Object.hasOwn(snap, 'pages') ? snap.pages : null);
```

with:

```js
        /* versions published before pages existed have no "pages", and before the header, footer, theme and wording
           could be edited no "site": both go back to what is made from their settings */
        setDraft(Object.hasOwn(snap, 'pages') ? snap.pages : null, Object.hasOwn(snap, 'site') ? snap.site : null);
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test site/test && grep -n "setPages" site/store.mjs`
Expected: PASS; `grep` prints nothing (every write goes through `setDraft`).

- [ ] **Step 5: Commit (commit only after the user approves)**

```bash
git add site/store.mjs site/test/store-site.test.mjs
git commit -m "Website store: header, footer, theme and wording saved, published and restored with the pages draft"
```

---

### Task 10: Admin API: the site in load, save, preview and discard; forms; logo answer

`GET /api/admin/site` returns `site` (saved or made from settings) and `siteSaved`. `GET /api/admin/site/blocks` adds the forms for elements, element motion and visibility, both band styles, theme and wording. `PUT /api/admin/site/pages` and `POST /api/admin/site/render` take `site` (both through `readBody`, so a non-object body is a 400, and `PAGES_MAX` covers pages and site together). Discard answers with `site` and `siteSaved`. The logo routes keep their PNG/SVG checks and now answer with the file they kept (`{ logo, rev }`), and the preview never caches the logo, since a new one reuses the name.

**Files:**
- Modify: `site/routes.mjs`
- Test: `site/test/sitewide-routes.test.mjs`

**Interfaces:**
- Consumes: Task 9 store methods; `migrateSite`, `cleanSite`; `listElementTypes`, `ELEMENT_MOTION_SCHEMA`, `ELEMENT_MOTION_DEFAULTS`, `ELEMENT_VISIBLE`, `HEADER_STYLE_SCHEMA`, `HEADER_STYLE_DEFAULTS`, `FOOTER_STYLE_SCHEMA`, `FOOTER_STYLE_DEFAULTS`; `THEME_SCHEMA`; `WORDING_SCHEMA`.
- Produces (JSON): `GET /site` + `{ site, siteSaved }`; `GET /blocks` + `{ elements, elementMotion, elementMotionDefaults, elementVisible, headerStyle, headerStyleDefaults, footerStyle, footerStyleDefaults, theme, wording }`; `PUT /pages` body `{ pages, site? }` → `{ pagesRev, rev }`; `POST /render` body `{ pages, slug, site? }` → `{ html, rev }`; `POST /pages/discard` → `{ pages, site, siteSaved, pagesRev, rev }`; `POST /logo` → `{ logo: 'logo.png' | 'logo.svg', rev }`; `DELETE /logo` → `{ logo: null, rev }`.

- [ ] **Step 1: Write the failing test**

`site/test/sitewide-routes.test.mjs`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSite } from '../routes.mjs';

/* the same harness as builder-routes.test.mjs, without Immich: nothing here uploads photos */
let srv, base, site, deploys = [];
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

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-w-'));
  const json = (res, code, obj, headers) => { res.writeHead(code, { 'content-type': 'application/json', ...(headers || {}) }); res.end(JSON.stringify(obj)); };
  const readJson = async (req, limit = 64 * 1024) => { let n = 0, s = ''; for await (const c of req) { n += c.length; s += c; } if (n > limit) throw new Error('body too large'); return s ? JSON.parse(s) : {}; };
  site = createSite({ db: new DatabaseSync(':memory:'), json, readJson, immich: async () => new Response('{}', { status: 503 }), canUpload: () => false,
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
});
after(() => srv.close());

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const save = (st, site, pages = st.pages) => call('PUT', '/api/admin/site/pages', { pages, site }, { 'x-pages-rev': String(st.pagesRev) });
const renamed = (st, name) => ({ ...structuredClone(st.site), name });

test('an unsaved site shows the header, footer, theme and wording made from its settings', async () => {
  const st = await getSite();
  assert.equal(st.siteSaved, false);
  assert.deepEqual(st.site.header.elements.map(e => e.type), ['logo', 'menu']);
  assert.deepEqual(st.site.footer.elements.map(e => e.type), ['text', 'social']);
  assert.equal(st.site.theme.page, st.state.settings.style.page);
  assert.equal(st.site.wording.notFoundHeading, 'Page not found');
});

test('the element types, band styles, theme and wording come with their forms', async () => {
  const r = (await call('GET', '/api/admin/site/blocks')).body;
  assert.deepEqual(r.elements.map(t => t.type), ['logo', 'siteName', 'menu', 'link', 'button', 'social', 'text', 'spacer']);
  assert.deepEqual(r.headerStyle.map(f => f.key), Object.keys(r.headerStyleDefaults));
  assert.deepEqual(r.footerStyle.map(f => f.key), Object.keys(r.footerStyleDefaults));
  assert.deepEqual(r.elementMotion.map(f => f.key), Object.keys(r.elementMotionDefaults));
  assert.equal(r.elementVisible.key, 'visible');
  assert.ok(r.theme.find(f => f.key === 'headingFont').options.length >= 10);
  assert.ok(r.wording.every(f => f.kind === 'text'));
});

test('the site is saved with the pages as a draft: the preview shows it, nothing is deployed', async () => {
  const st = await getSite(), before = deploys.length;
  const r = await save(st, renamed(st, 'Draft Studio'));
  assert.equal(r.status, 200);
  assert.equal(r.body.pagesRev, st.pagesRev + 1);
  assert.equal(typeof r.body.rev, 'number');
  const now = await getSite();
  assert.equal(now.siteSaved, true);
  assert.equal(now.site.name, 'Draft Studio');
  assert.equal(now.dirty, true);
  assert.match(await (await fetch(base + '/admin/site-preview/', { headers: H() })).text(), /<title>Draft Studio<\/title>/);
  assert.equal(deploys.length, before);
});

test('bad addresses and broken bands are refused with every reason; nothing is saved', async () => {
  const st = await getSite();
  const bad = structuredClone(st.site);
  bad.header.elements.push({ id: 'evil', type: 'menu', props: { items: [{ id: 'm1', kind: 'link', label: 'x', url: 'javascript:alert(1)' }] } });
  bad.footer.elements.push({ id: 'b1', type: 'button', props: { label: 'x', link: { kind: 'url', url: 'data:text/html,hi' } } });
  bad.theme.headingFont = 'Evil Font';
  const r = await save(st, bad);
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.errors, ['Header: Menu, items: menu links must start with https://, http://, mailto:, tel: or / for a page on this site',
    'Footer: Button, link: links must start with https://, http://, mailto: or tel:', `Theme, headingFont: choose one of: ${r.body.errors[2].split(': ').pop()}`]);
  assert.match(r.body.errors[2], /Roboto, Figtree/);
  assert.equal((await save(st, 'nope')).status, 400);
  assert.equal((await getSite()).pagesRev, st.pagesRev);
});

test('the live preview renders an unsaved site and saves nothing; the editor marks the bands', async () => {
  const st = await getSite();
  const site = renamed(st, 'Preview Only');
  site.wording.notFoundHeading = 'Lost?';
  const r = await call('POST', '/api/admin/site/render', { pages: st.pages, slug: '', site });
  assert.equal(r.status, 200);
  assert.match(r.body.html, /<title>Preview Only<\/title>/);
  assert.match(r.body.html, /data-band="header"/);
  assert.match((await call('POST', '/api/admin/site/render', { pages: st.pages, slug: 'no-such-page', site })).body.html, /<h2>Lost\?<\/h2>/);
  assert.equal((await getSite()).site.name, 'Draft Studio');
  const bad = await call('POST', '/api/admin/site/render', { pages: st.pages, slug: '', site: { ...site, theme: { ...site.theme, ink: 'nope' } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.errors[0], /Theme, ink/);
  assert.equal((await call('POST', '/api/admin/site/render', { pages: st.pages, slug: '' })).status, 200, 'an editor that sends pages only still previews');
});

test('an editor that sends pages only leaves the saved site alone', async () => {
  const st = await getSite();
  assert.equal((await putPages(st.pages, st.pagesRev)).status, 200);
  assert.equal((await getSite()).site.name, 'Draft Studio');
});

test('publish carries the site; discard goes back to it', async () => {
  assert.equal((await call('POST', '/api/admin/site/publish')).status, 200);
  const st = await getSite();
  await save(st, renamed(st, 'Changed my mind'));
  const d = await call('POST', '/api/admin/site/pages/discard');
  assert.equal(d.status, 200);
  assert.equal(d.body.site.name, 'Draft Studio');
  assert.equal(d.body.siteSaved, true);
  assert.equal((await getSite()).pagesRev, d.body.pagesRev);
});

test('restoring a version from before the site could be edited brings back the one made from its settings', async () => {
  const old = JSON.parse(site.store.snapshot());
  delete old.site;
  const id = site.store.recordPublish({ status: 'ok', deploymentId: 'dep-old', rev: site.store.rev(), snapshot: JSON.stringify(old) });
  assert.equal((await call('POST', '/api/admin/site/restore', { id })).status, 200);
  const st = await getSite();
  assert.equal(st.siteSaved, false);
  assert.equal(st.site.name, st.state.settings.siteName);
});

test('the logo upload still works and says which file it kept; the header shows it', async () => {
  const up = await fetch(base + '/api/admin/site/logo?name=a.png', { method: 'POST', headers: H(), body: PNG });
  assert.equal(up.status, 200);
  const j = await up.json();
  assert.equal(j.logo, 'logo.png');
  assert.equal(typeof j.rev, 'number');
  const st = await getSite();
  assert.equal(st.state.settings.style.logo, 'logo.png');
  assert.match(await (await fetch(base + '/admin/site-preview/', { headers: H() })).text(), /<a class="logo" href="\/admin\/site-preview\/"><img src="\/admin\/site-preview\/logo\.png"/);
  assert.equal((await fetch(base + '/admin/site-preview/logo.png', { headers: H() })).headers.get('cache-control'), 'no-store', 'a replaced logo shows at once');
  const del = await (await fetch(base + '/api/admin/site/logo', { method: 'DELETE', headers: H() })).json();
  assert.equal(del.logo, null);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/sitewide-routes.test.mjs`
Expected: FAIL — `st.site` is undefined (`TypeError: Cannot read properties of undefined (reading 'header')`) and the other tests fail on the missing fields.

- [ ] **Step 3: Change the routes**

In `site/routes.mjs`, replace:

```js
import { listBlockTypes, STYLE_SCHEMA, MOTION_SCHEMA, STYLE_DEFAULTS, MOTION_DEFAULTS } from './blocks/registry.mjs';
```

with:

```js
import { listBlockTypes, STYLE_SCHEMA, MOTION_SCHEMA, STYLE_DEFAULTS, MOTION_DEFAULTS } from './blocks/registry.mjs';
import { migrateSite, cleanSite } from './sitewide.mjs';
import { listElementTypes, ELEMENT_MOTION_SCHEMA, ELEMENT_MOTION_DEFAULTS, ELEMENT_VISIBLE,
  HEADER_STYLE_SCHEMA, HEADER_STYLE_DEFAULTS, FOOTER_STYLE_SCHEMA, FOOTER_STYLE_DEFAULTS } from './bands.mjs';
import { THEME_SCHEMA } from './theme.mjs';
import { WORDING_SCHEMA } from './wording.mjs';
```

In `site/routes.mjs`, replace:

```js
const PAGES_MAX = 2 * 1024 * 1024;     /* a whole site's pages in one save; larger is refused before parsing finishes */
```

with:

```js
const PAGES_MAX = 2 * 1024 * 1024;     /* a whole site's pages, header, footer, theme and wording in one save; larger is refused */
```

In `site/routes.mjs`, replace:

```js
  const pagesOf = st => resolvePages(st.pages ?? migratePages(st.settings, st.galleries), st.galleries);
```

with:

```js
  const pagesOf = st => resolvePages(st.pages ?? migratePages(st.settings, st.galleries), st.galleries);
  const siteOf = st => st.site ?? migrateSite(st.settings);
```

In `site/routes.mjs`, replace:

```js
  /* the editor's live preview: the real build of pages that are not saved yet, as one self-contained page */
  function renderDraft(raw, slug) {
    const st = store.getState();
    const { pages, errors } = cleanPages(raw, { galleries: st.galleries, photoIds: photoIdsOf(st) });
    if (!pages) { const e = new InputError(errors[0]); e.errors = errors; throw e; }
    const { files } = build({ ...st, pages }, { base: '/admin/site-preview/', siteUrl: cfg.siteUrl, editor: true });
```

with:

```js
  /* the editor's live preview: the real build of pages, header, footer, theme and wording that are not saved yet, as
     one self-contained page. rawSite undefined previews the saved (or made-from-settings) ones. */
  function renderDraft(raw, slug, rawSite) {
    const st = store.getState();
    const { pages, errors } = cleanPages(raw, { galleries: st.galleries, photoIds: photoIdsOf(st) });
    if (!pages) { const e = new InputError(errors[0]); e.errors = errors; throw e; }
    let site = st.site;
    if (rawSite !== undefined) {
      const r = cleanSite(rawSite);
      if (!r.site) { const e = new InputError(r.errors[0]); e.errors = r.errors; throw e; }
      site = r.site;
    }
    const { files } = build({ ...st, pages, site }, { base: '/admin/site-preview/', siteUrl: cfg.siteUrl, editor: true });
```

In `site/routes.mjs`, replace:

```js
    store.discardPages(live ? store.getPublish(live.id).snapshot : null);
    return { pages: pagesOf(store.getState()), pagesRev: store.pagesRev() };
```

with:

```js
    store.discardPages(live ? store.getPublish(live.id).snapshot : null);
    const st = store.getState();
    return { pages: pagesOf(st), site: siteOf(st), siteSaved: st.site != null, pagesRev: store.pagesRev() };
```

In `site/routes.mjs`, replace:

```js
        pages: pagesOf(st), pagesRev: store.pagesRev(), pagesSaved: st.pages != null,
      });
```

with:

```js
        pages: pagesOf(st), pagesRev: store.pagesRev(), pagesSaved: st.pages != null,
        site: siteOf(st), siteSaved: st.site != null,
      });
```

In `site/routes.mjs`, replace:

```js
      return json(res, 200, { types: listBlockTypes(), style: STYLE_SCHEMA, motion: MOTION_SCHEMA,
                              styleDefaults: STYLE_DEFAULTS, motionDefaults: MOTION_DEFAULTS });
```

with:

```js
      return json(res, 200, { types: listBlockTypes(), style: STYLE_SCHEMA, motion: MOTION_SCHEMA,
                              styleDefaults: STYLE_DEFAULTS, motionDefaults: MOTION_DEFAULTS,
                              elements: listElementTypes(), elementMotion: ELEMENT_MOTION_SCHEMA, elementMotionDefaults: ELEMENT_MOTION_DEFAULTS,
                              elementVisible: ELEMENT_VISIBLE, headerStyle: HEADER_STYLE_SCHEMA, headerStyleDefaults: HEADER_STYLE_DEFAULTS,
                              footerStyle: FOOTER_STYLE_SCHEMA, footerStyleDefaults: FOOTER_STYLE_DEFAULTS, theme: THEME_SCHEMA, wording: WORDING_SCHEMA });
```

In `site/routes.mjs`, replace:

```js
      return respond(res, () => store.putPages(pagesRevOf(req), b.pages));
```

with:

```js
      return respond(res, () => store.putPages(pagesRevOf(req), b.pages, b.site));
```

In `site/routes.mjs`, replace:

```js
      return respond(res, () => renderDraft(b.pages, String(b.slug ?? '')));
```

with:

```js
      return respond(res, () => renderDraft(b.pages, String(b.slug ?? ''), b.site));
```

In `site/routes.mjs`, replace:

```js
      return respond(res, () => { store.patchSettings(null, { style: { logo: file } }); });
    }
    if (path === '/api/admin/site/logo' && m === 'DELETE') return respond(res, () => { store.patchSettings(null, { style: { logo: null } }); });
```

with:

```js
      return respond(res, () => { store.patchSettings(null, { style: { logo: file } }); return { logo: file }; });
    }
    if (path === '/api/admin/site/logo' && m === 'DELETE') return respond(res, () => { store.patchSettings(null, { style: { logo: null } }); return { logo: null }; });
```

In `site/routes.mjs`, replace:

```js
    if (images.has(rel)) return serveFile(res, images.get(rel), 'private, max-age=300');
```

with:

```js
    /* a new logo keeps the same name, so the preview must not keep showing the old one */
    if (images.has(rel)) return serveFile(res, images.get(rel), LOGO_NAME.test(rel) ? 'no-store' : 'private, max-age=300');
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test site/test`
Expected: PASS, including the existing `builder-routes.test.mjs` (an editor that sends pages only keeps working) and `routes.test.mjs` (logo checks unchanged).

- [ ] **Step 5: Commit (commit only after the user approves)**

```bash
git add site/routes.mjs site/test/sitewide-routes.test.mjs
git commit -m "Website API: header, footer, theme and wording in load, save, preview and discard"
```

---

### Task 11: Preview bridge: select bands and elements

A click in the editor preview now reports the nearest block, element or band, plus the band it is in, so the editor can open the Header or Footer panel. The editor highlights by kind (`b` block, `e` element, `band`), because element and block ids are made separately and could coincide. Messages are still only taken from the parent on the same origin.

**Files:**
- Modify: `site/assets/edit-bridge.js` (whole file)
- Test: `site/test/edit-bridge.test.mjs`

**Interfaces:**
- Consumes: `data-b`, `data-e`, `data-band` attributes (Task 5, Task 8).
- Produces: messages to the editor `{ type: 'wb-select', id: string | null, band: 'header' | 'footer' | null }`; accepts `{ type: 'wb-select', id, kind?: 'b' | 'e' | 'band', scroll? }` (no kind = block, as before) and `{ type: 'wb-scroll', y }`.

- [ ] **Step 1: Write the failing test**

`site/test/edit-bridge.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const BRIDGE = readFileSync(new URL('../assets/edit-bridge.js', import.meta.url), 'utf8');

/* a pretend preview: a header holding one element, a block, and the page around them */
function page() {
  const sent = [], on = {}, marked = new Set();
  const node = (data, parent = null) => ({
    dataset: data, parent, classList: { add: c => marked.add(`${JSON.stringify(data)}:${c}`), remove: c => marked.delete(`${JSON.stringify(data)}:${c}`) },
    scrollIntoView() {},
    closest(sel) {
      for (let n = this; n; n = n.parent) {
        const keys = Object.keys(n.dataset);
        if (sel.split(',').some(s => keys.includes({ '[data-b]': 'b', '[data-e]': 'e', '[data-band]': 'band' }[s]))) return n;
      }
      return null;
    },
  });
  const header = node({ band: 'header' }), logo = node({ e: 'hd-logo' }, header), inLogo = node({}, logo), block = node({ b: 'home-cards' }), body = node({});
  const all = { 'data-band="header"': header, 'data-e="hd-logo"': logo, 'data-b="home-cards"': block };
  const win = {
    self: { origin: 'https://admin.example' }, scrollY: 0,
    addEventListener: (t, f) => { on[t] = f; },
    CSS: { escape: s => s }, setTimeout, clearTimeout, scrollTo() {},
    document: { querySelector: sel => all[sel.slice(1, -1)] || null },
  };
  win.parent = { postMessage: (m, o) => sent.push([m, o]) };
  win.window = win;
  vm.runInNewContext(BRIDGE, win);
  const click = target => on.click({ target, preventDefault() {}, stopPropagation() {} });
  const message = data => on.message({ origin: 'https://admin.example', source: win.parent, data });
  return { sent, click, message, marked, inLogo, header, block, body };
}

test('a click on a header element, the header, a block or nothing tells the editor which, and follows no link', () => {
  const p = page();
  p.click(p.inLogo); p.click(p.header); p.click(p.block); p.click(p.body);
  assert.deepEqual(p.sent.map(([m]) => JSON.parse(JSON.stringify(m))), [
    { type: 'wb-select', id: 'hd-logo', band: 'header' }, { type: 'wb-select', id: null, band: 'header' },
    { type: 'wb-select', id: 'home-cards', band: null }, { type: 'wb-select', id: null, band: null }]);
  assert.ok(p.sent.every(([, o]) => o === 'https://admin.example'));
});

test('the editor highlights a block, an element or a band by its kind', () => {
  const p = page();
  p.message({ type: 'wb-select', id: 'hd-logo', kind: 'e' });
  assert.deepEqual([...p.marked], ['{"e":"hd-logo"}:wb-sel']);
  p.message({ type: 'wb-select', id: 'header', kind: 'band' });
  assert.deepEqual([...p.marked], ['{"band":"header"}:wb-sel']);
  p.message({ type: 'wb-select', id: 'home-cards' });
  assert.deepEqual([...p.marked], ['{"b":"home-cards"}:wb-sel'], 'no kind is a block, as before');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/edit-bridge.test.mjs`
Expected: FAIL — the posted messages have no `band`, and highlighting an element or band marks nothing.

- [ ] **Step 3: Replace the bridge**

`site/assets/edit-bridge.js`:

```js
// Only in the page editor's preview (inlined by build.mjs in editor mode, never published): clicking a block, a header
// or footer element, or the header or footer itself selects it in the editor instead of following links or opening the
// photo viewer, and the editor can highlight one and keep the scroll position across redraws. The preview is an iframe
// srcdoc, whose origin is the editor's own (self.origin).
(function () {
  if (window.parent === window) return;
  const ORIGIN = self.origin;
  const post = m => parent.postMessage(m, ORIGIN);
  const KINDS = { b: 'data-b', e: 'data-e', band: 'data-band' };
  let current = null;
  function mark(id, kind, scroll) {
    if (current) current.classList.remove('wb-sel');
    const attr = KINDS[kind] || KINDS.b;
    current = id ? document.querySelector(`[${attr}="${CSS.escape(id)}"]`) : null;
    if (current) { current.classList.add('wb-sel'); if (scroll) current.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  addEventListener('click', ev => {
    ev.preventDefault(); ev.stopPropagation();
    const t = ev.target.closest('[data-b],[data-e],[data-band]');
    const band = t ? t.closest('[data-band]') : null;
    post({ type: 'wb-select', id: t ? t.dataset.b || t.dataset.e || null : null, band: band ? band.dataset.band : null });
  }, true);
  addEventListener('message', ev => {
    if (ev.origin !== ORIGIN || ev.source !== window.parent) return;
    const m = ev.data || {};
    if (m.type === 'wb-select') mark(m.id, m.kind, !!m.scroll);
    if (m.type === 'wb-scroll') scrollTo(0, Number(m.y) || 0);
  });
  let t = 0;
  addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => post({ type: 'wb-scrolled', y: scrollY }), 120); }, { passive: true });
})();
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test site/test`
Expected: PASS, including `builder-ui.test.mjs` (`preview messages are only taken from the preview frame, on this origin`).

- [ ] **Step 5: Commit (commit only after the user approves)**

```bash
git add site/assets/edit-bridge.js site/test/edit-bridge.test.mjs
git commit -m "Website editor preview: clicking the header, the footer or one of their elements selects it"
```

---

### Task 12: Page editor core: one draft with the site, areas and selection

> UI task: covered by source-level tests here; exercised in a real browser only in Task 16.

The editor's draft becomes `{ pages, sw }`: loaded from `GET /site`, sent whole on every autosave (`{ pages, site }`, same `x-pages-rev`, same 409/413/stale handling, same single save path) and to every live preview, snapshotted together for undo/redo, and replaced together by Discard and "Load the latest". `B.area` (`"page"`, `"header"`, `"footer"`, `"theme"`, `"wording"`) says what the outline and right panel show; `selectArea(area, id)` switches to it, and a click on the header or footer in the preview calls it. `buildForm` takes a setter instead of a block id, plus an optional `extra` control for kinds the editor does not know (the menu editor), and the editor exposes a small kit for `sitewide-admin.js` (Task 13). Everything that calls into `window.SiteWide` checks it exists, so the page editor keeps working if that script fails to load. With the Wording panel open, the preview renders the not-found page (slug `-`, which no page can have).

**Files:**
- Modify: `web/builder-admin.js`
- Modify: `site/test/builder-ui.test.mjs` (the Publish/Discard test's wording)
- Test: `site/test/builder-draft.test.mjs`

**Interfaces:**
- Consumes: `GET /site` → `site`; `PUT /site/pages` `{ pages, site }`; `POST /site/render` `{ pages, slug, site }`; `POST /site/pages/discard` → `site`; bridge messages from Task 11; `window.SiteWide = { rail(host), outline(host), panel(), has(id) }` (Task 13; optional).
- Produces: `window.SiteBuilder.kit = { B, commit(fn, mergeKey?), buildForm(fields, values, onSet(key, value, merge), extra?(field, value, set) -> Element | null), el(html), sortable(container, itemSel, onDone(ids)), rid(prefix), clone(o), selectArea(area, id | null), paintPanel(), paintPub(), render(ms), LBL }`; `B.sw` (the site-wide draft) and `B.area`.

- [ ] **Step 1: Write the failing test**

`site/test/builder-draft.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/builder-draft.test.mjs`
Expected: FAIL on every test (no `site: B.sw`, no `selectArea`, no kit).

- [ ] **Step 3: Change the editor**

In `web/builder-admin.js`, replace:

```js
   Uses the panel's globals through window.AdminKit, photo uploads through window.WebsiteKit (site-admin.js), and the
   preview, device and footer styles the Design editor (design-admin.js) adds, which admin.html loads first. */
```

with:

```js
   The site's header, footer, theme and wording are edited here too, by sitewide-admin.js (loaded after this file)
   through window.SiteBuilder.kit: they are part of the same draft (B.sw), so they share its preview, autosave, undo,
   redo, Discard and Publish. B.area says what the side panels show: "page", "header", "footer", "theme" or "wording".
   Uses the panel's globals through window.AdminKit, photo uploads through window.WebsiteKit (site-admin.js), and the
   preview, device and footer styles the Design editor (design-admin.js) adds, which admin.html loads first. */
```

In `web/builder-admin.js`, replace:

```js
var B = { open: false, info: null, site: null, pages: [], pagesRev: 0, rev: 0, pageId: "home", sel: null, tab: "content",
```

with:

```js
var B = { open: false, info: null, site: null, pages: [], sw: null, area: "page", pagesRev: 0, rev: 0, pageId: "home", sel: null, tab: "content",
```

In `web/builder-admin.js`, replace:

```js
function clone(o){ return JSON.parse(JSON.stringify(o)); }
```

with:

```js
function clone(o){ return JSON.parse(JSON.stringify(o)); }
/* the whole draft, for undo and redo: the pages and the site-wide part */
function snap(){ return { pages: clone(B.pages), sw: clone(B.sw) }; }
function unsnap(x){ B.pages = x.pages; B.sw = x.sw; }
function isBand(){ return B.area === "header" || B.area === "footer"; }
/* the selection still exists: a block of the open page, or an element of the open band */
function selected(){ return B.area === "page" ? !!find(B.sel) : isBand() && !!window.SiteWide && SiteWide.has(B.sel); }
```

In `web/builder-admin.js`, replace:

```js
  B.open = true; B.undo = []; B.redo = []; B.sel = null; B.tab = "content"; B.stale = false; B.errors = []; B.scrollY = 0;
```

with:

```js
  B.open = true; B.undo = []; B.redo = []; B.sel = null; B.area = "page"; B.tab = "content"; B.stale = false; B.errors = []; B.scrollY = 0;
```

In `web/builder-admin.js`, replace:

```js
  B.site = body.state; B.pages = clone(body.pages); B.pagesRev = body.pagesRev; B.rev = body.rev; B.dirty = body.dirty;
```

with:

```js
  B.site = body.state; B.pages = clone(body.pages); B.sw = clone(body.site); B.pagesRev = body.pagesRev; B.rev = body.rev; B.dirty = body.dirty;
```

In `web/builder-admin.js`, replace:

```js
    +   '<div id="wbOutline"></div></nav>'
```

with:

```js
    +   '<div id="wbSiteRail"></div><div id="wbOutline"></div></nav>'
```

In `web/builder-admin.js`, replace:

```js
  B.frame.addEventListener("load", function(){ fit(); send({ type: "wb-scroll", y: B.scrollY }); send({ type: "wb-select", id: B.sel }); });
```

with:

```js
  B.frame.addEventListener("load", function(){ fit(); send({ type: "wb-scroll", y: B.scrollY }); remark(false); });
```

In `web/builder-admin.js`, replace:

```js
function paintAll(){ paintPages(); paintOutline();
```

with:

```js
function paintSiteRail(){ var host = $("wbSiteRail"); if (host && window.SiteWide) SiteWide.rail(host); }
function paintAll(){ paintPages(); paintSiteRail(); paintOutline();
```

In `web/builder-admin.js`, replace:

```js
  if (m.type === "wb-select") select(m.id || null, false);
```

with:

```js
  if (m.type === "wb-select"){ if (m.band) selectArea(m.band, m.id || null); else select(m.id || null, false); }
```

In `web/builder-admin.js`, replace:

```js
/* the real build of the pages on screen, saved or not, as one self-contained page (see site/routes.mjs renderDraft) */
function render(ms){
  clearTimeout(B.renderT);
  B.renderT = setTimeout(function(){
    var mine = ++B.seq, p = page();
    api("/site/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages: B.pages, slug: p.slug }) }).then(function(r){
```

with:

```js
/* the real build of the pages and site on screen, saved or not, as one self-contained page (see site/routes.mjs renderDraft) */
function render(ms){
  clearTimeout(B.renderT);
  B.renderT = setTimeout(function(){
    /* with the Wording panel open, the preview shows the not-found page, which most of the wording is on: "-" can never be a page's address */
    var mine = ++B.seq, p = page(), slug = B.area === "wording" ? "-" : p.slug;
    api("/site/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages: B.pages, slug: slug, site: B.sw }) }).then(function(r){
```

In `web/builder-admin.js`, replace:

```js
function select(id, scroll){
  B.sel = id && find(id) ? id : null; B.tab = "content";
  paintOutline(); paintPanel(); send({ type: "wb-select", id: B.sel, scroll: !!scroll });
}
```

with:

```js
function select(id, scroll){
  var was = B.area; B.area = "page";
  B.sel = id && find(id) ? id : null; B.tab = "content";
  if (was !== "page"){ paintPages(); paintSiteRail(); }
  paintOutline(); paintPanel(); remark(scroll);
  if (was === "wording") render(0);
}
/* the header or footer (and one of its elements), the theme or the wording */
function selectArea(area, id){
  var was = B.area;
  B.area = area; B.tab = "content"; B.sel = id || null;
  if (B.sel && !selected()) B.sel = null;
  paintPages(); paintSiteRail(); paintOutline(); paintPanel(); remark(false);
  if ((was === "wording") !== (area === "wording")) render(0);
}
/* tell the preview what is selected: a block, an element, or a band */
function remark(scroll){
  if (B.area === "page") return send({ type: "wb-select", id: B.sel, kind: "b", scroll: !!scroll });
  if (!isBand()) return send({ type: "wb-select", id: null });
  send({ type: "wb-select", id: B.sel || B.area, kind: B.sel ? "e" : "band", scroll: !!scroll });
}
```

In `web/builder-admin.js`, replace:

```js
  if (!(key && B.lastKey === key && now - B.lastAt < 800)){ B.undo.push(clone(B.pages)); if (B.undo.length > 100) B.undo.shift(); }
```

with:

```js
  if (!(key && B.lastKey === key && now - B.lastAt < 800)){ B.undo.push(snap()); if (B.undo.length > 100) B.undo.shift(); }
```

In `web/builder-admin.js`, replace:

```js
function undo(){ if (!B.undo.length) return; B.redo.push(clone(B.pages)); B.pages = B.undo.pop(); B.lastKey = null; afterHistory(); }
function redo(){ if (!B.redo.length) return; B.undo.push(clone(B.pages)); B.pages = B.redo.pop(); B.lastKey = null; afterHistory(); }
function afterHistory(){
  if (!B.pages.some(function(p){ return p.id === B.pageId; })) B.pageId = B.pages[0].id;
  if (B.sel && !find(B.sel)) B.sel = null;
```

with:

```js
function undo(){ if (!B.undo.length) return; B.redo.push(snap()); unsnap(B.undo.pop()); B.lastKey = null; afterHistory(); }
function redo(){ if (!B.redo.length) return; B.undo.push(snap()); unsnap(B.redo.pop()); B.lastKey = null; afterHistory(); }
function afterHistory(){
  if (!B.pages.some(function(p){ return p.id === B.pageId; })) B.pageId = B.pages[0].id;
  if (B.sel && !selected()) B.sel = null;
```

In `web/builder-admin.js`, replace:

```js
  var body = JSON.stringify({ pages: B.pages });
```

with:

```js
  var body = JSON.stringify({ pages: B.pages, site: B.sw });
```

In `web/builder-admin.js`, replace:

```js
    if (!B.pages.some(function(p){ return p.id === B.pageId; })) B.pageId = B.pages[0].id;
    if (B.sel && !find(B.sel)) B.sel = null;
    paintAll(); render(0); setStatus("Saved");
  }); };
```

with:

```js
    if (!B.pages.some(function(p){ return p.id === B.pageId; })) B.pageId = B.pages[0].id;
    if (B.sel && !selected()) B.sel = null;
    paintAll(); render(0); setStatus("Saved");
  }); };
```

In `web/builder-admin.js`, replace:

```js
  if (!confirm("Throw away your unpublished page changes?\n\nThe pages go back to what the public site shows now. Galleries and photos are not affected.")) return;
```

with:

```js
  if (!confirm("Throw away your unpublished changes?\n\nThe pages, header, footer, theme and wording go back to what the public site shows now. Galleries, photos and the logo are not affected.")) return;
```

In `web/builder-admin.js`, replace:

```js
    B.pages = clone(r.body.pages); B.pagesRev = r.body.pagesRev; if (r.body.rev) B.rev = r.body.rev; B.undo = []; B.redo = []; B.stale = false; B.errors = [];
    if (!B.pages.some(function(p){ return p.id === B.pageId; })) B.pageId = B.pages[0].id;
    if (B.sel && !find(B.sel)) B.sel = null;
    paintAll(); render(0); setStatus("Saved"); toast("Back to the published pages.");
```

with:

```js
    B.pages = clone(r.body.pages); B.sw = clone(r.body.site); B.pagesRev = r.body.pagesRev; if (r.body.rev) B.rev = r.body.rev; B.undo = []; B.redo = []; B.stale = false; B.errors = [];
    if (!B.pages.some(function(p){ return p.id === B.pageId; })) B.pageId = B.pages[0].id;
    if (B.sel && !selected()) B.sel = null;
    paintAll(); render(0); setStatus("Saved"); toast("Back to the published version.");
```

In `web/builder-admin.js`, replace:

```js
  box.innerHTML = '<p>' + (wait ? "Your changes are a draft. The public site shows the published pages until you publish." : "Published. The public site shows exactly these pages.") + '</p>'
```

with:

```js
  box.innerHTML = '<p>' + (wait ? "Your changes are a draft. The public site shows the published version until you publish." : "Published. The public site shows exactly this.") + '</p>'
```

In `web/builder-admin.js`, replace:

```js
    return '<div class="wbpg' + (p.id === B.pageId ? " on" : "") + '" role="listitem" data-id="' + esc(p.id) + '"><span class="hd" title="Drag to reorder">☰</span>'
```

with:

```js
    return '<div class="wbpg' + (B.area === "page" && p.id === B.pageId ? " on" : "") + '" role="listitem" data-id="' + esc(p.id) + '"><span class="hd" title="Drag to reorder">☰</span>'
```

In `web/builder-admin.js`, replace:

```js
    el.onclick = function(){ B.pageId = el.dataset.id; B.sel = null; B.scrollY = 0; paintPages(); paintOutline(); paintPanel(); render(0); };
```

with:

```js
    el.onclick = function(){ B.pageId = el.dataset.id; B.area = "page"; B.sel = null; B.scrollY = 0; paintPages(); paintSiteRail(); paintOutline(); paintPanel(); render(0); };
```

In `web/builder-admin.js`, replace:

```js
  B.pageId = p.id; B.sel = null; paintAll(); render(0);
}
function duplicatePage(p){
```

with:

```js
  B.pageId = p.id; B.area = "page"; B.sel = null; paintAll(); render(0);
}
function duplicatePage(p){
```

In `web/builder-admin.js`, replace:

```js
  B.pageId = c.id; B.sel = null; paintAll(); render(0);
```

with:

```js
  B.pageId = c.id; B.area = "page"; B.sel = null; paintAll(); render(0);
```

In `web/builder-admin.js`, replace:

```js
function paintPanel(){
  if (!$("wbBody")) return;
```

with:

```js
function paintPanel(){
  if (!$("wbBody")) return;
  if (B.area !== "page" && window.SiteWide) return SiteWide.panel();
```

In `web/builder-admin.js`, replace:

```js
function paintOutline(){
  var host = $("wbOutline"); if (!host) return;
```

with:

```js
function paintOutline(){
  var host = $("wbOutline"); if (!host) return;
  if (B.area !== "page"){ if (window.SiteWide) SiteWide.outline(host); else host.innerHTML = ""; return; }
```

In `web/builder-admin.js`, replace:

```js
  if (B.tab === "content") host.appendChild(buildForm(t.fields, b.props, b.id, "props"));
  if (B.tab === "style") host.appendChild(buildForm(B.info.style, b.style, b.id, "style"));
  if (B.tab === "motion") host.appendChild(buildForm(B.info.motion, b.motion, b.id, "motion"));
```

with:

```js
  if (B.tab === "content") host.appendChild(buildForm(t.fields, b.props, blockSetter(b.id, "props")));
  if (B.tab === "style") host.appendChild(buildForm(B.info.style, b.style, blockSetter(b.id, "style")));
  if (B.tab === "motion") host.appendChild(buildForm(B.info.motion, b.motion, blockSetter(b.id, "motion")));
```

In `web/builder-admin.js`, replace:

```js
function buildForm(fields, values, blockId, part){
  var box = document.createElement("div");
  (fields || []).forEach(function(f){
    values = values || {};
    if (!shown(f, values)) return;
    var c = control(f, values[f.key], function(v, merge, redraw){ setProp(blockId, part, f.key, v, merge); if (redraw) paintPanel(); });
```

with:

```js
function blockSetter(blockId, part){ return function(key, v, merge){ setProp(blockId, part, key, v, merge); }; }
/* a form for fields the server describes; onSet(key, value, merge) changes the draft. extra(f, value, set) may supply
   a control for a kind this file does not know (sitewide-admin.js's menu editor) */
function buildForm(fields, values, onSet, extra){
  var box = document.createElement("div");
  (fields || []).forEach(function(f){
    values = values || {};
    if (!shown(f, values)) return;
    var set = function(v, merge, redraw){ onSet(f.key, v, merge); if (redraw) paintPanel(); };
    var c = (extra && extra(f, values[f.key], set)) || control(f, values[f.key], set);
```

In `web/builder-admin.js`, replace:

```js
window.SiteBuilder = { open: open, close: close, isOpen: isOpen };
window.SiteBuilder.leave = tryLeave;
```

with:

```js
window.SiteBuilder = { open: open, close: close, isOpen: isOpen };
window.SiteBuilder.leave = tryLeave;
/* what sitewide-admin.js builds on */
window.SiteBuilder.kit = { B: B, commit: commit, buildForm: buildForm, el: el, sortable: sortable, rid: rid, clone: clone,
  selectArea: selectArea, paintPanel: paintPanel, paintPub: paintPub, render: render, LBL: LBL };
```

In `site/test/builder-ui.test.mjs`, replace:

```js
test('Publish waits for the last save; Discard only touches the pages', () => {
```

with:

```js
test('Publish waits for the last save; Discard only touches the draft', () => {
```

In `site/test/builder-ui.test.mjs`, replace:

```js
  assert.match(builder, /Your changes are a draft\. The public site shows the published pages until you publish\./);
```

with:

```js
  assert.match(builder, /Your changes are a draft\. The public site shows the published version until you publish\./);
```

- [ ] **Step 4: Check the script and run the tests**

Run: `node --check web/builder-admin.js && node --test site/test`
Expected: no output from `node --check`; PASS, including every test in `builder-ui.test.mjs`.

- [ ] **Step 5: Check nothing else called the old `buildForm` signature**

Run: `grep -n "buildForm(" web/*.js`
Expected: only the definition and the three `blockSetter(...)` calls in `web/builder-admin.js` (Task 13 adds the callers in `web/sitewide-admin.js`).

- [ ] **Step 6: Commit (commit only after the user approves)**

```bash
git add web/builder-admin.js site/test/builder-draft.test.mjs site/test/builder-ui.test.mjs
git commit -m "Website editor: one draft for the pages and the site-wide settings, with header and footer selection"
```

---

### Task 13: Site-wide panels: header, footer, elements, menu, theme, wording

> UI task: covered by source-level tests here; exercised in a real browser only in Task 16.

`web/sitewide-admin.js` adds, through the kit: a "Whole site" group in the rail (Header, Footer, Theme, Wording; keyboard-reachable); for the header or footer, an outline of its elements (drag to reorder, duplicate, hide/show remembering the earlier visibility, delete, "+ Element" picker; hidden ones stay listed, marked "(hidden)" and selectable); a band panel (site name for the header, band style form); an element panel (Content: the element's form plus "Show on"; Motion: entrance, duration, delay, hover); the menu editor (Automatic, or the owner's list of pages and links with drag, remove, "+ Page…", "+ Link"); a Theme panel (grouped form, plus the logo upload/remove using the existing routes and checks, adopting the returned `rev`); and a Wording panel (grouped form; the preview shows the not-found page). Every change goes through `commit`, so it previews, autosaves, undoes and publishes with the pages; nothing here saves on its own except the logo, which is a file.

**Files:**
- Create: `web/sitewide-admin.js`
- Modify: `web/admin.html` (load it after `builder-admin.js`)
- Modify: `deploy.sh` (`FILES`)
- Test: `site/test/sitewide-ui.test.mjs`

**Interfaces:**
- Consumes: `window.SiteBuilder.kit` (Task 12); `window.AdminKit` (`$`, `esc`, `api`, `toast`, `lucide`); `B.info.elements`, `elementMotion`, `elementMotionDefaults`, `elementVisible`, `headerStyle`, `footerStyle`, `theme`, `wording` (Task 10); `POST /api/admin/site/logo?name=`, `DELETE /api/admin/site/logo` → `{ logo, rev }`.
- Produces: `window.SiteWide = { rail(host), outline(host), panel(), has(id) -> boolean }`.

- [ ] **Step 1: Write the failing test**

`site/test/sitewide-ui.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/sitewide-ui.test.mjs`
Expected: FAIL with `ENOENT` for `web/sitewide-admin.js`.

- [ ] **Step 3: Write the panels**

`web/sitewide-admin.js`:

```js
/* Site-wide editing in the page editor: the header and footer (their style and their elements), the theme and the
   wording. Everything here changes B.sw, the site-wide half of the editor's draft, through the editor's own commit(),
   so it previews, autosaves, undoes and publishes with the pages. Forms are built from the descriptions the server
   sends (site/bands.mjs, site/theme.mjs, site/wording.mjs), so they offer only what it accepts. The logo is the one
   exception: it is a file, uploaded and removed at once through the existing logo routes.
   Loaded by admin.html after builder-admin.js, whose internals it uses through window.SiteBuilder.kit; the editor
   calls back through window.SiteWide. Text from the server is always escaped or set as text. */
(function(){
var S = window.SiteBuilder; if (!S || !S.kit) return;
var X = S.kit, B = X.B, K = window.AdminKit, $ = K.$, esc = K.esc, api = K.api, toast = K.toast;
var AREAS = [["header", "Header", "layout-grid"], ["footer", "Footer", "layout-grid"], ["theme", "Theme", "palette"], ["wording", "Wording", "type"]];
var TABS = [["content", "Content"], ["motion", "Motion"]];
var shownBefore = {};   /* element id -> its "visible" setting before it was hidden, for this editor session */
var logoV = 0;          /* bumped after a logo upload, so the thumbnail is fetched again */

/* ---------- helpers ---------- */
function isBand(){ return B.area === "header" || B.area === "footer"; }
function band(){ return isBand() ? B.sw[B.area] : null; }
function elType(t){ return B.info.elements.filter(function(x){ return x.type === t; })[0] || { type: t, label: String(t), icon: "type", hint: "", fields: [], defaults: {} }; }
function findEl(id){
  var b = band(); if (!b || !id) return null;
  for (var i = 0; i < b.elements.length; i++) if (b.elements[i].id === id) return { list: b.elements, i: i, el: b.elements[i] };
  return null;
}
function has(id){ return !!findEl(id); }
function pageById(id){ return B.pages.filter(function(p){ return p.id === id; })[0]; }
/* every control changes the draft through commit(); typing merges into one undo step */
function setter(target, tag){
  return function(key, v, merge){ X.commit(function(){ var o = target(); if (o) o[key] = v; }, merge ? tag + key : null); };
}
function elSetter(id, part){ return setter(function(){ var f = findEl(id); return f ? (part ? f.el[part] : f.el) : null; }, id + (part || "") + ":"); }
/* a form whose fields may start headed groups (f.group) */
function grouped(fields, values, onSet){
  var box = document.createElement("div"), run = [];
  function flush(){ if (run.length) box.appendChild(X.buildForm(run, values, onSet)); run = []; }
  (fields || []).forEach(function(f){
    if (f.group){ flush(); var h = document.createElement("div"); h.className = "dzh3"; h.textContent = f.group; box.appendChild(h); }
    run.push(f);
  });
  flush();
  return box;
}
function snippet(e){
  var p = e.props || {};
  if (e.type === "menu") return Array.isArray(p.items) ? p.items.length + " items" : "automatic";
  return String(p.text || p.label || p.url || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

/* ---------- the rail: Header, Footer, Theme, Wording beside the pages ---------- */
function rail(host){
  host.innerHTML = '<div class="wbh"><span>Whole site</span></div><div role="list">' + AREAS.map(function(a){
    return '<div class="wbpg' + (B.area === a[0] ? " on" : "") + '" role="listitem" tabindex="0" data-area="' + a[0] + '">'
      + K.lucide(a[2], 16) + '<span class="nm">' + esc(a[1]) + '</span></div>';
  }).join("") + '</div>';
  Array.prototype.forEach.call(host.querySelectorAll("[data-area]"), function(r){
    r.onclick = function(){ X.selectArea(r.dataset.area, null); };
    r.onkeydown = function(ev){ if (ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); X.selectArea(r.dataset.area, null); } };
  });
}

/* ---------- the outline: the open band's elements ---------- */
function outline(host){
  var b = band();
  if (!b){ host.innerHTML = ""; return; }
  host.innerHTML = '<div class="wbh"><span>In the ' + esc(B.area) + '</span><button type="button" id="wbAddEl">+ Element</button></div>'
    + '<div class="wblist" data-list="band">' + b.elements.map(function(e){
      var t = elType(e.type), off = e.visible === "none";
      return '<div class="wbit" data-id="' + esc(e.id) + '"><div class="wbbl' + (B.sel === e.id ? " on" : "") + (off ? " off" : "") + '" data-sel="' + esc(e.id) + '">'
        + '<span class="hd" title="Drag to reorder">☰</span>' + K.lucide(t.icon, 16)
        + '<span class="nm">' + esc(t.label) + (off ? ' (hidden)' : '') + ' <small>' + esc(snippet(e)) + '</small></span>'
        + '<span class="acts"><button type="button" data-act="dup" title="Duplicate" aria-label="Duplicate">⧉</button>'
        + '<button type="button" data-act="hide" title="' + (off ? "Show" : "Hide") + '" aria-label="' + (off ? "Show" : "Hide") + '" aria-pressed="' + (off ? "true" : "false") + '">' + (off ? "◌" : "◉") + '</button>'
        + '<button type="button" data-act="del" title="Delete" aria-label="Delete">✕</button></span></div></div>';
    }).join("") + '</div>'
    + (b.elements.length ? "" : '<p class="hint" style="padding:0 16px">Nothing here yet. Press + Element.</p>');
  $("wbAddEl").onclick = picker;
  Array.prototype.forEach.call(host.querySelectorAll("[data-sel]"), function(row){
    row.onclick = function(ev){
      var a = ev.target.closest("[data-act]"), id = row.dataset.sel;
      if (!a) return X.selectArea(B.area, id);
      ev.stopPropagation();
      if (a.dataset.act === "dup") duplicate(id);
      if (a.dataset.act === "hide") toggleHidden(id);
      if (a.dataset.act === "del") remove(id);
    };
  });
  X.sortable(host.querySelector(".wblist"), ".wbit", function(ids){
    X.commit(function(){
      var b = band(); if (!b) return;
      var by = {}; b.elements.forEach(function(e){ by[e.id] = e; });
      b.elements = ids.map(function(id){ return by[id]; }).filter(Boolean);
    });
  });
}

/* the add-element picker; a new element goes after the selected one, else at the end */
function picker(){
  var box = document.createElement("div"); box.className = "wbpick";
  box.innerHTML = '<div class="wbpickin" role="dialog" aria-modal="true" aria-labelledby="wbElT"><div style="display:flex;justify-content:space-between;align-items:center"><h2 id="wbElT">Add to the ' + esc(B.area) + '</h2><button class="btn sm ghost" type="button" data-x>Close</button></div>'
    + '<div class="wbtypes">' + B.info.elements.map(function(t){
        return '<button type="button" class="wbtype" data-t="' + esc(t.type) + '">' + K.lucide(t.icon, 20) + '<span>' + esc(t.label) + '</span></button>'; }).join("") + '</div></div>';
  document.body.appendChild(box);
  function onEsc(ev){ if (ev.key === "Escape") done(); }
  function done(){ box.remove(); document.removeEventListener("keydown", onEsc); }
  document.addEventListener("keydown", onEsc);
  box.onclick = function(ev){
    if (ev.target === box || ev.target.closest("[data-x]")) return done();
    var b = ev.target.closest("[data-t]"); if (!b) return;
    done(); add(b.dataset.t);
  };
  var first = box.querySelector(".wbtype"); if (first) first.focus();
}
function add(type){
  var t = elType(type);
  var e = { id: X.rid("e"), type: type, props: X.clone(t.defaults), motion: X.clone(B.info.elementMotionDefaults), visible: "all" };
  X.commit(function(){ var b = band(), f = findEl(B.sel), at = f ? f.i + 1 : b.elements.length; b.elements.splice(at, 0, e); });
  X.selectArea(B.area, e.id);
}
function duplicate(id){
  var c;
  X.commit(function(){ var f = findEl(id); if (!f) return; c = X.clone(f.el); c.id = X.rid("e"); f.list.splice(f.i + 1, 0, c); });
  if (c) X.selectArea(B.area, c.id);
}
function toggleHidden(id){
  X.commit(function(){
    var f = findEl(id); if (!f) return;
    if (f.el.visible === "none") f.el.visible = shownBefore[id] || "all";
    else { shownBefore[id] = f.el.visible; f.el.visible = "none"; }
  });
  X.paintPanel();
}
function remove(id){
  X.commit(function(){ var f = findEl(id); if (f) f.list.splice(f.i, 1); });
  X.selectArea(B.area, null);
}

/* ---------- the right panel ---------- */
function panel(){
  if (B.area === "theme") return themePanel();
  if (B.area === "wording") return wordingPanel();
  var f = findEl(B.sel);
  if (!f){ B.sel = null; return bandPanel(); }
  elementPanel(f);
}
function bandPanel(){
  var hdr = B.area === "header";
  $("wbTitle").textContent = hdr ? "Header" : "Footer"; $("wbTabs").innerHTML = "";
  var host = $("wbBody"); host.innerHTML = "";
  if (hdr){
    var nm = X.el('<div class="field"><label>Site name</label><input type="text" id="wbSwName" maxlength="80"><div class="hint">Shown in browser tabs and search results, and instead of a logo if you have none.</div></div>');
    var i = nm.querySelector("input"); i.value = B.sw.name || "";
    i.oninput = function(){ var v = i.value; X.commit(function(){ B.sw.name = v; }, "swname"); };
    host.appendChild(nm);
  }
  host.appendChild(X.buildForm(hdr ? B.info.headerStyle : B.info.footerStyle, band().style, setter(function(){ var b = band(); return b && b.style; }, B.area + "style:")));
  host.appendChild(X.el('<p class="hint">Click an element in the preview or in the list to change it. + Element adds one.</p>'));
}
function elementPanel(f){
  var e = f.el, t = elType(e.type);
  if (B.tab !== "motion") B.tab = "content";
  $("wbTitle").textContent = t.label;
  $("wbTabs").innerHTML = TABS.map(function(x){ return '<button type="button" data-tab="' + x[0] + '" class="' + (B.tab === x[0] ? "on" : "") + '">' + x[1] + '</button>'; }).join("");
  Array.prototype.forEach.call($("wbTabs").querySelectorAll("button"), function(x){ x.onclick = function(){ B.tab = x.dataset.tab; X.paintPanel(); }; });
  var off = e.visible === "none", host = $("wbBody");
  host.innerHTML = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 16px"><button class="btn sm ghost" type="button" id="wbEBack">← ' + (B.area === "header" ? "Header" : "Footer") + '</button>'
    + '<button class="btn sm ghost" type="button" id="wbEDup">Duplicate</button>'
    + '<button class="btn sm ghost" type="button" id="wbEHide">' + (off ? "Show" : "Hide") + '</button>'
    + '<button class="btn sm ghost" type="button" id="wbEDel">Delete</button></div>'
    + (t.hint ? '<p class="hint">' + esc(t.hint) + '</p>' : "");
  if (B.tab === "motion") host.appendChild(X.buildForm(B.info.elementMotion, e.motion, elSetter(e.id, "motion")));
  else {
    host.appendChild(X.buildForm(t.fields, e.props, elSetter(e.id, "props"), menuControl));
    host.appendChild(X.buildForm([B.info.elementVisible], e, elSetter(e.id, null)));
  }
  $("wbEBack").onclick = function(){ X.selectArea(B.area, null); };
  $("wbEDup").onclick = function(){ duplicate(e.id); };
  $("wbEHide").onclick = function(){ toggleHidden(e.id); };
  $("wbEDel").onclick = function(){ remove(e.id); };
}

/* the menu's items: automatic (the pages marked for the menu, in page order), or the owner's own list of pages and links */
function menuControl(f, v, set){
  if (f.kind !== "menu") return null;
  var id = B.sel;
  function items(){ var x = findEl(id); return x && Array.isArray(x.el.props.items) ? x.el.props.items : []; }
  function change(fn, merge){ set(fn(items().map(function(it){ return X.clone(it); })), merge, !merge); }
  var box = X.el('<div class="wbmenu"><label ' + X.LBL + '><input type="checkbox" data-auto' + (Array.isArray(v) ? "" : " checked") + '> Automatic</label></div>');
  box.querySelector("[data-auto]").onchange = function(){
    set(this.checked ? null : B.pages.filter(function(p){ return p.inMenu; }).map(function(p){ return { id: X.rid("m"), kind: "page", pageId: p.id }; }), false, true);
  };
  if (!Array.isArray(v)) return box;
  var list = X.el('<div class="wblist" style="margin-top:8px"></div>');
  v.forEach(function(it){
    var row = X.el('<div class="wbit" data-id="' + esc(it.id) + '" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"></div>');
    if (it.kind === "page"){
      var p = pageById(it.pageId);
      row.innerHTML = '<span class="hd" title="Drag to reorder">☰</span><span class="nm" style="flex:1">' + esc(p ? p.title : "A deleted page")
        + (p && !p.inMenu ? ' <small>(not shown: “Show in the menu” is off)</small>' : '') + '</span>';
    } else {
      row.innerHTML = '<span class="hd" title="Drag to reorder">☰</span><input type="text" data-l maxlength="60" placeholder="Words" style="flex:1"><input type="text" data-u maxlength="300" placeholder="/page/ or https://…" style="flex:1.4">';
      row.querySelector("[data-l]").value = it.label || "";
      row.querySelector("[data-u]").value = it.url || "";
      row.querySelector("[data-l]").oninput = function(){ var t = this.value; change(function(a){ a.forEach(function(x){ if (x.id === it.id) x.label = t; }); return a; }, true); };
      row.querySelector("[data-u]").oninput = function(){ var t = this.value; change(function(a){ a.forEach(function(x){ if (x.id === it.id) x.url = t; }); return a; }, true); };
    }
    var rm = X.el('<button type="button" class="btn sm ghost" aria-label="Remove from the menu">✕</button>');
    rm.onclick = function(){ change(function(a){ return a.filter(function(x){ return x.id !== it.id; }); }); };
    row.appendChild(rm);
    list.appendChild(row);
  });
  box.appendChild(list);
  X.sortable(list, ".wbit", function(ids){ change(function(a){ var by = {}; a.forEach(function(x){ by[x.id] = x; }); return ids.map(function(i){ return by[i]; }).filter(Boolean); }); });
  var more = X.el('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><select data-p aria-label="Add a page"><option value="">+ Page…</option></select><button type="button" class="btn sm ghost" data-link>+ Link</button></div>');
  var sel = more.querySelector("[data-p]");
  B.pages.forEach(function(p){
    if (v.some(function(x){ return x.kind === "page" && x.pageId === p.id; })) return;
    var o = document.createElement("option"); o.value = p.id; o.textContent = p.title; sel.appendChild(o);
  });
  sel.onchange = function(){ var pid = sel.value; if (pid) change(function(a){ return a.concat([{ id: X.rid("m"), kind: "page", pageId: pid }]); }); };
  more.querySelector("[data-link]").onclick = function(){ change(function(a){ return a.concat([{ id: X.rid("m"), kind: "link", label: "Link", url: "" }]); }); };
  box.appendChild(more);
  return box;
}

function themePanel(){
  $("wbTitle").textContent = "Theme"; $("wbTabs").innerHTML = "";
  var host = $("wbBody"); host.innerHTML = "";
  host.appendChild(grouped(B.info.theme, B.sw.theme, setter(function(){ return B.sw.theme; }, "theme:")));
  host.appendChild(logoBox());
}
/* the logo is a file, not part of the draft: it changes at once (and reaches the public site with the next publish) */
function logoBox(){
  var logo = B.site.settings.style.logo;
  var box = X.el('<div><div class="dzh3">Logo</div>'
    + (logo ? '<img class="wthumb" style="object-fit:contain;background:' + esc(B.sw.theme.band) + '" alt="" src="/api/admin/site/img/' + esc(logo) + '?v=' + logoV + '">'
            : '<p class="hint">No logo: the site name is shown instead.</p>')
    + '<input type="file" id="wbLogo" accept=".png,.svg,image/png,image/svg+xml"> '
    + (logo ? '<button class="btn sm ghost" type="button" id="wbLogoX">Remove logo</button>' : '')
    + '<div class="hint">A PNG, or a plain SVG, under 2 MB. Undo does not bring back an earlier logo.</div></div>');
  box.querySelector("#wbLogo").onchange = function(){
    var f = this.files[0]; if (!f) return;
    fetch("/api/admin/site/logo?name=" + encodeURIComponent(f.name), { method: "POST", credentials: "same-origin", body: f })
      .then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || "Logo upload failed"); return j; }); })
      .then(logoDone, function(e){ toast(e.message); });
  };
  var x = box.querySelector("#wbLogoX");
  if (x) x.onclick = function(){
    api("/site/logo", { method: "DELETE" }).then(function(r){ if (!r.ok) return toast((r.body && r.body.error) || "Couldn’t remove the logo"); logoDone(r.body); },
      function(){ toast("Couldn’t remove the logo — check your connection"); });
  };
  return box;
}
function logoDone(j){
  B.site.settings.style.logo = j.logo || null; if (j.rev) B.rev = j.rev; B.dirty = true; logoV++;
  toast(j.logo ? "Logo updated" : "Logo removed");
  X.paintPub(); X.paintPanel(); X.render(0);
}
function wordingPanel(){
  $("wbTitle").textContent = "Wording"; $("wbTabs").innerHTML = "";
  var host = $("wbBody");
  host.innerHTML = '<p class="hint">The words the site writes by itself. The preview shows the “not found” page while this is open. '
    + 'An emptied one goes back to the original. The line under each gallery card is set on the Gallery cards block.</p>';
  host.appendChild(grouped(B.info.wording, B.sw.wording, setter(function(){ return B.sw.wording; }, "wording:")));
}

window.SiteWide = { rail: rail, outline: outline, panel: panel, has: has };
})();
```

- [ ] **Step 4: Load it, and deploy it**

In `web/admin.html`, replace:

```html
<script src="/builder-admin.js"></script>
```

with:

```html
<script src="/builder-admin.js"></script>
<script src="/sitewide-admin.js"></script>
```

In `deploy.sh`, replace:

```bash
web/builder-admin.js web/home.js
```

with:

```bash
web/builder-admin.js web/sitewide-admin.js web/home.js
```

Load order: `design-admin.js` (preview styles) → `builder-admin.js` (defines `window.SiteBuilder.kit`) → `sitewide-admin.js` (reads the kit at load time and returns early without it) → `home.js`. `builder-admin.js` only calls `window.SiteWide` at run time, after every script has loaded.

- [ ] **Step 5: Check the scripts and run the tests**

Run: `node --check web/sitewide-admin.js && node --check web/builder-admin.js && bash -n deploy.sh && node --test site/test`
Expected: no output from the checks; PASS, including `deploy-files.test.mjs`.

- [ ] **Step 6: Commit (commit only after the user approves)**

```bash
git add web/sitewide-admin.js web/admin.html deploy.sh site/test/sitewide-ui.test.mjs
git commit -m "Website editor: header, footer, menu, theme and wording panels"
```

---

### Task 14: Retire the old Style tab and the Pages-tab site fields

> UI task: covered by source-level tests here; exercised in a real browser only in Task 16.

The Website section keeps Galleries and a "Pages and look" tab that opens the editor; the Style tab (colours, fonts, text size, logo, layout) and the Pages tab's site name, copyright and Instagram fields are removed, since the Theme and Header/Footer panels edit them now. A remembered `style` screen opens the Pages tab. `settled()` no longer needs the form guard (no form is left on those screens). The logo routes and `PUT /api/admin/site/settings` stay: the editor uses the logo routes, and the settings route keeps old settings editable for restoring older versions and for any script that uses it. The photo grid's "Same as the Style tab" option becomes "Same as the theme".

**Files:**
- Modify: `web/site-admin.js`
- Modify: `site/blocks/photo-grid.mjs`
- Test: `site/test/website-tabs.test.mjs`

**Interfaces:**
- Consumes: `SiteBuilder.open()`.
- Produces: no new interfaces; removes `styleScreen`, `fontSample`, `W.fonts`, `W.defaults`, `W.dirtyForm` and the controls `wsn`, `wfc`, `wfi`, `wsavep`, `wsp`…`wsc`, `wsaves`, `wsreset`, `wlogo`, `wlogox`, `wsample`.

- [ ] **Step 1: Write the failing test**

`site/test/website-tabs.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const siteAdmin = rd('web/site-admin.js');

test('the old Style tab and the Pages tab’s site name and footer fields are gone, and nothing refers to them', () => {
  assert.doesNotMatch(siteAdmin, /styleScreen|fontSample|\["style","Style"\]|send\("\/settings"|dirtyForm/);
  for (const f of ['web/admin.html', 'web/builder-admin.js', 'web/sitewide-admin.js', 'web/site-admin.js', 'web/design-admin.js', 'web/home.js']) {
    assert.doesNotMatch(rd(f), /\b(wsn|wfc|wfi|wsavep|wsaves|wsreset|wlogo|wlogox|wsample|wshf|wsbf)\b/, f);
  }
  assert.match(siteAdmin, /The header and its menu, the footer, the theme \(colours, fonts, sizes, spacing and logo\)/);
  assert.match(siteAdmin, /if \(W\.screen === "style"\) W\.screen = "pages";/, 'a remembered Style tab opens Pages instead');
  assert.match(rd('site/blocks/photo-grid.mjs'), /\[0, 'Same as the theme'\]/);
});

test('the logo routes and the settings route stay for the editor and for restoring older versions', () => {
  const routes = rd('site/routes.mjs');
  assert.match(routes, /path === '\/api\/admin\/site\/logo' && m === 'POST'/);
  assert.match(routes, /path === '\/api\/admin\/site\/logo' && m === 'DELETE'/);
  assert.match(routes, /path === '\/api\/admin\/site\/settings' && m === 'PUT'/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test site/test/website-tabs.test.mjs`
Expected: FAIL (`styleScreen` and the old controls are still there).

- [ ] **Step 3: Change the Website section**

In `web/site-admin.js`, replace:

```js
/* Website section: the public site's galleries, pages, style and publishing.
```

with:

```js
/* Website section: the public site's galleries and publishing, and the way into the page editor, where the pages,
   header, footer, theme and wording are edited.
```

In `web/site-admin.js`, replace:

```js
          missing:null, fonts:[], defaults:null, liveUrl:null, queue:[], uploading:false, showVersions:false, active:false, liveDeploymentId:null, dirtyForm:false };
```

with:

```js
          missing:null, liveUrl:null, queue:[], uploading:false, showVersions:false, active:false, liveDeploymentId:null };
```

In `web/site-admin.js`, replace:

```js
".wthumb{width:120px;height:120px;object-fit:cover;border-radius:8px;background:var(--raised);display:block;margin-bottom:8px}",
".wcol{display:flex;gap:8px;align-items:center}.wcol input[type=color]{width:42px;height:32px;border:1px solid var(--input-line);border-radius:6px;padding:0;background:none}",
".wsample{font-size:20px;margin-top:6px;color:var(--fg)}"
].join("\n");
```

with:

```js
".wthumb{width:120px;height:120px;object-fit:cover;border-radius:8px;background:var(--raised);display:block;margin-bottom:8px}"
].join("\n");
```

In `web/site-admin.js`, replace:

```js
    W.canPublish = b.canPublish; W.missing = b.missing; W.fonts = b.fonts; W.defaults = b.defaults; W.liveUrl = b.liveUrl; W.liveDeploymentId = b.liveDeploymentId || null;
```

with:

```js
    W.canPublish = b.canPublish; W.missing = b.missing; W.liveUrl = b.liveUrl; W.liveDeploymentId = b.liveDeploymentId || null;
```

In `web/site-admin.js`, replace:

```js
/* after an upload run: rebuild the screen, unless the person is part-way through typing on a form */
function settled(){
  if (!W.active) return;
  if (!W.dirtyForm || (W.screen !== "pages" && W.screen !== "style")){ changed(); return; }
  load().then(function(){
    var st = document.querySelector(".wbar"); if (st) st.outerHTML = statusHtml();
  }, function(e){ toast(e.message); });
}
```

with:

```js
/* after an upload run: rebuild the screen */
function settled(){ if (W.active) changed(); }
```

In `web/site-admin.js`, replace:

```js
  var tabs = [["galleries","Galleries"],["pages","Pages"],["style","Style"]].map(function(t){
```

with:

```js
  if (W.screen === "style") W.screen = "pages";   /* the old Style tab: its settings are the editor's Theme now */
  var tabs = [["galleries","Galleries"],["pages","Pages and look"]].map(function(t){
```

In `web/site-admin.js`, replace:

```js
  wireVersions();
  W.dirtyForm = false;
  $("wbody").addEventListener("input", function(){ W.dirtyForm = true; });
  if (W.screen === "pages") return pagesScreen();
  if (W.screen === "style") return styleScreen();
```

with:

```js
  wireVersions();
  if (W.screen === "pages") return pagesScreen();
```

Then replace everything from the line `/* ---------- pages ---------- */` up to, but not including, the line `/* one entry in the heading's section menu; leaving stops background repaints */` (that is, the old `pagesScreen`, `fontSample` and `styleScreen`) with:

```js
/* ---------- pages ---------- */
/* the pages, header, footer, theme and wording are all edited in the full-screen page editor (builder-admin.js,
   sitewide-admin.js); the logo too, in its Theme panel */
function pagesScreen(){
  $("wbody").innerHTML = '<h3 class="sec">Pages and look</h3>'
    + '<p class="hint" style="margin:0 0 12px">Home, About, Contact, a page for each gallery and any page you add are made of blocks you can add, arrange, style and animate, with a live preview. '
    + 'The header and its menu, the footer, the theme (colours, fonts, sizes, spacing and logo) and the site’s own wording are edited there too. Changes stay a draft until you publish.</p>'
    + '<button class="btn" id="wedit">Open the page editor</button>';
  $("wedit").onclick = function(){ if (window.SiteBuilder){ W.active = false; SiteBuilder.open(); } };
}

```

In `site/blocks/photo-grid.mjs`, replace:

```js
[[0, 'Same as the Style tab']
```

with:

```js
[[0, 'Same as the theme']
```

- [ ] **Step 4: Check nothing else uses the removed controls**

Run: `node --check web/site-admin.js && grep -rn -E "styleScreen|fontSample|W\.fonts|W\.defaults|dirtyForm|\"wsn\"|\"wfc\"|\"wfi\"|wsavep|wsaves|wsreset|\"wlogo\"|wsample" web site --include=*.js --include=*.mjs --include=*.html`
Expected: no output.

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test site/test`
Expected: PASS.

- [ ] **Step 6: Commit (commit only after the user approves)**

```bash
git add web/site-admin.js site/blocks/photo-grid.mjs site/test/website-tabs.test.mjs
git commit -m "Website section: style, site name and footer move into the page editor"
```

---

### Task 15: Docs

**Files:**
- Modify: `README.md` ("### Public website", around line 251)
- Modify: `RUNBOOK.md` (the file table under "### Three files, no dependencies", around lines 34–35)
- NOTICE: no change.

**Interfaces:** none.

- [ ] **Step 1: README**

In `README.md`, replace:

```markdown
Edits are an autosaved draft with undo and redo; the public site changes only when you press **Publish**. A site
made before the page editor existed keeps looking exactly the same until you change it.
```

with:

```markdown
The header and its menu, the footer, the theme (colours, fonts, text size, photo spacing, card shape and logo) and the
words the site writes by itself (the "not found" page, the photo viewer's buttons) are edited in the same editor: click
the header or footer in the preview, or pick Header, Footer, Theme or Wording beside the pages. On phones the menu can
fold behind a menu button that works without JavaScript. Edits are an autosaved draft with undo and redo; the public
site changes only when you press **Publish**. A site made before the page editor existed keeps looking exactly the same
until you change it.
```

- [ ] **Step 2: RUNBOOK file table**

In `RUNBOOK.md`, replace:

```markdown
| `site/*.mjs`, `site/blocks/*.mjs`, `site/assets/*` | The public website: the store (settings, galleries, photos, the pages draft, publish history), the pages model and how pages are made from the old fixed pages, one module per block type, the HTML sanitiser, the builder that turns it all into static files, and publishing to Cloudflare Pages. Pure where possible, tested in `site/test`, including a golden test that a site which never used the page editor builds byte for byte as before. **New files here must be added to `FILES` in `deploy.sh`**; `site/test/deploy-files.test.mjs` fails until they are. |
| `web/site-admin.js`, `web/builder-admin.js`, `web/design-admin.js` | The admin panel's Website section, its full-screen page editor, and the gallery Design editor. Classic scripts that use `window.AdminKit`; the page editor reuses the Design editor's preview styles, so `design-admin.js` must load first. |
```

with:

```markdown
| `site/*.mjs`, `site/blocks/*.mjs`, `site/assets/*` | The public website: the store (settings, galleries, photos, the pages and site-wide draft, publish history), the pages model and how pages are made from the old fixed pages, one module per block type, the header and footer (`bands.mjs`), the theme (`theme.mjs`), the site's own wording (`wording.mjs`) and how they are made from the old settings (`sitewide.mjs`), the HTML sanitiser, the builder that turns it all into static files, and publishing to Cloudflare Pages. Pure where possible, tested in `site/test`, including two golden tests that a site which never used the page editor, or never saved its header, footer, theme and wording, builds byte for byte as before. **New files here must be added to `FILES` in `deploy.sh`**; `site/test/deploy-files.test.mjs` fails until they are. |
| `web/site-admin.js`, `web/builder-admin.js`, `web/sitewide-admin.js`, `web/design-admin.js` | The admin panel's Website section, its full-screen page editor, the editor's Header, Footer, Theme and Wording panels, and the gallery Design editor. Classic scripts that use `window.AdminKit`. Load order matters: `design-admin.js` (whose preview styles the page editor reuses), then `builder-admin.js`, then `sitewide-admin.js` (which uses `window.SiteBuilder.kit`). |
```

- [ ] **Step 3: Run the docs tests**

Run: `node --test docs/test`
Expected: PASS.

- [ ] **Step 4: Commit (commit only after the user approves)**

```bash
git add README.md RUNBOOK.md
git commit -m "Docs: header, footer, theme and wording in the website editor"
```

---

### Task 16: Browser check of the editor

The page editor and the new panels have only been checked by source-level tests. Exercise them in a real browser before deploying. **Admin sign-in is the user's**: the agent never types a password or sign-in code; the user signs in (or, for the local server below only, explicitly asks in chat for the agent to use the local test account it generated).

- [ ] **Step 1: Run the whole suite first**

Run: `node --test admin/test health/test zip/test mail/test config/test design/test setup/test site/test docs/test`
Expected: PASS.

- [ ] **Step 2: Start a local server with fake Immich (preferred)**

In the scratchpad (never in the repo), make a data folder and a test password, then start the fake Immich and the app in the background:

```bash
S="<the session scratchpad directory>/editor-check"; mkdir -p "$S/data"
node -e 'console.log(require("crypto").randomBytes(12).toString("hex"))' > "$S/admin-pass.txt"
node site/test/fake-immich.mjs 3997 &                     # background
DATA_DIR="$S/data" WEB_DIR="$PWD/web" PORT=3999 IMMICH_URL=http://127.0.0.1:3997 IMMICH_API_KEY=test \
  ADMIN_EMAIL=owner@example.test ADMIN_PASSWORD="$(cat "$S/admin-pass.txt")" node server.mjs   # background
```

Expected: the server logs that it is listening on 3999. If it does not start (for example it needs more of Immich than the fake answers), stop both processes and use Step 2b instead.

- [ ] **Step 2b (fallback): use the deployed admin panel after Task 17**

If the local server cannot be used, do Task 17 first and run Steps 3–9 against the deployed admin panel in the user's browser, where the user is already signed in. Do not publish; finish with **Discard changes** (Step 9).

- [ ] **Step 3: Open the editor**

Open `http://localhost:3999/admin` in the browser pane; ask the user to sign in. Website → Pages and look → Open the page editor. Check: the rail shows the pages and a "Whole site" group with Header, Footer, Theme, Wording; the preview looks exactly like the site before; the browser console has no errors.

- [ ] **Step 4: Header and menu**

Click the header background in the preview → the Header panel opens with Site name and the band style; click the menu in the preview → the Menu element opens. Change "On phones" to "Fold them into a menu button"; switch the preview to Phone: a three-line button replaces the links; in Open preview (a real page, not the editor), tapping it shows the links and they work. Turn off Automatic, drag a page down, add a link `/about/` and one `https://example.com`; check the preview order. Type `javascript:alert(1)` as an address: the status shows "Not saved: … menu links must start with …" and the error line names it; fix it and the status returns to "Draft saved".

- [ ] **Step 5: Elements, undo, hide**

Add a Button to the header, set it to a page, give it an entrance (Motion tab) and a hover; check the preview. Hide it from the outline: it stays listed as "(hidden)", faded in the preview, still selectable. Undo three times and Redo once; check the outline and preview follow. Duplicate and delete an element.

- [ ] **Step 6: Footer**

Click the footer → Footer panel. Add a Text element; check the footer stays laid out (first left, last right). Turn off "Back-to-top arrow" and set Arrangement to Centre.

- [ ] **Step 7: Theme and logo**

Theme: change the page colour, the accent and the heading font; the preview follows. Upload a PNG logo: it shows in the Theme panel and in the header at once; remove it: the site name shows again.

- [ ] **Step 8: Wording, stale and leaving**

Wording: the preview switches to the not-found page; change its heading and see it. Open the editor in a second tab, change something there, then change something in the first tab: the "changed somewhere else" box appears; choose "Load the latest". Try to leave the section while a save is failing (make the menu address bad again): the browser asks before leaving.

- [ ] **Step 9: Leave everything as it was**

Press **Discard changes** and confirm: the pages, header, footer, theme and wording go back to the published (or settings-made) version. Do not press Publish. Stop the local server and fake Immich if they were started; delete the scratch data folder.

- [ ] **Step 10: Record what was found**

Fix anything that failed in its own small commit (with a test where one can be written), re-run the suite, and note in the final report what was checked in the browser and what was not.

---

### Task 17: Deploy and verify

- [ ] **Step 1: Run the whole suite**

Run: `node --test admin/test health/test zip/test mail/test config/test design/test setup/test site/test docs/test`
Expected: PASS.

- [ ] **Step 2: Deploy**

Run `./deploy.sh` from the `website-editor` branch (the user's standing instruction is to deploy after changes). Expected: every new file reported as copied (`site/theme.mjs`, `site/wording.mjs`, `site/bands.mjs`, `site/sitewide.mjs`, `site/assets/bands.css`, `site/assets/bands.js`, `web/sitewide-admin.js`), the backup step, and the smoke test passing. Never push.

- [ ] **Step 3: Verify in the admin panel**

On the deployed admin panel (the user's session): Website → Preview looks exactly as before; Website → Pages and look → Open the page editor shows Header, Footer, Theme and Wording beside the pages; open Header and Theme and check the forms; make one small change, see it in the editor preview, then press **Discard changes** so the live site and its draft stay as they were. Do not publish unless the user asks. Tell the user the deploy is done and what to look at.

---

## Self-review against the spec

| Spec requirement | Task |
|---|---|
| Data stored with the pages draft, same autosave/undo/revision/snapshot | 9 (store), 10 (API), 12 (editor) |
| `band`/`bandStyle`/`element` shapes; eight element types | 4, 5 |
| Menu automatic by default, reorderable, custom items; addresses http(s)/mailto/tel/site path | 4 (`menuUrl`, menu check), 5 (render), 13 (menu editor) |
| Link, button, social use the block address check | 4 (`cleanFields` `link`/`url` kinds) |
| Theme: colours, accent, fonts, text size, grid gap, card shape (+ columns), logo | 2, 8, 13 (logo via existing routes) |
| Wording with today's defaults (404 heading and link, viewer labels) | 3, 8; gallery-card caption: see deviation 4 |
| One module per area for limits and validation | `theme.mjs`, `wording.mjs`, `bands.mjs`, `sitewide.mjs` |
| Unsaved site byte-identical (golden) | 1, 8 (both golden tests unchanged) |
| Defaults generated from settings; old fields kept; snapshots without `site` restore to defaults | 6, 9, 10 |
| `build.mjs` pure; same markup and classes when unchanged | 5, 8 |
| Phone menu button | 5, 7 |
| Theme feeds CSS variables; wording reaches renderers and 404 | 2, 8 |
| Motion: transform/opacity only, reduced motion, visible without JS | 7 |
| Rail gains Header/Footer/Theme/Wording; click header/footer selects | 11, 12, 13 |
| Band style and elements: add, reorder, duplicate, delete, hide | 13 |
| Theme and Wording form panels with live preview | 13 (Wording previews the 404 page) |
| Old Style tab and Pages-tab fields move into the panels | 13, 14 |
| Shared draft, undo/redo, stale/413, Publish | 12 |
| Escaping, address checks, logo checks, no HTML/scripts in bands | 4, 5, 10 (logo routes unchanged), 13 (admin escaping) |
| Tests: per element, migration, theme/wording reach output, routes incl. restore/discard/address, editor source + browser | 4–11, 12–14, 16 |
| Deploy list, docs | 2–7, 13 (FILES), 15, 17 |

Gaps found while reviewing and fixed in the tasks: the preview cached the logo for five minutes, so a replaced logo kept showing the old one (Task 10 makes it `no-store`); the 404 wording could not be seen in a normal page's preview (Task 12 previews the not-found page while Wording is open); the logo routes did not say which file they kept, so the editor could not update its state without a reload (Task 10 returns `{ logo }`).

## Spec deviations / open questions

1. **Storage is a sibling key, not a field inside the pages draft.** `s:site` is saved beside `s:pages` in the same transaction and under the same `_pagesRev`, through the same `PUT /api/admin/site/pages`, so it behaves as one draft while every existing reader of `s:pages` and every published snapshot stay valid. A body without `site` keeps the stored one.
2. **`site` gains a `name` field** (beside `header`, `footer`, `theme`, `wording`). The site name is used for page titles and the logo's alt text as well as the `siteName` element, so it belongs to the site, not to one element. It is edited at the top of the Header panel.
3. **Elements gain `visible`** (`all`, `desktop`, `phone`, `none`), beyond the spec's `{ id, type, props, motion }`, to support "hide" and phone/desktop-only elements the way blocks do.
4. **The gallery-card caption is not in Wording.** "Click For More!" has been the Gallery cards block's own "Line under each name" setting since the page builder, editable per block; a second, site-wide copy would conflict with it. The Wording panel says where to change it. Wording covers the 404 tab title, heading and home link, the photo viewer's three buttons, and the names of the back-to-top arrow and the phone menu button.
5. **The back-to-top arrow is a footer style switch (`toTop`)**, not a ninth element type, so the eight listed types stay as specified.
6. **The logo stays a file, outside the undoable draft.** Upload and Remove sit in the Theme panel and use the existing routes and PNG/SVG checks; they take effect at once in the preview and reach the public site with the next publish, and Undo does not bring back an earlier logo. `theme` itself has no `logo` key; the builder takes it from `settings.style.logo`.
7. **"Collapses when there is no room" is "on phones" (760 px and below).** Measuring room needs JavaScript; this works without it. Only menus set to "Fold them into a menu button" fold; the menu made from the old settings keeps the row, so nothing changes until the owner chooses it. A new menu element defaults to folding. In the editor preview clicks select instead of acting, so the button is tried in Open preview.
8. **Saving the site unchanged keeps every page identical but grows `style.css` and `site.js`** (the `--accent` variable, `bands.css`, `bands.js` and the viewer-label script), as saving pages did for `blocks.css`/`motion.js`. Byte identity is held, and tested, for sites that never saved the site.
9. **The accent colour only styles header and footer buttons.** Using it for page buttons would change the output of every site with saved pages. Should page buttons follow the accent once the theme is saved?
10. **Photo viewer labels are applied by a small script after `site.js`**, because changing `site.js` would break byte identity; the viewer itself needs JavaScript anyway.
11. **A custom menu still obeys each page's "Show in the menu".** Pages in the owner's list show only while marked; a page marked later is added at the end. Menu links may point at a path on this site (`/about/`); link and button elements use the block rules (a page of this site, or http(s)/mailto/tel).
12. **The element list sits in the left rail's outline**, as blocks do, rather than in the right panel; the right panel edits the band's style or the selected element.
13. **Footer layout:** "Spread out" keeps the old three-column grid (first left, last right, the rest between) and writes its own columns for other counts; Left, Centre and Right lay the footer out as a row.
14. **Social sites offered:** Instagram, Facebook, YouTube and LinkedIn, with simple line icons drawn like the existing Instagram one (not brand marks). Confirm the list.
15. **Element entrances play once** (no "every time"), with fade, lift and grow hover effects.
16. **The Website section's tabs become Galleries and "Pages and look"**; the old settings route stays for compatibility, but once the site is saved, changing `siteName`, `footer` or `style` (except the logo) through it no longer changes the public site.
17. **Browser check needs the user to sign in** (Task 16); the local server is preferred, the deployed panel is the fallback, and nothing is published.
