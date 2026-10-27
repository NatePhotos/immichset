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
