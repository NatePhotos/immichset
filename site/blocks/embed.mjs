import { cleanFields, esc } from './common.mjs';
export const type = 'embed';
export const label = 'Video or map';
export const icon = 'globe';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="14" y="8" width="72" height="44" rx="3"/><rect x="44" y="22" width="12" height="16"/></svg>';
export const defaults = Object.freeze({ kind: 'video', url: '', place: '', ratio: '16:9', title: '' });
export const fields = [
  { key: 'kind', label: 'Show', kind: 'select', options: [['video', 'A video'], ['map', 'A map']] },
  { key: 'url', label: 'YouTube or Vimeo link', kind: 'text', max: 300, when: ['kind', 'video'] },
  { key: 'place', label: 'Address or place name', kind: 'text', max: 200, when: ['kind', 'map'] },
  { key: 'ratio', label: 'Shape', kind: 'select', options: [['16:9', 'Wide'], ['4:3', 'Standard'], ['1:1', 'Square']] },
  { key: 'title', label: 'Description for screen readers', kind: 'text', max: 120 },
];
/* Only these players are ever embedded: the address is rebuilt from the video id, never taken from the link. */
export function embedSrc(p) {
  if (p.kind === 'map') return p.place ? `https://maps.google.com/maps?q=${encodeURIComponent(p.place)}&output=embed` : '';
  const u = String(p.url || '');
  let m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})(?:[?&#/].*)?$/i.exec(u);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = /^https?:\/\/(?:www\.)?(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d{1,12})(?:[?#/].*)?$/i.exec(u);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return '';
}
export function validate(props, ctx) {
  const r = cleanFields(props, fields, defaults, ctx);
  if (r.props.kind === 'video' && r.props.url && !embedSrc(r.props)) r.errors.url = 'paste a YouTube or Vimeo link';
  return r;
}
export function render(b) {
  const p = b.props, src = embedSrc(p);
  if (!src) return '';
  return `<div class="embed r-${p.ratio.replace(':', 'x')}"><iframe src="${esc(src)}" title="${esc(p.title || (p.kind === 'map' ? 'Map' : 'Video'))}" `
    + 'loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>';
}
