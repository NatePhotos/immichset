/* Gallery design: the settings, their limits, the themes, the CSS they produce and the file format.
   Pure functions with no imports beyond the sibling sanitiser, so the server, the tests and the admin all agree.
   Colours, numbers and choices are checked against strict limits; free text only ever goes through css.mjs.
   The design-file idea (a portable, versioned JSON of every setting) follows ImmichPager's appearance files,
   copyright 2026 ImmichPager contributors, AGPL-3.0, used with permission. */
import { compileCustomCss, CSS_LIMIT } from './css.mjs';

export const DESIGN_VERSION = 5;   /* 2 added the cover layout and title settings, 3 the cover animation switch, 4 the slideshow and favourites switches, 5 the photo count; older files still import */
export const DESIGN_FILE_FORMAT = 'immichset-design';
export const DESIGN_FILE_MAX_BYTES = 64 * 1024;

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
export const FONTS = [
  { id: 'montserrat', name: 'Montserrat', stack: `'Montserrat',${SANS}`, google: 'Montserrat:wght@300;400;500;600;700' },
  { id: 'system-sans', name: 'System sans-serif (no download)', stack: SANS, google: null },
  { id: 'system-serif', name: 'System serif (no download)', stack: "Georgia,'Times New Roman',serif", google: null },
  { id: 'system-rounded', name: 'System rounded (no download)',
    stack: "ui-rounded,'SF Pro Rounded','Hiragino Maru Gothic ProN',Quicksand,Nunito,'Segoe UI',sans-serif", google: null },
  { id: 'inter', name: 'Inter', stack: `'Inter',${SANS}`, google: 'Inter:wght@300;400;500;600;700' },
  { id: 'lato', name: 'Lato', stack: `'Lato',${SANS}`, google: 'Lato:wght@300;400;700' },
  { id: 'figtree', name: 'Figtree', stack: `'Figtree',${SANS}`, google: 'Figtree:wght@300;400;500;600;700' },
  { id: 'roboto', name: 'Roboto', stack: `'Roboto',${SANS}`, google: 'Roboto:wght@300;400;500;700' },
  { id: 'josefin-sans', name: 'Josefin Sans', stack: `'Josefin Sans',${SANS}`, google: 'Josefin+Sans:wght@300;400;600;700' },
  { id: 'lora', name: 'Lora', stack: "'Lora',Georgia,serif", google: 'Lora:wght@400;500;600;700' },
  { id: 'playfair-display', name: 'Playfair Display', stack: "'Playfair Display',Georgia,serif", google: 'Playfair+Display:wght@400;500;600;700' },
  { id: 'cormorant-garamond', name: 'Cormorant Garamond', stack: "'Cormorant Garamond',Georgia,serif", google: 'Cormorant+Garamond:wght@400;500;600;700' },
  { id: 'eb-garamond', name: 'EB Garamond', stack: "'EB Garamond',Georgia,serif", google: 'EB+Garamond:wght@400;500;600;700' },
];

/* Cover layouts. 'center' is the original look; every other one is CSS only (see COVER_CSS) over the same markup. */
export const COVER_LAYOUTS = [
  { id: 'center', name: 'Centre' }, { id: 'left', name: 'Left' }, { id: 'split', name: 'Split' },
  { id: 'classic', name: 'Classic' }, { id: 'frame', name: 'Frame' }, { id: 'lines', name: 'Lines' },
  { id: 'divider', name: 'Divider' }, { id: 'journal', name: 'Journal' }, { id: 'inset', name: 'Inset' }, { id: 'box', name: 'Box' },
];

