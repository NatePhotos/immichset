import { cleanFields, esc } from './common.mjs';
import { sanitizeHtml } from '../sanitize.mjs';
import { compileCustomCss } from '../../design/css.mjs';
export const type = 'custom-html';
export const label = 'Custom HTML';
export const icon = 'settings';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="10" y="12" width="30" height="5"/><rect x="18" y="22" width="46" height="5"/><rect x="18" y="32" width="38" height="5"/><rect x="10" y="42" width="30" height="5"/></svg>';
export const defaults = Object.freeze({ html: '<p>Your HTML here.</p>', css: '' });
export const fields = [
  { key: 'html', label: 'HTML', kind: 'html', max: 20000, hint: 'Text, headings, lists, links and tables. Scripts, event handlers such as onclick, style attributes, images and frames are removed.' },
  { key: 'css', label: 'CSS for this block', kind: 'css', hint: 'Applies only inside this block. The same rules as gallery custom CSS: no url(), @import, @font-face or position: fixed.' },
];
export const validate = (props, ctx) => cleanFields(props, fields, defaults, ctx);
export function render(b) {
  const c = b.props.css ? compileCustomCss(b.props.css, { scope: `#b-${b.id}` }) : { css: '' };
  return (c.css ? `<style>${c.css}</style>` : '') + `<div class="custom-html" id="b-${esc(b.id)}">${sanitizeHtml(b.props.html, 'custom')}</div>`;
}
