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