export const ENUMS = {
  theme: ['light', 'dark', 'system'],
  font: FONTS.map((f) => f.id),
  titleFont: ['body', ...FONTS.map((f) => f.id)],
  titleCase: ['upper', 'none'],
  gridStyle: ['justified', 'tiles', 'columns'],
  cover: ['full', 'banner', 'none'],
  coverLayout: COVER_LAYOUTS.map((l) => l.id),
  header: ['bar', 'centered'],
  navStyle: ['text', 'icons'],
  coverMotion: ['on', 'off'],
  slideshow: ['on', 'off'],
  favourites: ['on', 'off'],
  photoCount: ['on', 'off'],
};

export const RANGES = {
  rowHeight: { min: 160, max: 520, step: 5, unit: 'px' },
  tileMinWidth: { min: 120, max: 420, step: 5, unit: 'px' },
  tileAspect: { min: 0.5, max: 2, step: 0.05, unit: '' },
  gap: { min: 0, max: 40, step: 1, unit: 'px' },
  radius: { min: 0, max: 24, step: 1, unit: 'px' },
  maxWidth: { min: 960, max: 2560, step: 10, unit: 'px' },
  coverHeight: { min: 30, max: 100, step: 5, unit: '%' },
  coverScrim: { min: 0, max: 70, step: 1, unit: '%' },
  titleWeight: { min: 300, max: 700, step: 100, unit: '' },
  titleTracking: { min: 0, max: 0.4, step: 0.005, unit: 'em' },
  titleSize: { min: 60, max: 160, step: 5, unit: '%' },
};

/* The defaults are exactly what the gallery page looked like before designs existed. */
export const DEFAULT_DESIGN = Object.freeze({
  theme: 'light', background: null, text: null, accent: null, font: 'montserrat',
  gridStyle: 'justified', rowHeight: 330, tileMinWidth: 240, tileAspect: 1, gap: 10, radius: 0, maxWidth: 1680,
  cover: 'full', coverHeight: 100, coverScrim: 28, header: 'bar', customCss: '',
  coverLayout: 'center', titleFont: 'body', titleCase: 'upper', titleWeight: 700, titleTracking: 0.085, titleSize: 100, navStyle: 'text',
  coverMotion: 'on', slideshow: 'on', favourites: 'on', photoCount: 'on',
});
const KEYS = Object.keys(DEFAULT_DESIGN);
const COLOR_KEYS = ['background', 'text', 'accent'];
const HEX = /^#[0-9a-f]{6}$/i;

export const THEMES = {
  light: { bg: '#ffffff', fg: '#1a1a1a', muted: '#8a8a8a', line: '#e6e6e6', tile: '#f2f2f2', header: 'rgba(255,255,255,.93)',
    surface: '#ffffff', accent: '#1a1a1a', accentFg: '#ffffff' },
  dark: { bg: '#111111', fg: '#f2f2f2', muted: '#9a9a9a', line: '#2a2a2a', tile: '#1c1c1c', header: 'rgba(17,17,17,.9)',
    surface: '#1c1c1c', accent: '#f2f2f2', accentFg: '#111111' },
};

