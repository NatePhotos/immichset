# Website builder: block-based pages, visual editor, animations

Status: draft for review. Scope: pieces 1 and 2 of the four-piece roadmap (below).

## Goal

Give the admin panel's **Website** section a Wix-style editing experience: pages made of
blocks that can be added, reordered and styled in a live preview, with entrance, hover and
scroll animations. The published site stays static on Cloudflare Pages.

## Roadmap

1. Page and block model (this spec)
2. Visual editor (this spec)
3. Site-wide customisation: theme, header and menu, footer, custom pages, SEO, favicon, custom CSS (later spec)
4. Bring your own: whole-site zip upload, and importable theme packages (later spec)

## Data model

The site state gains `pages[]`:

```
page  = { id, title, slug, inMenu, seoTitle, seoDescription, blocks: block[] }
block = { id, type, props, style, motion }
```

- `style` is shared by every block: background colour or photo, padding, alignment,
  width (full or contained), and visibility at phone and desktop.
- `motion` is shared by every block (see Animations).
- `props` is specific to the block type and validated by that type's schema.
- Slugs may not collide with the existing reserved paths in `site/store.mjs` or with a
  gallery slug.

### Migration

On first load of a site without `pages`, they are generated from the current state:
Home becomes a gallery-cards block; each visible gallery becomes a page holding a photo-grid
block; About becomes an image-and-text block; Contact becomes a banner block plus a
contact-details block. Output for an unmigrated site must be byte-identical to today's
(tested). Old settings fields are kept, so restoring an earlier published version works.

## Blocks (first round)

Hero/banner, heading, rich text, image, image and text, gallery cards, photo grid (masonry),
button, spacer/divider, columns (2 or 3, each holding blocks), contact details, embed
(YouTube/Vimeo URL or map), custom HTML.

Each block type is one module exporting: `type`, `defaults`, `validate(props)`,
`render(block, ctx)` and an editor form description. Adding a type is one file.

## Animations

Per block (`motion`):
- Entrance: none, fade, slide up/down/left/right, zoom in, blur-in. Duration, delay, and
  once-or-every-time-in-view.
- Background: none or parallax.

Per image-bearing block: hover effect (none, zoom, lift, darken, caption reveal).
Per button: hover effect (fill, lift, glow).

Implementation: CSS classes and custom properties emitted by the builder, plus a small
IntersectionObserver script added to `site/assets/site.js`. Animations are skipped under
`prefers-reduced-motion`, and content is visible without JavaScript (the hidden initial state
is only applied once the script has loaded). Only transform and opacity are animated.

## Editor

Full-screen, in the style of the gallery Design editor (`web/design-admin.js`):
- Left rail: pages (add, rename, duplicate, delete, reorder, menu visibility, SEO fields)
  and a structure outline of the current page's blocks (drag to reorder, duplicate, delete,
  hide).
- Centre: live preview at phone, tablet and desktop size, click a block to select it.
- Right panel: the selected block's content, style and motion.
- Add-block picker with a preview of each type.
- Autosaved draft with undo and redo; the public site changes only on **Publish**. Existing
  version history and restore are unchanged.

## Rendering and safety

`site/build.mjs` stays a pure function: state in, files out. It loops over pages and calls
each block's `render`. All text is escaped, URLs are checked to be http(s), mailto or tel.
Custom HTML and any custom CSS go through a sanitiser with the same rules as gallery custom
CSS (`design/css.mjs`); scripts, inline event handlers and `javascript:` URLs are removed.
Uploaded images use the existing photo pipeline and Immich album sync.

## Testing

- Per block: schema validation, rendered output, escaping.
- Migration: an old site builds to identical output.
- Animations: classes emitted, no-JS and reduced-motion behaviour.
- Routes: draft save, publish, restore, slug collisions, stale-draft handling.

## Out of scope for this round

Free-form pixel positioning, a multi-language site, e-commerce, blog, theme and zip upload
(roadmap pieces 3 and 4).
