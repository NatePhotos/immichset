import { cleanFields, esc, HOVER_IMAGE } from './common.mjs';
export const type = 'gallery-cards';
export const label = 'Gallery cards';
export const icon = 'images';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="8" y="8" width="24" height="34"/><rect x="38" y="8" width="24" height="34"/><rect x="68" y="8" width="24" height="34"/><rect x="11" y="47" width="18" height="4"/><rect x="41" y="47" width="18" height="4"/><rect x="71" y="47" width="18" height="4"/></svg>';
export const defaults = Object.freeze({ galleryIds: null, subtitle: 'Click For More!', hover: 'none' });
export const fields = [
  { key: 'galleryIds', label: 'Galleries', kind: 'galleries', hint: 'Every visible gallery, in the order of the Galleries tab, unless you pick some.' },
  { key: 'subtitle', label: 'Line under each name', kind: 'text', max: 80 },
  { key: 'hover', label: 'On hover', kind: 'select', options: HOVER_IMAGE },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b, ctx) {
  const p = b.props;
  const list = p.galleryIds ? p.galleryIds.map(id => ctx.shownGalleries.find(g => g.id === id)).filter(Boolean) : ctx.shownGalleries;
  if (list[0]) ctx.setOg(ctx.cover(list[0]));
  const cap = p.hover === 'caption' ? ' cap' : '';
  const cards = list.map((g, i) => {
    const c = ctx.cover(g); const [w, h] = ctx.gridSize(c);
    return `<a class="card" href="${ctx.base}${encodeURIComponent(g.slug)}/"><img src="${ctx.pic(c, 'grid')}" alt="${esc(g.title)}" width="${w}" height="${h}"${i === 0 ? ' fetchpriority="high"' : ''}>`
      + `<span class="card-title${cap}">${esc(g.title)}</span>` + (p.subtitle ? `<span class="card-sub${cap}">${esc(p.subtitle)}</span>` : '') + '</a>';
  }).join('');
  return `<section class="cards${p.hover === 'none' ? '' : ` hv-${p.hover}`}">${cards}</section>`;
}
