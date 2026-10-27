import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ENTRANCES, HOVER_IMAGE, BUTTON_HOVER } from '../blocks/common.mjs';

const CSS = readFileSync(new URL('../assets/blocks.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const MOTION = readFileSync(new URL('../assets/motion.js', import.meta.url), 'utf8');

function media(query) {
  const at = CSS.indexOf(`@media (${query})`);
  assert.ok(at >= 0, `missing @media (${query})`);
  let i = CSS.indexOf('{', at), d = 0;
  const start = i;
  for (; i < CSS.length; i++) { if (CSS[i] === '{') d++; else if (CSS[i] === '}' && --d === 0) break; }
  return { body: CSS.slice(start + 1, i), from: at, to: i + 1 };
}
const topLevel = s => { const out = []; let d = 0, cur = ''; for (const c of s) { if (c === '(') d++; if (c === ')') d--; if (c === ',' && !d) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };

test('the hidden start of an entrance applies only once the script has run, and never for reduced motion', () => {
  const m = media('prefers-reduced-motion: no-preference');
  const outside = CSS.slice(0, m.from) + CSS.slice(m.to);
  assert.doesNotMatch(outside, /\.anim\b/);
  assert.doesNotMatch(outside, /:not\(\.in\)/);
  const hidden = m.body.split('}').filter(r => r.includes(':not(.in)'));
  assert.ok(hidden.length >= ENTRANCES.length - 2);
  for (const r of hidden) assert.match(r.trim(), /^\.anim /, r);
});

test('every entrance has a start state', () => {
  const m = media('prefers-reduced-motion: no-preference').body;
  assert.match(m, /\.anim \.blk\.m:not\(\.in\) \{ opacity: 0; \}/);
  for (const e of ENTRANCES.filter(x => x !== 'none' && x !== 'fade')) assert.ok(m.includes(`.anim .m-${e}:not(.in)`), e);
});

test('only transform and opacity are ever animated', () => {
  assert.doesNotMatch(CSS, /@keyframes|animation\s*:/);
  const decls = [...CSS.matchAll(/transition(?:-property)?\s*:\s*([^;}]+)/g)].map(m => m[1]);
  assert.ok(decls.length > 5);
  for (const d of decls) for (const part of topLevel(d)) {
    assert.ok(['opacity', 'transform', 'none'].includes(part.trim().split(/\s+/)[0]), `animates more than transform/opacity: ${d}`);
  }
});

test('reduced motion also stills hover effects', () => {
  const r = media('prefers-reduced-motion: reduce').body;
  assert.match(r, /transition: none !important/);
  assert.match(r, /transform: none/);
});

test('every hover effect the blocks offer has a rule', () => {
  for (const [v] of HOVER_IMAGE.filter(o => o[0] !== 'none')) assert.ok(CSS.includes(`.hv-${v}`), v);
  for (const [v] of BUTTON_HOVER) assert.ok(CSS.includes(`.bh-${v}`), v);
});

/* motion.js against a pretend page */
const classList = set => ({ add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c) });
const block = (...cls) => { const set = new Set(['blk', 'm', ...cls]); return { set, classList: classList(set) }; };
function run({ reduce = false, io = true, blocks = [], layers = [] } = {}) {
  const html = new Set(), observed = new Set(), handlers = {};
  let cb = null;
  const ctx = {
    document: { documentElement: { classList: classList(html) },
      querySelectorAll: sel => (sel === '.blk.m' ? blocks : sel === '.blk.px > .blk-bg' ? layers : []) },
    matchMedia: q => ({ matches: reduce && q.includes('reduce') }),
    innerHeight: 800,
    addEventListener: (t, f) => { handlers[t] = f; },
    requestAnimationFrame: f => f(),
  };
  if (io) ctx.IntersectionObserver = class { constructor(f) { cb = f; } observe(e) { observed.add(e); } unobserve(e) { observed.delete(e); } };
  ctx.window = ctx;
  vm.runInNewContext(MOTION, ctx);
  return { html, observed, handlers, fire: entries => cb(entries) };
}

test('blocks enter as they come into view; once means once', () => {
  const a = block('m-fade', 'm-once'), b = block('m-slide-up');
  const p = run({ blocks: [a, b] });
  assert.ok(p.html.has('anim'));
  p.fire([{ target: a, isIntersecting: true }, { target: b, isIntersecting: true }]);
  assert.ok(a.set.has('in') && b.set.has('in'));
  assert.ok(!p.observed.has(a), 'a once-only block stops being watched');
  p.fire([{ target: b, isIntersecting: false }]);
  assert.ok(!b.set.has('in'), 'an every-time block hides again to replay');
});

test('nothing is hidden when the visitor asks for less motion, or the browser has no IntersectionObserver', () => {
  assert.ok(!run({ reduce: true, blocks: [block('m-fade')] }).html.has('anim'));
  assert.ok(!run({ io: false, blocks: [block('m-fade')] }).html.has('anim'));
});

test('parallax moves the background layer with the scroll, and not at all for reduced motion', () => {
  const layer = () => ({ style: {}, parentNode: { getBoundingClientRect: () => ({ top: 0, bottom: 400, height: 400 }) } });
  const l = layer();
  const p = run({ layers: [l] });
  assert.equal(l.style.transform, 'translate3d(0, 2.50%, 0)');
  assert.equal(typeof p.handlers.scroll, 'function');
  const still = layer();
  run({ reduce: true, layers: [still] });
  assert.equal(still.style.transform, undefined);
});
