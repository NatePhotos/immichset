import { cleanFields } from './common.mjs';
export const type = 'columns';
export const label = 'Columns';
export const icon = 'layout-grid';
export const nestable = false;
export const sketch = '<svg viewBox="0 0 100 60"><rect x="6" y="8" width="26" height="44"/><rect x="37" y="8" width="26" height="44"/><rect x="68" y="8" width="26" height="44"/></svg>';
export const defaults = Object.freeze({ count: 2, gap: 'normal', columns: [[], [], []] });
export const fields = [
  { key: 'count', label: 'Columns', kind: 'select', options: [[2, 'Two'], [3, 'Three']], hint: 'On phones the columns stack, one under the other.' },
  { key: 'gap', label: 'Space between', kind: 'select', options: [['tight', 'Tight'], ['normal', 'Normal'], ['roomy', 'Roomy']] },
];
/* the blocks inside are checked like a page's, sharing its set of ids; a third column is kept when two are shown */
export function validate(raw, ctx) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const { props, errors } = cleanFields(src, fields, defaults, ctx);
  const cols = Array.isArray(src.columns) ? src.columns : [];
  const inner = { ...ctx, depth: (ctx.depth || 0) + 1 };
  props.columns = [0, 1, 2].map(i => {
    const r = ctx.validateBlocks(Array.isArray(cols[i]) ? cols[i] : [], inner);
    r.errors.forEach((e, j) => { errors[`column ${i + 1} (${j + 1})`] = e; });
    return r.blocks;
  });
  return { props, errors };
}
export function render(b, ctx) {
  const p = b.props;
  return `<div class="cols cols-${p.count} gap-${p.gap}">`
    + p.columns.slice(0, p.count).map(c => `<div class="col">${ctx.renderBlocks(c, ctx)}</div>`).join('') + '</div>';
}
