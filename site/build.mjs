/* Site state in, static website out. Pure: no disk, no network. Images are returned as
   references so the caller decides whether to stream them (preview) or upload them.
   Each page is a list of blocks (site/blocks). A site that never saved pages gets pages made from its old settings
   (site/pages.mjs) and exactly the old stylesheet and script, so it builds byte for byte as before (golden test).
   editor: true makes self-contained pages for the page editor's preview, with every block marked and selectable. */
import { readFileSync } from 'node:fs';
import { esc } from './blocks/common.mjs';
import { renderBlocks } from './blocks/registry.mjs';
import { migratePages, resolvePages, isShownPage, pageHref } from './pages.mjs';
import { rootVars } from './theme.mjs';
import { IG, UP } from './bands.mjs';

const asset = n => readFileSync(new URL(`./assets/${n}`, import.meta.url), 'utf8');
const CSS = asset('site.css');
const JS = asset('site.js');
const BLOCKS_CSS = asset('blocks.css');
const MOTION_JS = asset('motion.js');
const BRIDGE_JS = asset('edit-bridge.js');
const EDIT_CSS = '[data-b]{cursor:pointer}[data-b]:hover{outline:2px dashed rgba(47,111,237,.55);outline-offset:-2px}'
  + '.wb-sel{outline:2px solid #2f6fed!important;outline-offset:-2px}.blk-off{display:revert;opacity:.35}'
  + '.blk-empty{margin:1rem;padding:1.2rem;text-align:center;border:1px dashed #8a94a6;color:#5b6577;font:14px system-ui,sans-serif}';
const GRID_W = 800;
export const HEADERS = '/img/*\n  Cache-Control: public, max-age=31536000, immutable\n'
  + "\n/logo.svg\n  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox\n  X-Content-Type-Options: nosniff\n";

export { esc };

const gridSize = p => (p.width > GRID_W ? [GRID_W, Math.round(p.height * GRID_W / p.width)] : [p.width, p.height]);
/* inlined text must not end its <script> or <style> early */
const inline = t => t.replace(/<\/(script|style)/gi, '<\\/$1');

export function build(state, { base = '/', siteUrl = '', editor = false } = {}) {
  const files = new Map(), images = new Map();
  const s = state.settings, st = s.style;
  const byId = new Map([...state.pagePhotos, ...state.galleries.flatMap(g => g.photos)].map(p => [p.id, p]));
  const galById = new Map(state.galleries.map(g => [g.id, g]));
  const shown = state.galleries.filter(g => !g.hidden && g.photos.length);
  const cover = g => byId.get(g.coverPhotoId) || g.photos[0];
  const name = s.siteName || 'Portfolio';
  const site = siteUrl.replace(/\/+$/, '');
  const pic = (p, v) => { const rel = `img/${p.fileKey}-${v}.jpg`; images.set(rel, rel); return base + rel; };
  if (st.logo) images.set(st.logo, st.logo);
  const logo = st.logo ? `<img src="${base}${st.logo}" alt="${esc(name)}" width="64" height="64">`
                       : `<span class="logo-text">${esc(name)}</span>`;
  const fonts = [...new Set([st.headingFont, st.bodyFont])]
    .map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500`).join('&');
  const desc = String(s.about.text || '').replace(/\s+/g, ' ').trim().slice(0, 155);

  const legacy = state.pages == null && !editor;
  const pages = resolvePages(state.pages ?? migratePages(s, state.galleries), state.galleries);
  const live = pages.filter(p => isShownPage(p, galById));
  const nav = live.filter(p => p.inMenu).map(p => `<a href="${pageHref(p, base)}">${esc(p.title)}</a>`).join('');
  const styleCss = rootVars(st) + CSS + (legacy ? '' : BLOCKS_CSS);
  const siteJs = JS + (legacy ? '' : MOTION_JS);
  const cssTag = editor ? `<style>${inline(styleCss + EDIT_CSS)}</style>` : `<link rel="stylesheet" href="${base}style.css">`;
  const jsTag = editor ? `<script>${inline(siteJs)}</script>\n<script>${inline(BRIDGE_JS)}</script>`
                       : `<script src="${base}site.js" defer></script>`;

  function page(title, body, path, { og = null, head = '', description = desc } = {}) {
    const full = title ? `${title} - ${name}` : name;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(full)}">
${og && site ? `<meta property="og:image" content="${esc(site + og)}">` : ''}
${site ? `<link rel="canonical" href="${esc(site + path)}">` : ''}
${st.logo ? `<link rel="icon" href="${base}${st.logo}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${fonts}&display=swap" rel="stylesheet">
${cssTag}
${head}
</head>
<body>
<header class="top">
  <a class="logo" href="${base}">${logo}</a>
  <nav>${nav}</nav>
</header>
<main>
${body}
</main>
<footer class="foot">
  <span>${esc(s.footer.copyright)}</span>
  ${s.footer.instagram ? `<a class="ig" href="${esc(s.footer.instagram)}" aria-label="Instagram" target="_blank" rel="noopener">${IG}</a>` : '<span></span>'}
  <a class="totop" href="#" aria-label="Back to top">${UP}</a>
</footer>
${jsTag}
</body>
</html>
`;
  }
  /* og images are absolute, so they are built from the published path, not the preview one */
  const ogOf = p => (p ? `/img/${p.fileKey}-full.jpg` : null);

  for (const p of editor ? pages : live) {
    /* og and head live in closure variables, not on ctx, so blocks given a copy of ctx (columns) still report them */
    let og = null, head = '';
    const ctx = {
      base, editor, siteName: name, style: st, shownGalleries: shown, cover, pic, gridSize,
      photo: id => (id == null ? null : byId.get(id) || null),
      gallery: id => galById.get(id) || null,
      pageHref: id => { const t = live.find(x => x.id === id); return t ? pageHref(t, base) : null; },
      setOg(ph) { if (ph && !og) og = ph; },
      addHead(h) { head += h; },
      renderBlocks,
    };
    const body = renderBlocks(p.blocks, ctx);
    const title = p.slug ? (p.seoTitle || p.title) : p.seoTitle;
    files.set(p.slug ? `${p.slug}/index.html` : 'index.html',
      page(title, body, p.slug ? `/${p.slug}/` : '/', { og: ogOf(og), head, description: p.seoDescription || desc }));
  }

  files.set('404.html', page('Not found', `<section class="contact"><h2>Page not found</h2><a href="${base}">Back to home</a></section>`, '/404'));
  files.set('style.css', styleCss);
  files.set('site.js', siteJs);
  files.set('_headers', HEADERS);
  return { files, images };
}
