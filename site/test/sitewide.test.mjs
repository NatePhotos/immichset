import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateSite, cleanSite, SITE_LIMITS } from '../sitewide.mjs';
import { THEME_DEFAULTS } from '../theme.mjs';
import { WORDING_DEFAULTS } from '../wording.mjs';
import { DEFAULTS } from '../store.mjs';
import { state } from './fixtures.mjs';

test('an unsaved site’s header, footer and theme are made from its settings', () => {
  const s = state().settings;
  const m = migrateSite(s);
  assert.equal(m.name, 'Example Studio');
  assert.deepEqual(m.header.elements.map(e => [e.id, e.type]), [['hd-logo', 'logo'], ['hd-menu', 'menu']]);
  assert.equal(m.header.elements[1].props.phone, 'row', 'the old menu never folds');
  assert.deepEqual(m.footer.elements.map(e => e.props), [{ text: '© Example' }, { network: 'instagram', url: 'https://www.instagram.com/example' }]);
  assert.equal(m.footer.style.toTop, true);
  assert.deepEqual(migrateSite(structuredClone(DEFAULTS)).theme, THEME_DEFAULTS);
  assert.deepEqual(m.wording, WORDING_DEFAULTS);
});

test('what migration makes is always accepted unchanged, so the first save changes nothing', () => {
  for (const s of [state().settings, structuredClone(DEFAULTS)]) {
    const m = migrateSite(s);
    assert.deepEqual(cleanSite(structuredClone(m)), { site: m, errors: [] });
  }
});

test('a bad site is refused with every reason, from every part', () => {
  const m = migrateSite(state().settings);
  m.name = 'n'.repeat(200);
  m.header.elements.push({ id: 'ft-text', type: 'text', props: {}, motion: {} });
  m.footer.style.padding = 'huge';
  m.theme.page = 'pink';
  const r = cleanSite(m);
  assert.equal(r.site, null);
  assert.deepEqual(r.errors, ['Footer, padding: choose one of: Compact, Normal, Roomy', 'Footer: Text: the element id "ft-text" is used twice',
    'Theme, page: use a six-digit colour such as #1a1a1a']);
  assert.deepEqual(cleanSite([]).errors, ['The header, footer, theme and wording are missing']);
  const ok = migrateSite(state().settings); ok.name = 'n'.repeat(200);
  assert.equal(cleanSite(ok).site.name.length, SITE_LIMITS.name);
});
