import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { WORDING_DEFAULTS, WORDING_SCHEMA, cleanWording, viewerScript } from '../wording.mjs';

const SITE_JS = readFileSync(new URL('../assets/site.js', import.meta.url), 'utf8');

test('every piece of fixed wording is described, and its default is today’s text', () => {
  assert.deepEqual(WORDING_SCHEMA.map(f => f.key), Object.keys(WORDING_DEFAULTS));
  assert.match(SITE_JS, /aria-label="Close".*aria-label="Previous".*aria-label="Next"/s, 'the viewer still names its buttons like this');
  assert.deepEqual(cleanWording({}), { wording: { ...WORDING_DEFAULTS }, errors: {} });
});

test('wording is trimmed and cut to length; emptied wording goes back to its default', () => {
  const { wording } = cleanWording({ notFoundHeading: '  Oops <b>  ', backHome: '', viewerClose: 'x'.repeat(100), menu: 42 });
  assert.equal(wording.notFoundHeading, 'Oops <b>', 'escaped where it is written, not here');
  assert.equal(wording.backHome, 'Back to home');
  assert.equal(wording.viewerClose.length, 40);
  assert.equal(wording.menu, '42');
});

test('the viewer script renames the buttons site.js made, and nothing else', () => {
  const made = {};
  const btn = sel => ({ setAttribute: (k, v) => { made[sel] = [k, v]; } });
  const document = { querySelector: s => (/^\.lb \.lb-(close|prev|next)$/.test(s) ? btn(s) : null) };
  vm.runInNewContext(viewerScript({ ...WORDING_DEFAULTS, viewerClose: 'Schließen "x"', viewerNext: '</script>' }), { document });
  assert.deepEqual(made, { '.lb .lb-close': ['aria-label', 'Schließen "x"'], '.lb .lb-prev': ['aria-label', 'Previous'], '.lb .lb-next': ['aria-label', '</script>'] });
  vm.runInNewContext(viewerScript(WORDING_DEFAULTS), { document: { querySelector: () => null } });
});