/* One click sets all four colour keys. Chosen so text on background passes 4.5:1 and the accent passes 3:1. */
export const COLOR_PRESETS = [
  { id: 'light', name: 'Light', set: { theme: 'light', background: null, text: null, accent: null } },
  { id: 'dark', name: 'Dark', set: { theme: 'dark', background: null, text: null, accent: null } },
  { id: 'auto', name: 'Follow device', set: { theme: 'system', background: null, text: null, accent: null } },
  { id: 'ivory', name: 'Ivory', set: { theme: 'light', background: '#faf7f2', text: '#2b2724', accent: '#8a6f52' } },
  { id: 'sand', name: 'Sand', set: { theme: 'light', background: '#f1ebe2', text: '#3a332c', accent: '#8f6a45' } },
  { id: 'blush', name: 'Blush', set: { theme: 'light', background: '#f8efed', text: '#3d2c2c', accent: '#a55e5e' } },
  { id: 'sage', name: 'Sage', set: { theme: 'light', background: '#eef1ea', text: '#2d3329', accent: '#5f7150' } },
  { id: 'mist', name: 'Mist', set: { theme: 'light', background: '#eef2f5', text: '#1f2a33', accent: '#4f6b85' } },
  { id: 'charcoal', name: 'Charcoal', set: { theme: 'dark', background: '#1e1f22', text: '#ece9e4', accent: '#c8a96a' } },
  { id: 'ink', name: 'Ink', set: { theme: 'dark', background: '#0f1720', text: '#e8edf2', accent: '#7fa6c9' } },
];
/* Font and title pairings; the first is exactly today's look. */
export const TYPE_PRESETS = [
  { id: 'classic', name: 'Classic', set: { font: 'montserrat', titleFont: 'body', titleCase: 'upper', titleWeight: 700, titleTracking: 0.085, titleSize: 100 } },
  { id: 'serif', name: 'Serif', set: { font: 'lora', titleFont: 'playfair-display', titleCase: 'none', titleWeight: 500, titleTracking: 0.01, titleSize: 110 } },
  { id: 'elegant', name: 'Elegant', set: { font: 'lato', titleFont: 'cormorant-garamond', titleCase: 'upper', titleWeight: 500, titleTracking: 0.16, titleSize: 110 } },
  { id: 'modern', name: 'Modern', set: { font: 'inter', titleFont: 'body', titleCase: 'none', titleWeight: 600, titleTracking: 0, titleSize: 100 } },
  { id: 'airy', name: 'Airy', set: { font: 'josefin-sans', titleFont: 'body', titleCase: 'upper', titleWeight: 300, titleTracking: 0.3, titleSize: 100 } },
  { id: 'bold', name: 'Bold', set: { font: 'figtree', titleFont: 'body', titleCase: 'upper', titleWeight: 700, titleTracking: 0.02, titleSize: 120 } },
  { id: 'quiet', name: 'Quiet', set: { font: 'system-sans', titleFont: 'body', titleCase: 'none', titleWeight: 400, titleTracking: 0.02, titleSize: 85 } },
];

/* ---------- colour maths ---------- */
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const [x, y] = [rgb(a), rgb(b)]; return toHex(x.map((v, i) => v * (1 - t) + y[i] * t)); };
const lum = (hex) => {
  const c = rgb(hex).map((v) => v / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const readable = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111');

/* ---------- validation ---------- */
function checkOne(key, v) {
  const d = DEFAULT_DESIGN[key];
  if (COLOR_KEYS.includes(key)) return v === null || (typeof v === 'string' && HEX.test(v)) ? null : 'Use a six-digit colour such as #1a1a1a, or leave it empty';
  if (key in ENUMS) return ENUMS[key].includes(v) ? null : `Choose one of: ${ENUMS[key].join(', ')}`;
  if (key === 'customCss') {
    if (typeof v !== 'string') return 'Custom CSS must be text';
    if (v.length > CSS_LIMIT) return `Custom CSS is limited to ${CSS_LIMIT.toLocaleString('en-US')} characters`;
    const r = compileCustomCss(v);
    return r.error ? `Custom CSS, line ${r.error.line}, column ${r.error.col}: ${r.error.message}` : null;
  }
  const r = RANGES[key];
  if (typeof d === 'number' && r) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'Must be a number';
    if (v < r.min || v > r.max) return `Must be between ${r.min} and ${r.max}`;
    if (Number.isInteger(r.step) && !Number.isInteger(v)) return 'Must be a whole number';
    return null;
  }
  return 'Unknown setting';
}

/* Check a design. Strict: unknown keys, wrong types and out-of-range values are errors, never silently fixed.
   partial=true checks only the keys present (a gallery's overrides); otherwise missing keys take the default. */
export function normaliseDesign(input, { partial = false } = {}) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { design: null, errors: { design: 'A design must be an object' } };
  const design = partial ? {} : { ...DEFAULT_DESIGN };
  for (const [k, v] of Object.entries(input)) {
    if (k === 'v') continue;
    if (!KEYS.includes(k)) { errors[k] = `Unknown setting: ${k}`; continue; }
    const e = checkOne(k, v);
    if (e) errors[k] = e; else design[k] = typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : v;
  }
  return Object.keys(errors).length ? { design: null, errors } : { design, errors: {} };
}

