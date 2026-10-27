/* Every website block type, and the checks and rendering that apply to all of them. A block type is one module in this
   folder exporting type, label, icon, sketch, defaults, fields, validate, render (and nestable = false if it may not go
   inside columns); list it in TYPES, in the order the add-block picker shows them. Pure. */
import * as hero from './hero.mjs';
import * as image from './image.mjs';
import * as imageText from './image-text.mjs';
import * as galleryCards from './gallery-cards.mjs';
import * as photoGrid from './photo-grid.mjs';
import * as heading from './heading.mjs';
import * as richText from './rich-text.mjs';
import * as button from './button.mjs';
import * as spacer from './spacer.mjs';
import { cleanStyle, cleanMotion, wrap, esc } from './common.mjs';
export { STYLE_DEFAULTS, STYLE_SCHEMA, MOTION_DEFAULTS, MOTION_SCHEMA } from './common.mjs';

const TYPES = [hero, heading, richText, image, imageText, galleryCards, photoGrid, button, spacer];
export const BLOCK_TYPES = new Map(TYPES.map(t => [t.type, t]));
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function listBlockTypes() {
  return TYPES.map(t => ({ type: t.type, label: t.label, icon: t.icon, sketch: t.sketch, defaults: t.defaults,
                           fields: t.fields, nestable: t.nestable !== false }));
}

function prep(ctx) { ctx.blockIds ??= new Set(); ctx.depth ??= 0; ctx.validateBlocks ??= validateBlocks; return ctx; }

export function validateBlock(raw, ctx = {}) {
  prep(ctx);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { block: null, errors: ['a block must be an object'] };
  const t = BLOCK_TYPES.get(raw.type);
  if (!t) return { block: null, errors: [`unknown block type "${String(raw.type).slice(0, 40)}"`] };
  if (ctx.depth > 0 && t.nestable === false) return { block: null, errors: [`${t.label} cannot go inside columns`] };
  const id = String(raw.id ?? '');
  if (!ID.test(id)) return { block: null, errors: [`${t.label}: the block id "${id.slice(0, 40)}" is not valid`] };
  if (ctx.blockIds.has(id)) return { block: null, errors: [`${t.label}: the block id "${id}" is used twice`] };
  ctx.blockIds.add(id);
  const p = t.validate(raw.props, ctx), s = cleanStyle(raw.style, ctx), m = cleanMotion(raw.motion);
  const errors = [...Object.entries(p.errors), ...Object.entries(s.errors), ...Object.entries(m.errors)]
    .map(([k, e]) => `${t.label}, ${k}: ${e}`);
  return { block: { id, type: t.type, props: p.props, style: s.style, motion: m.motion }, errors };
}

export function validateBlocks(list, ctx = {}) {
  prep(ctx);
  const blocks = [], errors = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const r = validateBlock(raw, ctx);
    if (r.block) blocks.push(r.block);
    errors.push(...r.errors);
  }
  return { blocks, errors };
}

export function countBlocks(list) {
  return list.reduce((n, b) => n + 1 + (b.type === 'columns' ? b.props.columns.reduce((k, c) => k + countBlocks(c), 0) : 0), 0);
}

export function renderBlock(b, ctx) {
  const t = BLOCK_TYPES.get(b.type);
  if (!t || (b.style.visible === 'none' && !ctx.editor)) return '';
  ctx.renderBlocks ??= renderBlocks;
  let inner = t.render(b, ctx);
  if (!inner) {
    if (!ctx.editor) return '';
    inner = `<p class="blk-empty">${esc(t.label)}: nothing to show yet</p>`;
  }
  return wrap(b, inner, ctx);
}

export function renderBlocks(list, ctx) { return (list || []).map(b => renderBlock(b, ctx)).join(''); }
