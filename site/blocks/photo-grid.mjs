import { cleanFields, esc, HOVER_IMAGE } from './common.mjs';
export const type = 'photo-grid';
export const label = 'Photo grid';
export const icon = 'layout-grid';
/* site.js lays out and opens the first grid on a page only, so a page holds one, and never inside columns */
export const nestable = false;
export const sketch = '<svg viewBox="0 0 100 60"><rect x="6" y="6" width="27" height="20"/><rect x="37" y="6" width="27" height="30"/><rect x="68" y="6" width="27" height="16"/><rect x="6" y="30" width="27" height="24"/><rect x="37" y="40" width="27" height="14"/><rect x="68" y="26" width="27" height="28"/></svg>';
export const defaults = Object.freeze({ galleryId: null, columns: 0, hover: 'none' });
export const fields = [
  { key: 'galleryId', label: 'Gallery', kind: 'gallery', hint: 'The name above the photos follows the gallery’s own “Show the name” setting.' },
  { key: 'columns', label: 'Columns on computers', kind: 'select', options: [[0, 'Same as the Style tab'], [2, '2'], [3, '3'], [4, '4'], [5, '5']] },
  { key: 'hover', label: 'On hover', kind: 'select', options: HOVER_IMAGE.slice(0, 4) },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b, ctx) {
  const p = b.props, g = ctx.gallery(p.galleryId);
  if (!g || g.hidden || !g.photos.length) return '';
  ctx.setOg(ctx.cover(g));
  const items = g.photos.map((ph, i) => {
    const [w, h] = ctx.gridSize(ph);
    return `<a class="m-item" href="${ctx.pic(ph, 'full')}" data-w="${ph.width}" data-h="${ph.height}">`
      + `<img src="${ctx.pic(ph, 'grid')}" width="${w}" height="${h}" alt="${esc(g.title)} photo ${i + 1}"${i < 8 ? '' : ' loading="lazy"'} decoding="async"></a>`;
  }).join('');
  const heading = `<h1 class="${g.showTitle ? 'page-title' : 'sr-only'}">${esc(g.title)}</h1>`;
  return `${heading}<section class="masonry${p.hover === 'none' ? '' : ` hv-${p.hover}`}" data-cols="${p.columns || ctx.style.colsDesktop}" data-cols-phone="${ctx.style.colsPhone}">${items}</section>`;
}
