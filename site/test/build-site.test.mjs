import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../build.mjs';
import { migratePages } from '../pages.mjs';
import { migrateSite, cleanSite } from '../sitewide.mjs';
import { rootVars } from '../theme.mjs';
import { viewerScript, WORDING_DEFAULTS } from '../wording.mjs';
import { state } from './fixtures.mjs';

const asset = n => readFileSync(new URL(`../assets/${n}`, import.meta.url), 'utf8');
const pagesSaved = () => { const s = state(); s.pages = migratePages(s.settings, s.galleries); return s; };
/* a site whose header, footer, theme and wording were saved, after edit(site) */
const own = (edit = () => {}) => { const s = pagesSaved(); const m = migrateSite(s.settings); edit(m, s); const r = cleanSite(m); assert.deepEqual(r.errors, []); s.site = r.site; return s; };

test('saving the header, footer, theme and wording unchanged changes no page; only the stylesheet and script grow', () => {
  const old = build(pagesSaved()), now = build(own());
  assert.deepEqual([...now.files.keys()].sort(), [...old.files.keys()].sort());
  const st = state().settings.style;
  for (const [k, v] of old.files) {
    if (k === 'style.css') assert.equal(now.files.get(k), rootVars({ ...st, accent: st.ink }, { accent: true }) + v.slice(rootVars(st).length) + asset('bands.css'));
    else if (k === 'site.js') assert.equal(now.files.get(k), v + asset('bands.js') + viewerScript(WORDING_DEFAULTS));
    else assert.equal(now.files.get(k), v, k);
  }
  assert.deepEqual([...now.images].sort(), [...old.images].sort());
});

