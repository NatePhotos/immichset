import { cleanFields, esc, linkHref } from './common.mjs';
export const type = 'hero';
export const label = 'Banner';
export const icon = 'image';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="0" y="0" width="100" height="60"/><rect x="25" y="24" width="50" height="8" rx="1"/></svg>';
export const defaults = Object.freeze({ photoId: null, heading: 'A heading', subheading: '', buttonLabel: '',
  buttonLink: { kind: 'url', url: '', pageId: '' }, height: 'banner', shade: 0 });
export const fields = [
  { key: 'photoId', label: 'Photo', kind: 'photo' },
  { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
  { key: 'subheading', label: 'Line under the heading', kind: 'text', max: 200 },
  { key: 'buttonLabel', label: 'Button words', kind: 'text', max: 60, hint: 'Leave empty for no button.' },
  { key: 'buttonLink', label: 'Button goes to', kind: 'link' },
  { key: 'height', label: 'Height', kind: 'select', options: [['banner', 'Banner'], ['tall', 'Tall'], ['full', 'Full screen']] },
  { key: 'shade', label: 'Darken the photo', kind: 'number', min: 0, max: 70, step: 5, unit: '%' },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b, ctx) {
  const p = b.props, ph = ctx.photo(p.photoId);
  const href = p.buttonLabel ? linkHref(p.buttonLink, ctx) : null;
  const extra = (p.subheading ? `<p class="hero-sub">${esc(p.subheading)}</p>` : '')
    + (href ? `<a class="sbtn sbtn-solid bh-fill" href="${esc(href)}">${esc(p.buttonLabel)}</a>` : '');
  if (!ph) return `<h1 class="page-title">${esc(p.heading)}</h1>${extra}`;
  ctx.setOg(ph);
  const src = ctx.pic(ph, 'full');
  ctx.addHead(`<link rel="preload" as="image" href="${src}">`);
  const cls = p.height === 'banner' ? 'banner' : `banner hero-${p.height}`;
  const shade = p.shade ? `<span class="hero-shade" style="opacity:${p.shade / 100}"></span>` : '';
  const inner = extra ? `<div class="hero-in"><h1>${esc(p.heading)}</h1>${extra}</div>` : `<h1>${esc(p.heading)}</h1>`;
  return `<section class="${cls}" style="background-image:url('${src}')">${shade}${inner}</section>`;
}
