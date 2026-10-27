# Design

How a gallery looks to clients: the cover, fonts, colours and how the photos are laid out. Nothing here changes your
photos, only how they are shown.

Open any gallery and choose **Design** (or click its cover thumbnail). The editor fills the window:

- **Left:** the sections: **Cover**, **Typography**, **Color**, **Grid** and **Advanced**.
- **Middle:** the options for the section you picked.
- **Right:** a large, live preview of the real gallery page. Use **Phone**, **Tablet** and **Desktop** (and the rotate button)
  under it to check each screen. What you see is what a client gets on that screen.

On a phone the preview sits at the top and the sections run along a row under it; the expand button makes the preview full screen.

**Your changes are a draft.** They save by themselves a moment after you make them (the footer says *Saving…* then *Draft saved*),
but **clients keep seeing the published design until you press Publish**. You can try things freely, look at every screen size, and
leave and come back; the draft is still there. Under the options you'll see whether anything is waiting:

- **Publish** puts the draft live, so clients see it.
- **Discard changes** throws the draft away and goes back to the published design.
- **Undo** and **Redo** in the footer step through your edits (or press Ctrl/Cmd+Z). A slider drag counts as one step.

The big preview shows the draft. The **Preview** button at the top opens the published gallery, as clients see it; the **More**
menu has *Open draft in a new tab*.

## Cover

- **Layout:** ten cover styles to choose from: Centre (the original), Left, Split, Classic, Frame, Lines, Divider, Journal, Inset and Box.
  The pictures show your own cover photo.
- **Cover size:** full screen, a shorter banner, or none (the gallery opens on the photos). Layouts apply when the cover is shown.
- **Darken the photo** keeps the title readable on bright photos.
- **Cover photo:** upload your own image or pick one from the album. **Focal point:** drag the dot onto what must stay in
  frame on every screen shape; the preview shows the crop as you drag.

## Typography

Pick a pairing (Classic, Serif, Elegant, Modern, Airy, Bold, Quiet), then fine-tune the body font, title font, title case,
weight, letter spacing and size. The "no download" fonts use fonts already on the viewer's device and fetch nothing from Google.

## Color

Pick a palette (Light, Dark, Follow device, Ivory, Sand, Blush, Sage, Mist, Charcoal, Ink) or set your own background, text
and accent. **Match my website** borrows the colours and font of your public website. If a pair is hard to read, a yellow note
says so. With *Follow the device*, your own colours apply to the light appearance only; devices set to dark use the dark theme.

## Grid

Rows (each photo keeps its shape, like a contact sheet), Tiles (a regular grid) or Columns (photos flow top to bottom, keeping their
shapes). Then thumbnail size, spacing, rounded corners, the widest the gallery gets, the header title position and whether header
buttons show words or icons. On tablets rows are slightly shorter; phones follow the screen.

## Advanced

- **Default look.** Your default look is what galleries you create **from now on** start with. A gallery keeps only the
  settings you change; everything else follows your default look. **Save as my default look** makes this gallery's look the
  default for new galleries, and **galleries that already exist keep exactly the look they have**: nothing else changes.
  **Use my default look** clears this gallery's changes so it matches your default again (Undo brings them back).
  **Reset default to original** sets the default back to the original look, again for new galleries only.
- **Custom CSS.** For anything the controls don't cover. It is checked as you type and only saved when it passes; a problem is shown with
  its line and column. Useful selectors: `:scope` (the whole gallery), `#cover`, `.hwrap` (the header bar), `.htitle`, `#grid`, `.cell`
  (a photo). Variables such as `--gap`, `--radius`, `--page-bg` and `--accent` can be set on `:scope`.

  ```css
  .htitle { letter-spacing: .3em; }
  :scope { --radius: 6px; }
  ```

  Not allowed, because a gallery is seen by your clients and must not load anything from elsewhere: `url()`, `@import`, `@font-face`,
  animations, `position: fixed`, backslash escapes, and anything that could close the page's style block. Up to 20,000 characters.
  Every selector is limited to the gallery itself, so it cannot change the admin or other pages.
- **Design file.** *Download design file* saves the gallery's look as `immichset-design.json`: settings and CSS only, with no photos,
  names, titles or web addresses, so it is safe to keep or share. *Import* fills the settings in so you can look first; Undo reverses it.
  A damaged or oversized file, one from a newer immichset, or one with disallowed CSS is refused with a message that says why.

The **More** menu in the top bar has the default-look actions and a link to Advanced.

## Credits

The editor's layout, the portable design file and the approach to checking custom CSS follow ideas from
[ImmichPager](https://gitlab.com/wispd/ImmichPager) (AGPL-3.0, used with permission) and from gallery tools such as Pixieset. See `NOTICE`.
