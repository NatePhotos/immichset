/* Site state in, static website out. Pure: no disk, no network. Images are returned as
   references so the caller decides whether to stream them (preview) or upload them. */
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('./assets/site.css', import.meta.url), 'utf8');
const JS = readFileSync(new URL('./assets/site.js', import.meta.url), 'utf8');
const GAPS = { none: '0rem', tight: '.68rem', normal: '1.2rem', roomy: '2rem' };
const RATIOS = { tall: '226 / 276', square: '1 / 1', wide: '3 / 2' };
const SCALES = { smaller: 0.9, normal: 1, larger: 1.12 };
const GRID_W = 800;
export const HEADERS = '/img/*\n  Cache-Control: public, max-age=31536000, immutable\n'
  + "\n/logo.svg\n  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox\n  X-Content-Type-Options: nosniff\n";

export const esc = t => String(t ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const IG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">'
  + '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="0.6" fill="currentColor"/></svg>';
const UP = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">'
  + '<path d="M12 20V4M5 11l7-7 7 7"/></svg>';

const paras = t => String(t || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
  .map(s => `<p>${esc(s).replace(/\n/g, '<br>')}</p>`).join('');
const gridSize = p => (p.width > GRID_W ? [GRID_W, Math.round(p.height * GRID_W / p.width)] : [p.width, p.height]);

function rootVars(st) {
  return `:root{--page:${st.page};--band:${st.band};--text:${st.text};--ink:${st.ink};`
    + `--font-head:'${st.headingFont}',system-ui,sans-serif;--font-body:'${st.bodyFont}',system-ui,sans-serif;`
    + `--scale:${SCALES[st.textSize]};--gap:${GAPS[st.gap]};--card-ratio:${RATIOS[st.cardShape]}}\n`;
}

export function build(state, { base = '/', siteUrl = '' } = {}) {
  const files = new Map(), images = new Map();
  const s = state.settings, st = s.style;
  const byId = new Map([...state.pagePhotos, ...state.galleries.flatMap(g => g.photos)].map(p => [p.id, p]));
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

  function page(title, body, path, { og = null, head = '' } = {}) {
    const full = title ? `${title} - ${name}` : name;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(full)}">
${og && site ? `<meta property="og:image" content="${esc(site + og)}">` : ''}
${site ? `<link rel="canonical" href="${esc(site + path)}">` : ''}
${st.logo ? `<link rel="icon" href="${base}${st.logo}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${fonts}&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}style.css">
${head}
</head>
<body>
<header class="top">
  <a class="logo" href="${base}">${logo}</a>
  <nav><a href="${base}">Home</a><a href="${base}about/">About</a><a href="${base}contact/">Contact</a></nav>
</header>
<main>
${body}
</main>
<footer class="foot">
  <span>${esc(s.footer.copyright)}</span>
  ${s.footer.instagram ? `<a class="ig" href="${esc(s.footer.instagram)}" aria-label="Instagram" target="_blank" rel="noopener">${IG}</a>` : '<span></span>'}
  <a class="totop" href="#" aria-label="Back to top">${UP}</a>
</footer>
<script src="${base}site.js" defer></script>
</body>
</html>
`;
  }
  /* og images are absolute, so they are built from the published path, not the preview one */
  const ogOf = p => (p ? `/img/${p.fileKey}-full.jpg` : null);

  const cards = shown.map((g, i) => {
    const c = cover(g); const [w, h] = gridSize(c);
    return `<a class="card" href="${base}${encodeURIComponent(g.slug)}/"><img src="${pic(c, 'grid')}" alt="${esc(g.title)}" width="${w}" height="${h}"${i === 0 ? ' fetchpriority="high"' : ''}>`
      + `<span class="card-title">${esc(g.title)}</span><span class="card-sub">Click For More!</span></a>`;
  }).join('');
  files.set('index.html', page('', `<section class="cards">${cards}</section>`, '/', { og: shown[0] && ogOf(cover(shown[0])) }));

  for (const g of shown) {
    const items = g.photos.map((p, i) => {
      const [w, h] = gridSize(p);
      return `<a class="m-item" href="${pic(p, 'full')}" data-w="${p.width}" data-h="${p.height}">`
        + `<img src="${pic(p, 'grid')}" width="${w}" height="${h}" alt="${esc(g.title)} photo ${i + 1}"${i < 8 ? '' : ' loading="lazy"'} decoding="async"></a>`;
    }).join('');
    const heading = `<h1 class="${g.showTitle ? 'page-title' : 'sr-only'}">${esc(g.title)}</h1>`;
    files.set(`${g.slug}/index.html`, page(g.title,
      `${heading}<section class="masonry" data-cols="${st.colsDesktop}" data-cols-phone="${st.colsPhone}">${items}</section>`,
      `/${g.slug}/`, { og: ogOf(cover(g)) }));
  }

  const a = s.about, ap = byId.get(a.photoId);
  files.set('about/index.html', page('About', `<section class="about">`
    + (ap ? `<img class="about-photo" src="${pic(ap, 'full')}" width="${ap.width}" height="${ap.height}" alt="${esc(name)}">` : '')
    + `<div class="about-card"><h1>${esc(a.heading)}</h1>${paras(a.text)}</div></section>`, '/about/', { og: ogOf(ap) }));

  const c = s.contact, bp = byId.get(c.bannerPhotoId);
  const tel = String(c.phone || '').replace(/[^\d+]/g, '');
  const banner = bp ? `<section class="banner" style="background-image:url('${pic(bp, 'full')}')"><h1>Contact</h1></section>`
                    : '<h1 class="page-title">Contact</h1>';
  const rows = (c.email ? `<div class="label">Email</div><a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '')
             + (c.phone ? `<div class="label">Phone number</div><a href="tel:${esc(tel)}">${esc(c.phone)}</a>` : '');
  files.set('contact/index.html', page('Contact', `${banner}<section class="contact"><h2>${esc(c.heading)}</h2>${rows}</section>`,
    '/contact/', { og: ogOf(bp), head: bp ? `<link rel="preload" as="image" href="${pic(bp, 'full')}">` : '' }));

  files.set('404.html', page('Not found', `<section class="contact"><h2>Page not found</h2><a href="${base}">Back to home</a></section>`, '/404'));
  files.set('style.css', rootVars(st) + CSS);
  files.set('site.js', JS);
  files.set('_headers', HEADERS);
  return { files, images };
}
