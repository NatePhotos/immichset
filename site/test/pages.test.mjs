import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratePages, resolvePages, cleanPages, pageHref, isShownPage, PAGE_LIMITS } from '../pages.mjs';
import { state } from './fixtures.mjs';

const gals = s => s.galleries.map(({ id, slug, title }) => ({ id, slug, title }));
const check = (pages, s = state()) => cleanPages(pages, { galleries: gals(s), photoIds: new Set([1, 2, 3, 90, 91]) });
const extra = (id, slug, blocks = []) => ({ id, title: `Page ${id}`, slug, inMenu: false, seoTitle: '', seoDescription: '', galleryId: null, blocks });

test('the old fixed pages become blocks: home cards, a grid per gallery, About, Contact', () => {
  const s = state(), p = migratePages(s.settings, s.galleries);
  assert.deepEqual(p.map(x => [x.id, x.slug, x.inMenu, x.galleryId]), [['home', '', true, null], ['g1', 'Autumn-Wedding', false, 1],
    ['g2', 'Secret', false, 2], ['g3', 'Empty', false, 3], ['about', 'about', true, null], ['contact', 'contact', true, null]]);
  assert.deepEqual(p.map(x => x.title), ['Home', 'Autumn Wedding', 'Secret', 'Empty', 'About', 'Contact']);
  assert.deepEqual(p[0].blocks.map(b => [b.id, b.type]), [['home-cards', 'gallery-cards']]);
  assert.deepEqual(p[1].blocks.map(b => [b.id, b.type, b.props.galleryId]), [['g1-grid', 'photo-grid', 1]]);
  assert.deepEqual(p[4].blocks[0].props, { photoId: 90, heading: 'About', text: 'Hello <script>x</script>\n\nSecond', alt: '', photoSide: 'left', hover: 'none' });
  assert.deepEqual(p[5].blocks.map(b => b.type), ['hero', 'contact']);
  assert.deepEqual([p[5].blocks[0].props.photoId, p[5].blocks[0].props.heading], [91, 'Contact']);
  assert.deepEqual(p[5].blocks[1].props, { heading: 'Contact us', email: 'someone@example.com', phone: '555 0100' });
});

test('pages follow the galleries: new ones get a page, deleted ones lose theirs, renames carry over', () => {
  const s = state();
  const pages = migratePages(s.settings, s.galleries.slice(0, 2));
  const now = [{ ...s.galleries[0], title: 'Renamed', slug: 'Autumn-Wedding' }, s.galleries[2]];
  const r = resolvePages(pages, now);
  assert.deepEqual(r.map(p => p.id), ['home', 'g1', 'g3', 'about', 'contact']);
  assert.equal(r[1].title, 'Renamed');
  assert.equal(r[2].blocks[0].type, 'photo-grid');
  assert.deepEqual(resolvePages([], s.galleries.slice(0, 1)).map(p => p.id), ['g1']);
});

test('the page of a hidden or empty gallery is not shown; other pages are', () => {
  const s = state(), by = new Map(s.galleries.map(g => [g.id, g]));
  const p = migratePages(s.settings, s.galleries);
  assert.deepEqual(p.filter(x => isShownPage(x, by)).map(x => x.id), ['home', 'g1', 'about', 'contact']);
});

test('page links carry the base and encode the address', () => {
  assert.equal(pageHref({ slug: '' }, '/admin/site-preview/'), '/admin/site-preview/');
  assert.equal(pageHref({ slug: 'about' }, '/'), '/about/');
  assert.equal(pageHref({ slug: 'a b' }, '/'), '/a%20b/');
});

test('pages made from the old settings pass the checks unchanged', () => {
  const s = state(), p = migratePages(s.settings, s.galleries);
  const r = check(p, s);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.pages, p);
});

test('web addresses: lower-case, unique, not the site’s own, not a gallery’s', () => {
  const s = state(), base = migratePages(s.settings, s.galleries);
  assert.match(check([...base, extra('pa', 'img')]).errors.join('\n'), /\/img\/ is used by the site itself/);
  assert.match(check([...base, extra('pb', 'autumn-wedding')]).errors.join('\n'), /\/autumn-wedding\/ is a gallery’s address/);
  assert.match(check([...base, extra('pc', 'about')]).errors.join('\n'), /another page already uses \/about\//);
  assert.match(check([...base, extra('pd', 'Bad Slug!')]).errors.join('\n'), /only use a-z, 0-9 and dashes/);
  assert.deepEqual(check([...base, extra('pe', 'news')]).errors, []);
});

test('exactly one home page; at most one photo grid per page', () => {
  const s = state(), base = migratePages(s.settings, s.galleries);
  assert.match(check(base.filter(p => p.id !== 'home')).errors.join('\n'), /Keep exactly one home page/);
  const two = [...base, extra('pf', 'twice', [{ id: 'q1', type: 'photo-grid', props: { galleryId: 1 } }, { id: 'q2', type: 'photo-grid', props: { galleryId: 1 } }])];
  assert.match(check(two).errors.join('\n'), /"Page pf": a page can hold one photo grid/);
});

test('missing photos become empty, and the page of a deleted gallery is dropped', () => {
  const s = state(), p = migratePages(s.settings, s.galleries);
  p.find(x => x.id === 'about').blocks[0].props.photoId = 999;
  p.push({ ...extra('g77', 'Gone'), galleryId: 77 });
  const r = check(p, s);
  assert.deepEqual(r.errors, []);
  assert.equal(r.pages.find(x => x.id === 'about').blocks[0].props.photoId, null);
  assert.ok(!r.pages.some(x => x.id === 'g77'));
});

test('a gallery page always takes its gallery’s name and address', () => {
  const s = state(), p = migratePages(s.settings, s.galleries);
  Object.assign(p[1], { title: 'Mine', slug: 'mine' });
  const r = check(p, s);
  assert.deepEqual([r.pages[1].title, r.pages[1].slug], ['Autumn Wedding', 'Autumn-Wedding']);
});

test('block problems name the page and the block', () => {
  const s = state(), p = migratePages(s.settings, s.galleries);
  p[0].blocks.push({ id: 'zz1', type: 'nope' });
  assert.equal(check(p, s).errors[0], '"Home": unknown block type "nope"');
});

test('limits on the number of pages and blocks', () => {
  const s = state(), base = migratePages(s.settings, s.galleries);
  const many = Array.from({ length: PAGE_LIMITS.pages }, (_, i) => extra(`p${i}`, `p${i}`));
  assert.match(check([...base, ...many]).errors.join('\n'), /at most 40 pages/);
  const big = extra('pbig', 'big', Array.from({ length: PAGE_LIMITS.blocks + 1 }, (_, i) => ({ id: `s${i}`, type: 'spacer' })));
  assert.match(check([...base, big]).errors.join('\n'), /"Page pbig": at most 80 blocks on a page/);
  assert.match(check('nope').errors[0], /Pages must be a list/);
});