/* site is a full design (or null), own is a sparse override object (or null). */
export function effectiveDesign(site, own) {
  return { ...DEFAULT_DESIGN, ...(site || {}), ...(own || {}) };
}

export function isDefaultDesign(d) {
  return KEYS.every((k) => d[k] === DEFAULT_DESIGN[k]);
}

/* ---------- output ---------- */
function palette(name, d) {
  const base = THEMES[name];
  if (!d.background && !d.text && !d.accent) return base;
  const bg = d.background || base.bg, fg = d.text || base.fg;
  const p = { ...base, bg, fg, surface: bg };
  if (d.background || d.text) {
    p.muted = mix(bg, fg, 0.55); p.line = mix(bg, fg, 0.1); p.tile = mix(bg, fg, 0.05);
    const [r, g, b] = rgb(bg); p.header = `rgba(${r},${g},${b},.93)`;
  }
  p.accent = d.accent || (d.text ? fg : base.accent);
  p.accentFg = readable(p.accent);
  return p;
}
const vars = (p) => `--page-bg:${p.bg};--page-fg:${p.fg};--muted:${p.muted};--line:${p.line};--tile-bg:${p.tile};` +
  `--header-bg:${p.header};--surface:${p.surface};--accent:${p.accent};--accent-fg:${p.accentFg}`;

export const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
export function fontHref(d) {
  const ids = [d.font, d.titleFont && d.titleFont !== 'body' ? d.titleFont : null];
  const fams = [...new Set(ids.filter(Boolean).map((id) => fontById(id).google).filter(Boolean))];
  return fams.length ? `https://fonts.googleapis.com/css2?${fams.map((g) => `family=${g}`).join('&')}&display=swap` : '';
}
/* Built only from catalogue constants, never from user text. */
export function fontLink(d) {
  const href = fontHref(d);
  return href ? '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    `<link href="${href}" rel="stylesheet">` : '';
}

/* The cover layouts, written over the existing markup: #cover > .bg, .scrim, .cover-inner (h1, .cover-date, .cover-cta), .cover-mark.
   "Paper" layouts put the text on the page colour instead of over the photo. Nothing here loads anything. */
const PAPER = '#cover{color:var(--page-fg);background:var(--page-bg)}#cover .scrim{display:none}.cover-inner h1{text-shadow:none}' +
  '.cover-cta{border-color:currentColor;color:inherit}.cover-cta:hover{background:var(--page-fg);color:var(--page-bg)}.cover-mark{display:none}';
