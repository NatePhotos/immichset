import { cleanFields, esc } from './common.mjs';
export const type = 'heading';
export const label = 'Heading';
export const icon = 'type';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="18" y="24" width="64" height="12" rx="2"/></svg>';
export const defaults = Object.freeze({ text: 'A heading', level: 2, size: 'medium' });
export const fields = [
  { key: 'text', label: 'Text', kind: 'text', max: 200 },
  { key: 'level', label: 'Importance', kind: 'select', options: [[1, 'Page title'], [2, 'Section'], [3, 'Sub-section']], hint: 'Search engines read the page title as what the page is about. Use it once per page.' },
  { key: 'size', label: 'Size', kind: 'select', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b) {
  const p = b.props;
  return `<h${p.level} class="hd hd-${p.size}">${esc(p.text)}</h${p.level}>`;
}
