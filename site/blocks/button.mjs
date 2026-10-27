import { cleanFields, esc, linkHref, BUTTON_HOVER } from './common.mjs';
export const type = 'button';
export const label = 'Button';
export const icon = 'chevron-right';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="28" y="22" width="44" height="16" rx="3"/></svg>';
export const defaults = Object.freeze({ label: 'Get in touch', link: { kind: 'page', url: '', pageId: 'contact' }, look: 'solid', hover: 'fill', newTab: false });
export const fields = [
  { key: 'label', label: 'Words on the button', kind: 'text', max: 60 },
  { key: 'link', label: 'Goes to', kind: 'link' },
  { key: 'look', label: 'Look', kind: 'select', options: [['solid', 'Solid'], ['outline', 'Outline']] },
  { key: 'hover', label: 'On hover', kind: 'select', options: BUTTON_HOVER },
  { key: 'newTab', label: 'Open in a new tab', kind: 'toggle' },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b, ctx) {
  const p = b.props, href = linkHref(p.link, ctx);
  if (!href || !p.label) return '';
  const tab = p.newTab ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<p class="btn-row"><a class="sbtn sbtn-${p.look} bh-${p.hover}" href="${esc(href)}"${tab}>${esc(p.label)}</a></p>`;
}
