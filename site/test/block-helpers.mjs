/* What block tests need: a render context like the one build.mjs makes, and a quick way to make a checked block. */
import { state } from './fixtures.mjs';
import { validateBlock, renderBlocks } from '../blocks/registry.mjs';

export function blockCtx(over = {}) {
  const s = state();
  const photos = [...s.pagePhotos, ...s.galleries.flatMap(g => g.photos)];
  const byId = new Map(photos.map(p => [p.id, p]));
  const images = new Map();
  return {
    base: '/', editor: false, siteName: 'Example Studio', style: s.settings.style, images,
    shownGalleries: s.galleries.filter(g => !g.hidden && g.photos.length),
    cover: g => byId.get(g.coverPhotoId) || g.photos[0],
    pic: (p, v) => { const rel = `img/${p.fileKey}-${v}.jpg`; images.set(rel, rel); return '/' + rel; },
    gridSize: p => (p.width > 800 ? [800, Math.round(p.height * 800 / p.width)] : [p.width, p.height]),
    photo: id => (id == null ? null : byId.get(id) || null),
    gallery: id => s.galleries.find(g => g.id === id) || null,
    pageHref: id => ({ home: '/', about: '/about/', contact: '/contact/' })[id] ?? null,
    og: null, head: '',
    setOg(p) { if (p && !this.og) this.og = p; },
    addHead(h) { this.head += h; },
    renderBlocks,
    ...over,
  };
}

export function mk(id, type, props = {}, style = {}, motion = {}) {
  const r = validateBlock({ id, type, props, style, motion }, {});
  if (!r.block || r.errors.length) throw new Error(`test block ${id}: ${r.errors.join('; ')}`);
  return r.block;
}
