import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const siteAdmin = rd('web/site-admin.js');

test('the old Style tab and the Pages tab’s site name and footer fields are gone, and nothing refers to them', () => {
  assert.doesNotMatch(siteAdmin, /styleScreen|fontSample|\["style","Style"\]|send\("\/settings"|dirtyForm/);
  for (const f of ['web/admin.html', 'web/builder-admin.js', 'web/sitewide-admin.js', 'web/site-admin.js', 'web/design-admin.js', 'web/home.js']) {
    assert.doesNotMatch(rd(f), /\b(wsn|wfc|wfi|wsavep|wsaves|wsreset|wlogo|wlogox|wsample|wshf|wsbf)\b/, f);
  }
  assert.match(siteAdmin, /The header and its menu, the footer, the theme \(colours, fonts, sizes, spacing and logo\)/);
  assert.match(siteAdmin, /if \(W\.screen === "style"\) W\.screen = "pages";/, 'a remembered Style tab opens Pages instead');
  assert.match(rd('site/blocks/photo-grid.mjs'), /\[0, 'Same as the theme'\]/);
});

test('the logo routes and the settings route stay for the editor and for restoring older versions', () => {
  const routes = rd('site/routes.mjs');
  assert.match(routes, /path === '\/api\/admin\/site\/logo' && m === 'POST'/);
  assert.match(routes, /path === '\/api\/admin\/site\/logo' && m === 'DELETE'/);
  assert.match(routes, /path === '\/api\/admin\/site\/settings' && m === 'PUT'/);
});
