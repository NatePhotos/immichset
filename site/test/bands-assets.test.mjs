import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ENTRANCES } from '../blocks/common.mjs';
import { ELEMENT_HOVER } from '../bands.mjs';

const CSS = readFileSync(new URL('../assets/bands.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const BLOCKS_CSS = readFileSync(new URL('../assets/blocks.css', import.meta.url), 'utf8');
const JS = readFileSync(new URL('../assets/bands.js', import.meta.url), 'utf8');

function media(query) {
  const at = CSS.indexOf(`@media (${query})`);
  assert.ok(at >= 0, `missing @media (${query})`);
  let i = CSS.indexOf('{', at), d = 0;
  const start = i;
  for (; i < CSS.length; i++) { if (CSS[i] === '{') d++; else if (CSS[i] === '}' && --d === 0) break; }
  return { body: CSS.slice(start + 1, i), from: at, to: i + 1 };
}
const topLevel = s => { const out = []; let d = 0, cur = ''; for (const c of s) { if (c === '(') d++; if (c === ')') d--; if (c === ',' && !d) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };

test('an element’s hidden start applies only once the script has run, and never for reduced motion', () => {
  const m = media('prefers-reduced-motion: no-preference');
  const outside = CSS.slice(0, m.from) + CSS.slice(m.to);
  assert.doesNotMatch(outside, /\.anim\b/);
  assert.doesNotMatch(outside, /:not\(\.in\)/);
  assert.match(m.body, /\.anim \.el\.m:not\(\.in\) \{ opacity: 0; \}/);
  for (const e of ENTRANCES.filter(x => x !== 'none' && x !== 'fade')) assert.ok(BLOCKS_CSS.includes(`.anim .m-${e}:not(.in)`), `blocks.css moves ${e}`);
});

test('only transform and opacity are animated, and reduced motion stills the hover effects', () => {
  assert.doesNotMatch(CSS, /@keyframes|animation\s*:/);
  const decls = [...CSS.matchAll(/transition(?:-property)?\s*:\s*([^;}]+)/g)].map(m => m[1]);
  assert.ok(decls.length >= 2);
  for (const d of decls) for (const part of topLevel(d)) assert.ok(['opacity', 'transform', 'none'].includes(part.trim().split(/\s+/)[0]), d);
  const r = media('prefers-reduced-motion: reduce').body;
  assert.match(r, /transition: none !important/);
  assert.match(r, /transform: none/);
  for (const [v] of ELEMENT_HOVER.filter(o => o[0] !== 'none')) assert.ok(CSS.includes(`.eh-${v}:hover`), v);
});

test('the phone menu opens from its checkbox, on phones only', () => {
  const m = media('max-width: 760px').body;
  assert.match(m, /\.top \.nav-c \{ display: none;/);
  assert.match(m, /\.top \.nav-t:checked ~ \.nav-c \{ display: flex; \}/);
  assert.match(m, /\.nav-b \{ display: block;/);
  assert.match(CSS.slice(0, CSS.indexOf('@media')), /\.nav-b \{ display: none; \}/, 'no menu button on computers');
});

const classList = set => ({ add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c) });
function run({ reduce = false, io = true, els = [] } = {}) {
  const html = new Set(), observed = new Set();
  let cb = null;
  const ctx = { document: { documentElement: { classList: classList(html) }, querySelectorAll: sel => (sel === '.el.m' ? els : []) },
    matchMedia: q => ({ matches: reduce && q.includes('reduce') }) };
  if (io) ctx.IntersectionObserver = class { constructor(f) { cb = f; } observe(e) { observed.add(e); } unobserve(e) { observed.delete(e); } };
  ctx.window = ctx;
  vm.runInNewContext(JS, ctx);
  return { html, observed, fire: entries => cb(entries) };
}

test('elements enter once as they come into view; nothing hides without IntersectionObserver or with reduced motion', () => {
  const set = new Set(['el', 'm']), e = { set, classList: classList(set) };
  const p = run({ els: [e] });
  assert.ok(p.html.has('anim'));
  p.fire([{ target: e, isIntersecting: true }]);
  assert.ok(set.has('in'));
  assert.ok(!p.observed.has(e));
  assert.ok(!run({ reduce: true, els: [e] }).html.has('anim'));
  assert.ok(!run({ io: false, els: [e] }).html.has('anim'));
  assert.ok(!run({ els: [] }).html.has('anim'));
});

test('band heights are minimums and a large logo fits the phone band', () => {
  for (const line of CSS.split('\n').filter(l => /^\s*\.(top|foot)(\.bp-\w+)?(, \.(top|foot)(\.bp-\w+)?)* \{/.test(l) && /\bheight:/.test(l.replace(/min-height|height: auto/g, '')))) assert.fail(`fixed band height: ${line}`);
  assert.match(CSS, /\.top\.bp-compact, \.foot\.bp-compact \{ min-height: 4\.6rem; \}/);
  const m = media('max-width: 760px').body;
  assert.match(m, /\.lg-large img \{ width: 4\.2rem; height: 4\.2rem; \}/);
  assert.match(m, /\.top \{ min-height: 5\.4rem; \}/);
  assert.doesNotMatch(m, /\.foot\s*\{[^}]*min-height/, 'the default footer keeps its 6.6rem on phones');
  assert.doesNotMatch(m, /\.top, \.foot \{ min-height/);
});

test('hover effects never put a transform or opacity on an element holding the folding menu', () => {
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim(), m[2]]);
  const onWrapper = rules.filter(([sel, body]) => /\.eh-(fade|lift|grow)\b[^{]*:hover/.test(sel) && /transform|opacity/.test(body));
  assert.ok(onWrapper.length >= 6);
  for (const [sel] of onWrapper) assert.ok(/:not\(:has\(\.nav-c\)\):hover/.test(sel) || /:hover \.nav-b$/.test(sel), sel);
  assert.match(CSS, /\.eh-lift:hover \.nav-b \{ transform: translateY\(-3px\); \}/);
  // the entrance state is only ever applied before .in, so a revealed wrapper ends with no transform
  assert.doesNotMatch(CSS, /\.el\.m\.in[^{]*\{[^}]*transform/);
});

test('the menu checkbox is out of the tab order except at phone width', () => {
  assert.match(CSS.slice(0, CSS.indexOf('@media')), /\.nav-t \{ display: none;/);
  assert.match(media('max-width: 760px').body, /\.nav-t \{ display: block; \}/);
});
