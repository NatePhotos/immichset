# Site-wide editing: header, menu, footer, theme and wording

Status: draft for review. Scope: roadmap piece 3 (see `2026-10-27-website-builder-design.md`),
built on the page editor, the pages draft and the Publish flow. Whole-site zip upload and theme packages
(piece 4) are out of scope.

## Goal

Everything that appears on the public site can be edited in the page editor: the header and its menu, the
footer, the theme (colours, fonts, sizes, spacing) and the fixed wording that is hard-coded today. Nothing
visibly changes until the owner edits it.

## Data model

Stored with the pages draft (same autosave, undo/redo, revision and publish snapshot):

```
site = { header: band, footer: band, theme: theme, wording: wording }
band = { style: bandStyle, elements: element[] }
bandStyle = { background, padding, alignment, sticky (header only) }
element = { id, type, props, motion }
```

Element types: `logo`, `siteName`, `menu`, `link`, `button`, `social`, `text`, `spacer`.

- `menu` is automatic by default (pages marked "show in menu", in page order). It can be reordered and can
  gain custom items (label, address); an address is checked as http(s), mailto, tel or a site path.
- `link`, `button` and `social` addresses use the same check as the page blocks.
- `theme` extends today's style settings: page, band, text and ink colours, an accent colour, heading and body
  fonts, text size, grid gap and card shape, plus the logo.
- `wording` holds the text that is fixed today: the gallery-card caption ("Click For More!"), the 404 page
  heading and its "Back to home" link, and the photo viewer labels. Each has a default equal to today's text.

All limits and validation live in one module per area, as `site/pages.mjs` and `site/blocks/*` do.

## Migration

A site that never saved these keys builds byte-for-byte as it does today (the golden test stays). On first
load the defaults are generated from the existing settings: the logo, site name and menu become the header,
the copyright line and Instagram link become the footer, and the current style becomes the theme. Old
settings fields are kept so restoring an earlier published version still works. Snapshots without `site`
restore to the generated defaults.

## Rendering

`site/build.mjs` stays a pure function. The header and footer element lists render to the same markup and
class names as today's when unchanged. The phone layout collapses the menu behind a menu button when there is
no room. Theme values feed the existing CSS variables. Wording flows into the block renderers and the 404
page. Entrance and hover effects follow the existing rules (transform and opacity only, reduced motion
respected, content visible without JavaScript).

## Editor

The left rail gains Header, Footer, Theme and Wording beside the pages. Clicking the header or footer in the
preview selects it. The right panel edits the selected band's style and elements (add, reorder, duplicate,
delete, hide). Theme and Wording are form panels with a live preview. The old Style tab and the site name and
footer fields on the Pages tab move into these panels. The autosaved draft, undo and redo, stale/413
handling and Publish are shared with the page editor.

## Safety

Text is escaped; addresses are checked; logo upload keeps the existing PNG/SVG checks. Header and footer
cannot contain arbitrary HTML or scripts.

## Testing

Per element: validation and rendered output. Migration: an untouched site builds identically (golden test).
Theme and wording: values reach the output. Routes: draft save, publish, restore (old snapshots without
`site`), discard, slug and address checks. Editor: source-level tests as for the page editor, plus a browser
check.

## Out of scope

Per-page header or footer overrides, arbitrary blocks inside the header or footer, custom CSS for the whole
site, whole-site zip upload and theme packages.
