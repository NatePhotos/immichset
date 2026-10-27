import { cleanFields } from './common.mjs';
export const type = 'spacer';
export const label = 'Space or line';
export const icon = 'sliders-horizontal';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="10" y="29" width="80" height="2"/></svg>';
export const defaults = Object.freeze({ height: 'medium', line: false });
export const fields = [
  { key: 'height', label: 'Height', kind: 'select', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
  { key: 'line', label: 'Draw a line', kind: 'toggle' },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b) { return `<div class="spacer sp-${b.props.height}" aria-hidden="true">${b.props.line ? '<hr>' : ''}</div>`; }
