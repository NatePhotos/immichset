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