const PHONE = '@media(max-width:700px){';
export const COVER_CSS = {
  left: '#cover{place-items:end start}.cover-inner{text-align:left;padding:0 clamp(24px,7vw,120px) clamp(96px,16svh,170px)}' +
    '.cover-mark{left:auto;right:clamp(20px,4vw,48px);transform:none}',
  split: PAPER + '#cover{grid-template-columns:1fr 1fr}#cover .bg{inset:clamp(16px,3vw,40px) clamp(16px,3vw,40px) clamp(16px,3vw,40px) 50%}.cover-inner{grid-column:1}' +
    PHONE + '#cover{grid-template-columns:1fr;grid-template-rows:58% 42%}#cover .bg{inset:16px 16px 42% 16px}.cover-inner{grid-column:1;grid-row:2}}',
  classic: PAPER + '#cover .bg{inset:clamp(16px,3vw,40px) clamp(16px,3vw,40px) clamp(160px,28svh,260px)}' +
    '.cover-inner{align-self:end;height:clamp(160px,28svh,260px);display:flex;flex-direction:column;justify-content:center;align-items:center}.cover-cta{margin-top:20px}',
  frame: '#cover{background:var(--page-bg)}#cover .bg,#cover .scrim{inset:clamp(10px,2vw,26px)}' +
    '#cover::after{content:"";position:absolute;inset:clamp(22px,3.6vw,48px);border:1px solid rgba(255,255,255,.7);pointer-events:none}',
  lines: '.cover-inner::before,.cover-inner::after{content:"";display:block;width:min(78vw,720px);height:1px;background:currentColor;opacity:.75;margin:0 auto clamp(22px,4svh,40px)}' +
    '.cover-inner::after{margin:clamp(22px,4svh,40px) auto 0}',
  divider: '#cover{place-items:center start}#cover::after{content:"";position:absolute;top:0;bottom:0;left:40%;width:clamp(3px,.5vw,8px);background:var(--page-bg);pointer-events:none}' +
    '.cover-inner{width:40%;padding:0 clamp(16px,3vw,48px)}' + PHONE + '#cover{place-items:center}.cover-inner{width:auto}#cover::after{display:none}}',
  journal: PAPER + '#cover{place-items:end end}#cover .bg{inset:clamp(16px,4vw,56px) 42% 26% clamp(16px,4vw,56px)}' +
    '.cover-inner{text-align:right;padding:0 clamp(24px,6vw,96px) clamp(40px,8svh,96px)}' +
    PHONE + '#cover{place-items:end center}#cover .bg{inset:16px 16px 40% 16px}.cover-inner{text-align:center;padding-bottom:40px}}',
  inset: PAPER + '#cover{place-items:end center}#cover .bg{inset:14% 33% 38%}.cover-inner{padding-bottom:clamp(40px,9svh,110px)}' +
    PHONE + '#cover .bg{inset:12% 14% 44%}}',
  box: '.cover-inner{border:1px solid currentColor;padding:clamp(28px,5vw,64px) clamp(24px,5vw,80px);max-width:min(90vw,880px)}',
};

/* The CSS for a full effective design: variables plus the layout switches. Everything here comes from
   validated numbers, hex colours and fixed choices. The owner's custom CSS is compiled separately and goes last. */
