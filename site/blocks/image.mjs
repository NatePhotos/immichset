import { cleanFields, esc, linkHref, HOVER_IMAGE } from './common.mjs';
export const type = 'image';
export const label = 'Photo';
export const icon = 'image';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="20" y="6" width="60" height="40"/><rect x="34" y="50" width="32" height="4"/></svg>';
export const defaults = Object.freeze({ photoId: null, alt: '', caption: '', size: 'large', link: { kind: 'url', url: '', pageId: '' }, hover: 'none' });
export const fields = [
  { key: 'photoId', label: 'Photo', kind: 'photo' },
  { key: 'alt', label: 'Description for people who cannot see it', kind: 'text', max: 200 },
  { key: 'caption', label: 'Caption', kind: 'text', max: 200 },
  { key: 'size', label: 'Size', kind: 'select', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['full', 'Edge to edge']] },
  { key: 'link', label: 'Clicking it goes to', kind: 'link' },
  { key: 'hover', label: 'On hover', kind: 'select', options: HOVER_IMAGE },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b, ctx) {
  const p = b.props, ph = ctx.photo(p.photoId);
  if (!ph) return '';
  ctx.setOg(ph);
  const v = p.size === 'small' || p.size === 'medium' ? 'grid' : 'full';
  const [w, h] = v === 'grid' ? ctx.gridSize(ph) : [ph.width, ph.height];
  const img = `<img src="${ctx.pic(ph, v)}" width="${w}" height="${h}" alt="${esc(p.alt)}" loading="lazy" decoding="async">`;
  const href = linkHref(p.link, ctx);
  const cap = p.caption ? `<figcaption class="cap">${esc(p.caption)}</figcaption>` : '';
  const hv = p.hover === 'none' ? '' : ` hv-${p.hover}`;
  return `<figure class="img-block size-${p.size}${hv}"><span class="frame">${href ? `<a href="${esc(href)}">${img}</a>` : img}</span>${cap}</figure>`;
}
