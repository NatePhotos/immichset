import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FONTS, THEME_DEFAULTS, THEME_SCHEMA, cleanTheme, themeFromStyle, rootVars } from '../theme.mjs';
import { FONTS as STORE_FONTS, DEFAULT_STYLE } from '../store.mjs';

test('the theme describes every value it has, and its defaults are today’s look', () => {
  assert.deepEqual(THEME_SCHEMA.map(f => f.key), Object.keys(THEME_DEFAULTS));
  assert.deepEqual(themeFromStyle(DEFAULT_STYLE), THEME_DEFAULTS);
  assert.equal(STORE_FONTS, FONTS, 'one list of fonts');
});

test('colours must be six-digit, fonts must be on the list, sizes must be known', () => {
  const r = cleanTheme({ ...THEME_DEFAULTS, page: 'red', accent: '#ABCDEF', headingFont: 'Comic Sans', textSize: 'huge', colsDesktop: 9 });
  assert.deepEqual(Object.keys(r.errors).sort(), ['colsDesktop', 'headingFont', 'page', 'textSize']);
  assert.equal(r.theme.page, THEME_DEFAULTS.page);
  assert.equal(r.theme.accent, '#abcdef');
  assert.equal(r.theme.headingFont, 'Roboto');
  assert.deepEqual(cleanTheme(THEME_DEFAULTS), { theme: { ...THEME_DEFAULTS }, errors: {} });
  assert.deepEqual(cleanTheme('nope').theme, { ...THEME_DEFAULTS });
});

test('the CSS variables are written as before, with the accent only when asked for', () => {
  const old = ":root{--page:#f4f5f0;--band:#e3e8df;--text:#373737;--ink:#343b2f;--font-head:'Roboto',system-ui,sans-serif;"
    + "--font-body:'Figtree',system-ui,sans-serif;--scale:1;--gap:.68rem;--card-ratio:226 / 276}\n";
  assert.equal(rootVars(DEFAULT_STYLE), old);
  assert.equal(rootVars({ ...THEME_DEFAULTS, accent: '#aa0000' }, { accent: true }), old.replace('}\n', ';--accent:#aa0000}\n'));
});
