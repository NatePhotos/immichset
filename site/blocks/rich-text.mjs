import { cleanFields } from './common.mjs';
import { sanitizeHtml } from '../sanitize.mjs';
export const type = 'rich-text';
export const label = 'Text';
export const icon = 'type';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="14" y="14" width="72" height="5"/><rect x="14" y="25" width="66" height="5"/><rect x="14" y="36" width="70" height="5"/><rect x="14" y="47" width="40" height="5"/></svg>';
export const defaults = Object.freeze({ html: '<p>Write something here.</p>' });
export const fields = [{ key: 'html', label: 'Text', kind: 'richtext', max: 20000 }];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
/* sanitised again here, so text that reached the database some other way still cannot carry script */
export function render(b) { return `<div class="rich">${sanitizeHtml(b.props.html, 'rich')}</div>`; }
