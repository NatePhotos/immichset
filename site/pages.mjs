/* The website's pages. A site that has never saved pages gets them made from its old settings (Home, a page per
   gallery, About, Contact), on the fly and without writing anything, so an old site builds exactly as before.
   Gallery pages follow their galleries: a new gallery gets a page, a deleted one loses its page, and a gallery page
   always has its gallery's name and address. Pure. */
import { validateBlocks, countBlocks, BLOCK_TYPES } from './blocks/registry.mjs';
import { text, STYLE_DEFAULTS, MOTION_DEFAULTS } from './blocks/common.mjs';

export const PAGE_LIMITS = Object.freeze({ pages: 40, blocks: 80, title: 120, seoTitle: 120, seoDescription: 300, slug: 60 });
/* addresses the built site uses for itself; every other reserved name in store.mjs (about, contact, files) is either
   a page of its own or cannot match the slug pattern */
export const RESERVED_PAGE_SLUGS = new Set(['img']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

const block = (id, type, props) => ({ id, type, props: { ...structuredClone(BLOCK_TYPES.get(type).defaults), ...props },
  style: { ...STYLE_DEFAULTS }, motion: { ...MOTION_DEFAULTS } });
const page = (id, title, slug, blocks) => ({ id, title, slug, inMenu: true, seoTitle: '', seoDescription: '', galleryId: null, blocks });

export function galleryPage(g) {
  return { id: `g${g.id}`, title: g.title, slug: g.slug, inMenu: false, seoTitle: '', seoDescription: '', galleryId: g.id,
           blocks: [block(`g${g.id}-grid`, 'photo-grid', { galleryId: g.id })] };
}

export function migratePages(s, galleries) {
  return [
    page('home', 'Home', '', [block('home-cards', 'gallery-cards', {})]),
    ...galleries.map(galleryPage),
    page('about', 'About', 'about', [block('about-main', 'image-text', { photoId: s.about.photoId, heading: s.about.heading, text: s.about.text })]),
    page('contact', 'Contact', 'contact', [
      block('contact-banner', 'hero', { photoId: s.contact.bannerPhotoId, heading: 'Contact' }),
      block('contact-details', 'contact', { heading: s.contact.heading, email: s.contact.email, phone: s.contact.phone }),
    ]),
  ];
}

export function resolvePages(pages, galleries) {
  const byId = new Map(galleries.map(g => [g.id, g]));
  const out = pages.filter(p => p.galleryId == null || byId.has(p.galleryId))
    .map(p => (p.galleryId == null ? p : { ...p, title: byId.get(p.galleryId).title, slug: byId.get(p.galleryId).slug }));
  const have = new Set(out.map(p => p.galleryId).filter(id => id != null));
  for (const g of galleries) {
    if (have.has(g.id)) continue;
    let at = out.findLastIndex(p => p.galleryId != null);
    if (at < 0) at = out.findIndex(p => p.slug === '');
    out.splice(at + 1, 0, galleryPage(g));
  }
  return out;
}

/* a gallery's page is left off the site while the gallery is hidden or has no photos, as before */
export function isShownPage(p, galleriesById) {
  if (p.galleryId == null) return true;
  const g = galleriesById.get(p.galleryId);
  return !!(g && !g.hidden && g.photos.length);
}

export const pageHref = (p, base) => base + (p.slug ? `${encodeURIComponent(p.slug)}/` : '');

export function cleanPages(raw, { galleries, photoIds }) {
  if (!Array.isArray(raw)) return { pages: null, errors: ['Pages must be a list'] };
  const errors = [];
  if (raw.length > PAGE_LIMITS.pages) errors.push(`A site can have at most ${PAGE_LIMITS.pages} pages`);
  const gal = new Map(galleries.map(g => [g.id, g]));
  const gallerySlugs = new Set(galleries.map(g => g.slug.toLowerCase()));
  const vctx = { photoIds, galleryIds: new Set(gal.keys()), blockIds: new Set(), depth: 0 };
  const seenIds = new Set(), seenSlugs = new Set(), pages = [];
  raw.slice(0, PAGE_LIMITS.pages).forEach((p, i) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) { errors.push(`Page ${i + 1} is not a page`); return; }
    const id = String(p.id ?? '');
    if (!ID.test(id) || seenIds.has(id)) { errors.push(`Page ${i + 1} has a missing or repeated id`); return; }
    seenIds.add(id);
    const galleryId = Number.isInteger(p.galleryId) ? p.galleryId : null;
    if (galleryId != null && !gal.has(galleryId)) return;            /* its gallery was deleted: the page goes too */
    const g = galleryId != null ? gal.get(galleryId) : null;
    const title = g ? g.title : text(p.title, PAGE_LIMITS.title);
    const name = `"${title || `Page ${i + 1}`}"`;
    if (!title) errors.push(`${name}: give the page a name`);
    const slug = g ? g.slug : String(p.slug ?? '').trim().toLowerCase();
    if (!g && slug !== '') {
      if (!SLUG.test(slug) || slug.length > PAGE_LIMITS.slug) errors.push(`${name}: a web address can only use a-z, 0-9 and dashes`);
      else if (RESERVED_PAGE_SLUGS.has(slug)) errors.push(`${name}: /${slug}/ is used by the site itself`);
      else if (gallerySlugs.has(slug)) errors.push(`${name}: /${slug}/ is a gallery’s address`);
    }
    if (seenSlugs.has(slug.toLowerCase())) errors.push(`${name}: another page already uses /${slug}${slug ? '/' : ''}`);
    seenSlugs.add(slug.toLowerCase());
    const r = validateBlocks(p.blocks, vctx);
    for (const e of r.errors) errors.push(`${name}: ${e}`);
    if (countBlocks(r.blocks) > PAGE_LIMITS.blocks) errors.push(`${name}: at most ${PAGE_LIMITS.blocks} blocks on a page`);
    if (r.blocks.filter(b => b.type === 'photo-grid').length > 1) errors.push(`${name}: a page can hold one photo grid`);
    pages.push({ id, title, slug, inMenu: p.inMenu === true, seoTitle: text(p.seoTitle, PAGE_LIMITS.seoTitle),
                 seoDescription: text(p.seoDescription, PAGE_LIMITS.seoDescription), galleryId, blocks: r.blocks });
  });
  if (pages.filter(p => p.slug === '').length !== 1) errors.push('Keep exactly one home page');
  return errors.length ? { pages: null, errors } : { pages, errors: [] };
}
