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
