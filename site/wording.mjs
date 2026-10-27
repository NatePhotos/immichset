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