test('theme values reach the stylesheet, the fonts link and the photo grids', () => {
  const s = own(m => Object.assign(m.theme, { page: '#010203', accent: '#aa0000', headingFont: 'Lora', bodyFont: 'Inter', textSize: 'larger', gap: 'roomy', cardShape: 'wide', colsDesktop: 3, colsPhone: 1 }));
  const { files } = build(s);
  assert.match(files.get('style.css'), /^:root\{--page:#010203;.*--font-head:'Lora',system-ui,sans-serif;--font-body:'Inter',.*--scale:1\.12;--gap:2rem;--card-ratio:3 \/ 2;--accent:#aa0000\}\n/);
  assert.match(files.get('index.html'), /family=Lora:wght@400;500&family=Inter:wght@400;500&display=swap/);
  assert.match(files.get('Autumn-Wedding/index.html'), /data-cols="3" data-cols-phone="1"/);
});

test('the logo still comes from the logo upload, and the site name from the site', () => {
  const s = own(m => { m.name = 'New <Name>'; });
  s.settings.style = { ...s.settings.style, logo: 'logo.png' };
  const { files, images } = build(s);
  assert.match(files.get('index.html'), /<title>New &lt;Name&gt;<\/title>/);
  assert.match(files.get('index.html'), /<a class="logo" href="\/"><img src="\/logo\.png" alt="New &lt;Name&gt;" width="64" height="64"><\/a>/);
  assert.ok(images.has('logo.png'));
});

test('the wording reaches the not-found page, the footer and the photo viewer', () => {
  const s = own(m => Object.assign(m.wording, { notFoundTitle: 'Nicht gefunden', notFoundHeading: 'Hoppla <x>', backHome: 'Zur Startseite', toTop: 'Nach oben', viewerClose: 'Zu' }));
  const { files } = build(s);
  assert.match(files.get('404.html'), /<title>Nicht gefunden - Example Studio<\/title>/);
  assert.match(files.get('404.html'), /<h2>Hoppla &lt;x&gt;<\/h2><a href="\/">Zur Startseite<\/a>/);
  assert.match(files.get('index.html'), /<a class="totop" href="#" aria-label="Nach oben">/);
  assert.ok(files.get('site.js').endsWith(viewerScript({ ...WORDING_DEFAULTS, viewerClose: 'Zu' })));
});

test('a new header shows on every page; addresses resolve against the preview address', () => {
  const s = own(m => {
    m.header.elements = [{ id: 'e1', type: 'siteName' }, { id: 'e2', type: 'menu', props: { items: [{ id: 'm1', kind: 'link', label: 'Shop', url: '/shop/' }, { id: 'm2', kind: 'page', pageId: 'about' }], phone: 'button' } },
      { id: 'e3', type: 'button', props: { label: 'Book', link: { kind: 'page', pageId: 'contact' } } }];
    m.header.style.sticky = true;
  });
  const { files } = build(s, { base: '/admin/site-preview/' });
  for (const f of ['index.html', 'about/index.html', 'Autumn-Wedding/index.html', '404.html']) {
    assert.match(files.get(f), /<header class="top sticky">\n  <a class="site-name" href="\/admin\/site-preview\/">Example Studio<\/a>\n/, f);
    assert.match(files.get(f), /<nav class="nav-c"><a href="\/admin\/site-preview\/shop\/">Shop<\/a><a href="\/admin\/site-preview\/about\/">About<\/a><a href="\/admin\/site-preview\/">Home<\/a><a href="\/admin\/site-preview\/contact\/">Contact<\/a><\/nav>/, f);
    assert.match(files.get(f), /<a class="hbtn hbtn-solid" href="\/admin\/site-preview\/contact\/">Book<\/a>/, f);
  }
});

test('the editor preview marks the bands and their elements; the published site does not', () => {
  const s = own();
  const ed = build(s, { base: '/admin/site-preview/', editor: true }).files.get('index.html');
  assert.match(ed, /<header class="top" data-band="header">\n  <div class="el" data-e="hd-logo"><a class="logo"/);
  assert.match(ed, /<footer class="foot" data-band="footer">/);
  assert.match(ed, /<style>[^]*\.nav-t \{[^]*:is\(\[data-b\],\[data-e\],\[data-band\]\)\{cursor:pointer\}/);
  const pub = build(s).files.get('index.html');
  assert.doesNotMatch(pub, /data-e=|data-band=/);
});

test('an unsaved site in the editor preview gets the band styles too, so a new header looks right before it is saved', () => {
  const ed = build(pagesSaved(), { editor: true }).files.get('index.html');
  assert.match(ed, /\.nav-t \{/);
  assert.match(ed, /data-band="header"/);
});

test('a saved site gets all four assets together; the editor preview always does', () => {
  const pubOwn = build(own()), ed = build(pagesSaved(), { editor: true }).files.get('index.html');
  const sets = [asset('blocks.css'), asset('motion.js'), asset('bands.css'), asset('bands.js')];
  const css = pubOwn.files.get('style.css'), js = pubOwn.files.get('site.js');
  assert.ok(css.includes(sets[0]) && css.includes(sets[2]));
  assert.ok(js.includes(sets[1]) && js.includes(sets[3]));
  for (const a of sets) assert.ok(ed.includes(a.replace(/<\/(script|style)/gi, '<\\/$1')), 'editor preview has every asset');
  /* a site with no saved pages, no saved site, not the editor, stays exactly as before */
  const plain = build(state());
  assert.ok(!plain.files.get('style.css').includes(sets[2]) && !plain.files.get('site.js').includes(sets[3]));
});

test('an empty copyright and an empty Instagram link still leave the footer\'s empty placeholders, as before', () => {
  for (const [copyright, instagram, mid] of [['', '', '<span></span>'], ['', 'https://x.com/a', null], ['c', '', '<span></span>']]) {
    const s = pagesSaved(); s.settings.footer = { copyright, instagram };
    const saved = own(m => { m.footer.elements[0].props.text = copyright; m.footer.elements[1].props.url = instagram; });
    for (const st of [s, saved]) {
      const html = build(st).files.get('index.html');
      const foot = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
      assert.ok(foot.startsWith(`<footer class="foot">\n  <span>${copyright}</span>\n  ${mid ?? '<a class="ig" href="https://x.com/a"'}`), foot);
    }
  }
});

test('unusual footer settings never make the build throw', () => {
  const s = pagesSaved(); s.settings.footer = { copyright: '<b>x</b>', instagram: 'javascript:alert(1)' };
  const html = build(s).files.get('index.html');
  assert.doesNotMatch(html, /<b>x/);
  /* the store only accepts https links; the builder writes what it is given, escaped, as it always did */
  assert.match(html, /<span>&lt;b&gt;x&lt;\/b&gt;<\/span>/);
  const e = build(s, { editor: true });
  assert.ok(e.files.get('index.html').includes('data-band="footer"'));
});

test('the Menu wording is escaped in the phone menu button and the scripts stay closed', () => {
  const s = own(m => { m.wording.menu = 'M"<b>'; m.header.elements[1].props.phone = 'button'; });
  const html = build(s).files.get('index.html');
  assert.match(html, /aria-label="M&quot;&lt;b&gt;"/);
  assert.doesNotMatch(html, /M"<b>/);
  const ed = build(own(m => { m.wording.viewerClose = '</script><i>'; }), { editor: true }).files.get('index.html');
  assert.equal((ed.match(/<script>/g) || []).length, 2);
  assert.equal((ed.match(/<\/script>/g) || []).length, 2);
});

test('a wording label that looks like an HTML comment cannot break the editor preview scripts', () => {
  const ed = build(own(m => { m.wording.viewerClose = '<!--<script>'; }), { editor: true }).files.get('index.html');
  assert.ok(!ed.includes('<!--<script>'));
  assert.equal((ed.match(/<script/g) || []).length, 2);
  assert.equal((ed.match(/<\/script>/g) || []).length, 2);
  assert.ok(!build(own(m => { m.wording.viewerClose = '<!--<script>'; })).files.get('site.js').includes('<'.concat('!--')));
});

test('a saved site with no saved pages, published, ships all four assets and the viewer script', () => {
  const s = state(); s.site = cleanSite(migrateSite(s.settings)).site;
  assert.equal(s.pages, undefined);
  const { files } = build(s);
  const css = files.get('style.css'), js = files.get('site.js');
  assert.ok(css.includes(asset('blocks.css')) && css.includes(asset('bands.css')));
  assert.ok(js.includes(asset('motion.js')) && js.includes(asset('bands.js')));
  assert.ok(js.endsWith(viewerScript(WORDING_DEFAULTS)));
});
