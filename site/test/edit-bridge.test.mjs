import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const BRIDGE = readFileSync(new URL('../assets/edit-bridge.js', import.meta.url), 'utf8');

/* a pretend preview: a header holding one element, a block, and the page around them */
function page() {
  const sent = [], on = {}, marked = new Set();
  const node = (data, parent = null) => ({
    dataset: data, parent, classList: { add: c => marked.add(`${JSON.stringify(data)}:${c}`), remove: c => marked.delete(`${JSON.stringify(data)}:${c}`) },
    scrollIntoView() {},
    closest(sel) {
      for (let n = this; n; n = n.parent) {
        const keys = Object.keys(n.dataset);
        if (sel.split(',').some(s => keys.includes({ '[data-b]': 'b', '[data-e]': 'e', '[data-band]': 'band' }[s]))) return n;
      }
      return null;
    },
  });
  const header = node({ band: 'header' }), logo = node({ e: 'hd-logo' }, header), inLogo = node({}, logo), block = node({ b: 'home-cards' }), body = node({});
  const all = { 'data-band="header"': header, 'data-e="hd-logo"': logo, 'data-b="home-cards"': block };
  const win = {
    self: { origin: 'https://admin.example' }, scrollY: 0,
    addEventListener: (t, f) => { on[t] = f; },
    CSS: { escape: s => s }, setTimeout, clearTimeout, scrollTo() {},
    document: { querySelector: sel => all[sel.slice(1, -1)] || null },
  };
  win.parent = { postMessage: (m, o) => sent.push([m, o]) };
  win.window = win;
  vm.runInNewContext(BRIDGE, win);
  const click = target => on.click({ target, preventDefault() {}, stopPropagation() {} });
  const message = data => on.message({ origin: 'https://admin.example', source: win.parent, data });
  return { sent, click, message, marked, inLogo, header, block, body };
}

test('a click on a header element, the header, a block or nothing tells the editor which, and follows no link', () => {
  const p = page();
  p.click(p.inLogo); p.click(p.header); p.click(p.block); p.click(p.body);
  assert.deepEqual(p.sent.map(([m]) => JSON.parse(JSON.stringify(m))), [
    { type: 'wb-select', id: 'hd-logo', band: 'header' }, { type: 'wb-select', id: null, band: 'header' },
    { type: 'wb-select', id: 'home-cards', band: null }, { type: 'wb-select', id: null, band: null }]);
  assert.ok(p.sent.every(([, o]) => o === 'https://admin.example'));
});

test('the editor highlights a block, an element or a band by its kind', () => {
  const p = page();
  p.message({ type: 'wb-select', id: 'hd-logo', kind: 'e' });
  assert.deepEqual([...p.marked], ['{"e":"hd-logo"}:wb-sel']);
  p.message({ type: 'wb-select', id: 'header', kind: 'band' });
  assert.deepEqual([...p.marked], ['{"band":"header"}:wb-sel']);
  p.message({ type: 'wb-select', id: 'home-cards' });
  assert.deepEqual([...p.marked], ['{"b":"home-cards"}:wb-sel'], 'no kind is a block, as before');
});