export function designCss(d) {
  const f = fontById(d.font);
  const light = palette(d.theme === 'dark' ? 'dark' : 'light', d);
  const scheme = d.theme === 'dark' ? 'dark' : d.theme === 'system' ? 'light dark' : 'light';
  let css = `:root{color-scheme:${scheme};${vars(light)};--cover-scrim:${d.coverScrim / 100};--gap:${d.gap}px;--maxw:${d.maxWidth}px;` +
    `--font:${f.stack};--radius:${d.radius}px;--row-h:${d.rowHeight};--row-h-tablet:${Math.round(d.rowHeight * 260 / 330)};` +
    `--tile-min:${d.tileMinWidth}px;--tile-aspect:${d.tileAspect};--ims-cover:${d.cover};--ims-grid:${d.gridStyle};--ims-header:${d.header};--ims-cover-layout:${d.coverLayout}}`;
  if (d.theme === 'system') css += `@media (prefers-color-scheme:dark){:root{${vars(THEMES.dark)}}}`;
  if (d.cover === 'none') css += '#cover{display:none}';
  else if (d.cover === 'banner') css += `#cover{height:${d.coverHeight}svh;min-height:280px}`;
  if (d.gridStyle === 'tiles') css += '#grid.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(var(--tile-min),calc(50% - var(--gap))),1fr));gap:var(--gap)}' +
    '#grid.tiles .cell{aspect-ratio:var(--tile-aspect)}';
  if (d.header === 'centered') css += '@media (min-width:701px){.hwrap{flex-wrap:wrap;justify-content:center;height:auto;padding-block:14px}' +
    '.htitle{flex-basis:100%;text-align:center}}';
  if (d.gridStyle === 'columns') css += '#grid.columns{column-width:var(--tile-min);column-gap:var(--gap)}' +
    '#grid.columns .cell{display:block;break-inside:avoid;margin-bottom:var(--gap)}';
  /* titles: only what differs from the original look is written */
  if (d.titleFont !== 'body') css += `.cover-inner h1,.htitle{font-family:${fontById(d.titleFont).stack}}`;
  if (d.titleCase === 'none') css += '.cover-inner h1,.htitle,.gate-box h1{text-transform:none}';
  if (d.titleWeight !== DEFAULT_DESIGN.titleWeight) css += `.cover-inner h1{font-weight:${d.titleWeight}}`;
  if (d.titleTracking !== DEFAULT_DESIGN.titleTracking) css += `.cover-inner h1{letter-spacing:${d.titleTracking}em}`;
  if (d.titleSize !== 100) {
    const k = d.titleSize / 100;
    css += `.cover-inner h1{font-size:calc(clamp(30px,6.2vw,62px)*${k})}@media(min-width:701px) and (max-width:1100px){.cover-inner h1{font-size:calc(clamp(34px,6vw,54px)*${k})}}`;
  }
  if (d.navStyle === 'icons') css += '@media(min-width:701px){.hbtn span{display:none}.hbtn svg{display:block;width:19px;height:19px}.hbtn{width:40px;height:40px;padding:0;gap:0}}';
  /* cover animation off: the cover is shown at once, in its final place */
  if (d.coverMotion === 'off') css += '#cover .bg{transition:none;transform:none}.cover-inner{transition:none;transform:none}';
  /* things clients can do: off hides the control (the heart on each photo and in the viewer, the Favourites button; the Slideshow button) */
  if (d.slideshow === 'off') css += '#btnSlides{display:none!important}';
  if (d.photoCount === 'off') css += '#hCount{display:none!important}';
  if (d.favourites === 'off') css += '#btnFav,.heart,#lbFav{display:none!important}';
  if (d.cover !== 'none' && COVER_CSS[d.coverLayout]) css += COVER_CSS[d.coverLayout];
  const own = d.customCss ? compileCustomCss(d.customCss) : { css: '' };
  return (css + own.css).replaceAll('<', '\\3c ');
}

export function designWarnings(d) {
  const out = [];
  const p = palette(d.theme === 'dark' ? 'dark' : 'light', d);
  if (contrast(p.bg, p.fg) < 4.5) out.push('The text colour is hard to read on this background (contrast below 4.5:1).');
  if (d.accent && contrast(p.bg, p.accent) < 3) out.push('The accent colour is hard to see on this background (contrast below 3:1).');
  if (d.theme === 'system' && (d.background || d.text || d.accent)) out.push('Custom colours apply to the light appearance only; devices set to dark use the dark preset.');
  return out;
}

/* ---------- files ---------- */
export function serializeDesignFile(design) {
  const { design: full, errors } = normaliseDesign(design);
  if (!full) throw new Error(Object.values(errors)[0]);
  return JSON.stringify({ format: DESIGN_FILE_FORMAT, version: DESIGN_VERSION, design: full }, null, 2) + '\n';
}

/* Returns a full, validated design or throws an Error whose message is safe to show to the owner. */
export function parseDesignFile(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > DESIGN_FILE_MAX_BYTES) throw new Error('This design file is too large.');
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  if (!o || typeof o !== 'object' || o.format !== DESIGN_FILE_FORMAT) throw new Error('This is not an immichset design file.');
  if (!Number.isInteger(o.version) || o.version < 1) throw new Error('This design file has no valid version.');
  if (o.version > DESIGN_VERSION) throw new Error('This design file was made by a newer version of immichset.');
  if (Object.keys(o).some((k) => !['format', 'version', 'design'].includes(k))) throw new Error('This design file has unexpected fields.');
  const { design, errors } = normaliseDesign(o.design);
  if (!design) throw new Error(Object.values(errors)[0]);
  return design;
}
