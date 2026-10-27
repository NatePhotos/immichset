/* The header and footer: the elements a band holds, how each is checked and written, and the band's own style.
   band = { style, elements }; element = { id, type, props, motion, visible }. A site that never saved its header and
   footer gets them made from its old settings (sitewide.mjs migrateSite), and those render to exactly the markup
   build.mjs wrote before. Text is escaped and every address is checked (safeUrl, or a path on this site for menu
   items); there is no way to put HTML or a script in a band. Pure. */
import { cleanFields, esc, text, safeUrl, linkHref, MOTION_SCHEMA, STYLE_SCHEMA } from './blocks/common.mjs';

export const BAND_LIMITS = Object.freeze({ elements: 20, menuItems: 20, label: 60 });
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/* ---- addresses ---- */
const SITE_PATH = /^\/(?![\/\\])[^\s"'<>\\]*$/;
export const MENU_LINK_ERROR = 'menu links must start with https://, http://, mailto:, tel: or / for a page on this site';
/* a menu item may also point at a path on this site, such as /about/ */
export function menuUrl(u) {
  const s = text(u, 300);
  if (!s || /[\u0000-\u001f\u007f]/.test(s)) return '';
  return SITE_PATH.test(s) ? s : safeUrl(s);
}

/* ---- icons: trusted constants, never user text ---- */
const svg = (inner, w = 16, sw = 1.6) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="${sw}" aria-hidden="true">${inner}</svg>`;
export const IG = svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="0.6" fill="currentColor"/>');
export const UP = svg('<path d="M12 20V4M5 11l7-7 7 7"/>', 18, 1.4);
const SOCIAL = {
  instagram: ['Instagram', IG],
  facebook: ['Facebook', svg('<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z"/>')],
  youtube: ['YouTube', svg('<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.5v5l4.5-2.5z"/>')],
  linkedin: ['LinkedIn', svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-7M12 13a3 3 0 0 1 6 0v4"/>')],
};

/* ---- element types ---- */
const plain = t => ({ ...t, validate: props => cleanFields(props, t.fields, t.defaults) });
const tabAttr = p => (p.newTab ? ' target="_blank" rel="noopener noreferrer"' : '');

const logo = plain({
  type: 'logo', label: 'Logo', icon: 'image', hint: 'Upload or remove the logo in Theme. Without one, the site name is shown.',
  defaults: Object.freeze({ size: 'normal' }),
  fields: [{ key: 'size', label: 'Size', kind: 'select', options: [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']] }],
  render: (e, ctx) => `<a class="logo${e.props.size === 'normal' ? '' : ` lg-${e.props.size}`}" href="${ctx.base}">${ctx.logoHtml}</a>`,
});
const siteName = plain({
  type: 'siteName', label: 'Site name', icon: 'type', hint: 'The name itself is set at the top of the Header panel.',
  defaults: Object.freeze({}), fields: [],
  render: (e, ctx) => (ctx.siteName ? `<a class="site-name" href="${ctx.base}">${esc(ctx.siteName)}</a>` : ''),
});

const MENU_FIELDS = [
  { key: 'items', label: 'Menu items', kind: 'menu', hint: 'Automatic lists the pages marked “Show in the menu”, in page order.' },
  { key: 'phone', label: 'On phones', kind: 'select', options: [['row', 'Keep the links in a row'], ['button', 'Fold them into a menu button']], hint: 'Only in the header.' },
];
const menu = {
  type: 'menu', label: 'Menu', icon: 'ellipsis',
  defaults: Object.freeze({ items: null, phone: 'button' }), fields: MENU_FIELDS,
  validate(props) {
    const r = cleanFields(props, MENU_FIELDS.filter(f => f.kind !== 'menu'), this.defaults);
    const raw = props && typeof props === 'object' ? props.items : null;
    let items = null;
    if (raw != null && !Array.isArray(raw)) r.errors.items = 'must be a list, or nothing for automatic';
    if (Array.isArray(raw)) {
      items = [];
      if (raw.length > BAND_LIMITS.menuItems) r.errors.items = `at most ${BAND_LIMITS.menuItems} items`;
      const seen = new Set();
      for (const it of raw.slice(0, BAND_LIMITS.menuItems)) {
        const id = String(it?.id ?? '');
        if (!it || typeof it !== 'object' || !ID.test(id) || seen.has(id)) { r.errors.items = 'an item has a missing or repeated id'; continue; }
        seen.add(id);
        if (it.kind === 'page') {
          const pageId = String(it.pageId ?? '');
          if (ID.test(pageId)) items.push({ id, kind: 'page', pageId }); else r.errors.items = 'an item points at no page';
        } else if (it.kind === 'link') {
          const raw = text(it.url, 300), url = menuUrl(raw);
          if (raw && !url) r.errors.items = MENU_LINK_ERROR;
          items.push({ id, kind: 'link', label: text(it.label, BAND_LIMITS.label), url });
        } else r.errors.items = 'an item is neither a page nor a link';
      }
    }
    return { props: { items, phone: r.props.phone }, errors: r.errors };
  },
  render(e, ctx) {
    const a = (href, label) => `<a href="${esc(href)}">${esc(label)}</a>`;
    const auto = ctx.menuPages;
    let links;
    if (!e.props.items) links = auto.map(p => a(p.href, p.title));
    else {
      /* the owner's order; a page shows while it is marked for the menu, and one marked later joins at the end */
      const byId = new Map(auto.map(p => [p.id, p])), used = new Set();
      links = [];
      for (const it of e.props.items) {
        if (it.kind === 'page') { const p = byId.get(it.pageId); if (p && !used.has(p.id)) { used.add(p.id); links.push(a(p.href, p.title)); } }
        else if (it.label && it.url) links.push(a(ctx.siteHref(it.url), it.label));
      }
      for (const p of auto) if (!used.has(p.id)) links.push(a(p.href, p.title));
    }
    const nav = links.join('');
    if (e.props.phone !== 'button' || ctx.band !== 'header') return `<nav>${nav}</nav>`;
    /* a checkbox and its label open the menu on phones, so it works without JavaScript */
    const id = `nav-${e.id}`;
    return `<input type="checkbox" id="${id}" class="nav-t" aria-label="${esc(ctx.wording.menu)}">`
      + `<label for="${id}" class="nav-b" aria-hidden="true"><span></span></label><nav class="nav-c">${nav}</nav>`;
  },
};

const LINK_DEFAULT = Object.freeze({ kind: 'page', url: '', pageId: 'contact' });
const link = plain({
  type: 'link', label: 'Link', icon: 'chevron-right',
  defaults: Object.freeze({ label: 'Contact', link: LINK_DEFAULT, newTab: false }),
  fields: [
    { key: 'label', label: 'Words', kind: 'text', max: BAND_LIMITS.label },
    { key: 'link', label: 'Goes to', kind: 'link' },
    { key: 'newTab', label: 'Open in a new tab', kind: 'toggle' },
  ],
  render(e, ctx) {
    const href = linkHref(e.props.link, ctx);
    return href && e.props.label ? `<a class="el-link" href="${esc(href)}"${tabAttr(e.props)}>${esc(e.props.label)}</a>` : '';
  },
});
const button = plain({
  type: 'button', label: 'Button', icon: 'chevron-right',
  defaults: Object.freeze({ label: 'Get in touch', link: LINK_DEFAULT, look: 'solid', newTab: false }),
  fields: [
    { key: 'label', label: 'Words on the button', kind: 'text', max: BAND_LIMITS.label },
    { key: 'link', label: 'Goes to', kind: 'link' },
    { key: 'look', label: 'Look', kind: 'select', options: [['solid', 'Solid'], ['outline', 'Outline']] },
    { key: 'newTab', label: 'Open in a new tab', kind: 'toggle' },
  ],
  render(e, ctx) {
    const href = linkHref(e.props.link, ctx);
    return href && e.props.label ? `<a class="hbtn hbtn-${e.props.look}" href="${esc(href)}"${tabAttr(e.props)}>${esc(e.props.label)}</a>` : '';
  },
});
const social = plain({
  type: 'social', label: 'Social link', icon: 'heart',
  defaults: Object.freeze({ network: 'instagram', url: '' }),
  fields: [
    { key: 'network', label: 'Site', kind: 'select', options: Object.entries(SOCIAL).map(([k, [name]]) => [k, name]) },
    { key: 'url', label: 'Address of your page', kind: 'url' },
  ],
  render(e) {
    const net = SOCIAL[e.props.network];
    if (!net || !e.props.url) return '';
    const cls = e.props.network === 'instagram' ? 'ig' : `soc soc-${e.props.network}`;
    return `<a class="${cls}" href="${esc(e.props.url)}" aria-label="${net[0]}" target="_blank" rel="noopener">${net[1]}</a>`;
  },
});
const textEl = plain({
  type: 'text', label: 'Text', icon: 'type',
  defaults: Object.freeze({ text: '' }),
  fields: [{ key: 'text', label: 'Text', kind: 'text', max: 200 }],
  render: e => (e.props.text ? `<span>${esc(e.props.text)}</span>` : ''),
});
const spacer = plain({
  type: 'spacer', label: 'Space', icon: 'sliders-horizontal',
  defaults: Object.freeze({ size: 'medium' }),
  fields: [{ key: 'size', label: 'Size', kind: 'select', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['fill', 'All the room left']] }],
  render: e => `<span class="esp esp-${e.props.size}" aria-hidden="true"></span>`,
});

const TYPES = [logo, siteName, menu, link, button, social, textEl, spacer];
export const ELEMENT_TYPES = new Map(TYPES.map(t => [t.type, t]));
export function listElementTypes() {
  return TYPES.map(t => ({ type: t.type, label: t.label, icon: t.icon, hint: t.hint || '', defaults: t.defaults, fields: t.fields }));
}

/* ---- motion and visibility, the same for every element ---- */
export const ELEMENT_MOTION_DEFAULTS = Object.freeze({ entrance: 'none', duration: 700, delay: 0, hover: 'none' });
export const ELEMENT_HOVER = [['none', 'None'], ['fade', 'Fade'], ['lift', 'Lift'], ['grow', 'Grow']];
export const ELEMENT_MOTION_SCHEMA = [...MOTION_SCHEMA.slice(0, 3), { key: 'hover', label: 'On hover', kind: 'select', options: ELEMENT_HOVER }];
export const ELEMENT_VISIBLE = STYLE_SCHEMA.find(f => f.key === 'visible');

/* ---- the bands' own style ---- */
const BAND_COMMON = [
  { key: 'background', label: 'Background', kind: 'select', options: [['theme', 'Theme colour'], ['color', 'Its own colour']] },
  { key: 'bgColor', label: 'Background colour', kind: 'color', when: ['background', 'color'] },
  { key: 'padding', label: 'Height', kind: 'select', options: [['compact', 'Compact'], ['normal', 'Normal'], ['roomy', 'Roomy']] },
  { key: 'alignment', label: 'Arrangement', kind: 'select', options: [['spread', 'Spread out'], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] },
];
export const HEADER_STYLE_SCHEMA = [...BAND_COMMON, { key: 'sticky', label: 'Stay at the top while scrolling', kind: 'toggle' }];
export const FOOTER_STYLE_SCHEMA = [...BAND_COMMON, { key: 'toTop', label: 'Back-to-top arrow', kind: 'toggle' }];
export const HEADER_STYLE_DEFAULTS = Object.freeze({ background: 'theme', bgColor: '#ffffff', padding: 'normal', alignment: 'spread', sticky: false });
export const FOOTER_STYLE_DEFAULTS = Object.freeze({ background: 'theme', bgColor: '#ffffff', padding: 'normal', alignment: 'spread', toTop: true });
const BANDS = {
  header: { name: 'Header', schema: HEADER_STYLE_SCHEMA, defaults: HEADER_STYLE_DEFAULTS },
  footer: { name: 'Footer', schema: FOOTER_STYLE_SCHEMA, defaults: FOOTER_STYLE_DEFAULTS },
};

/* ---- checking ---- */
/* ids: element ids already taken anywhere on the site (header and footer share one set) */
export function cleanElement(raw, ids = new Set()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { element: null, errors: ['an element must be an object'] };
  const t = ELEMENT_TYPES.get(raw.type);
  if (!t) return { element: null, errors: [`unknown element "${String(raw.type).slice(0, 40)}"`] };
  const id = String(raw.id ?? '');
  if (!ID.test(id)) return { element: null, errors: [`${t.label}: the element id "${id.slice(0, 40)}" is not valid`] };
  if (ids.has(id)) return { element: null, errors: [`${t.label}: the element id "${id}" is used twice`] };
  ids.add(id);
  const p = t.validate(raw.props), m = cleanFields(raw.motion, ELEMENT_MOTION_SCHEMA, ELEMENT_MOTION_DEFAULTS);
  const v = cleanFields(raw, [ELEMENT_VISIBLE], { visible: 'all' });
  const errors = [...Object.entries(p.errors), ...Object.entries(m.errors), ...Object.entries(v.errors)].map(([k, e]) => `${t.label}, ${k}: ${e}`);
  return { element: { id, type: t.type, props: p.props, motion: m.props, visible: v.props.visible }, errors };
}

export function cleanBand(raw, which, ids = new Set()) {
  const b = BANDS[which];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { band: null, errors: [`${b.name}: missing`] };
  const s = cleanFields(raw.style, b.schema, b.defaults);
  const errors = Object.entries(s.errors).map(([k, e]) => `${b.name}, ${k}: ${e}`);
  if (!Array.isArray(raw.elements)) errors.push(`${b.name}: the elements must be a list`);
  const list = Array.isArray(raw.elements) ? raw.elements : [];
  if (list.length > BAND_LIMITS.elements) errors.push(`${b.name}: at most ${BAND_LIMITS.elements} elements`);
  const elements = [];
  for (const r of list.slice(0, BAND_LIMITS.elements)) {
    const c = cleanElement(r, ids);
    if (c.element) elements.push(c.element);
    errors.push(...c.errors.map(e => `${b.name}: ${e}`));
  }
  return { band: { style: s.props, elements }, errors };
}

/* ---- writing ----
   ctx: { base, editor, siteName, logoHtml, wording, menuPages: [{ id, title, href }], pageHref(id), siteHref(path) }.
   An element with nothing set in motion or visibility is written as its own markup, with no wrapper, and one with
   nothing to show keeps its place as an empty span: that is what keeps a band made from the old settings identical. */
export function renderElement(e, ctx) {
  const t = ELEMENT_TYPES.get(e.type);
  if (!t || (e.visible === 'none' && !ctx.editor)) return null;
  let inner = t.render(e, ctx);
  if (!inner) inner = ctx.editor ? `<span class="el-empty">${esc(t.label)}</span>` : '<span></span>';
  const m = e.motion, cls = ['el'], vars = [];
  if (e.visible === 'desktop' || e.visible === 'phone') cls.push(`vis-${e.visible}`);
  if (e.visible === 'none') cls.push('blk-off');
  if (m.entrance !== 'none') { cls.push('m', `m-${esc(m.entrance)}`); vars.push(`--m-dur:${Number(m.duration) || 0}ms`, `--m-delay:${Number(m.delay) || 0}ms`); }
  if (m.hover !== 'none') cls.push(`eh-${esc(m.hover)}`);
  if (cls.length === 1 && !ctx.editor) return inner;
  return `<div class="${cls.join(' ')}"${ctx.editor ? ` data-e="${esc(e.id)}"` : ''}${vars.length ? ` style="${vars.join(';')}"` : ''}>${inner}</div>`;
}

const PAD = { compact: ' bp-compact', normal: '', roomy: ' bp-roomy' };
function open(tag, cls, s, which, ctx, extraStyle = '') {
  let c = cls + (PAD[s.padding] ?? '') + (s.alignment === 'spread' ? '' : ` ba-${esc(s.alignment)}`);
  const style = [];
  if (s.background === 'color') { c += ' bg-own'; style.push(`--band-bg:${esc(s.bgColor)}`); }
  if (s.sticky) c += ' sticky';
  if (extraStyle) style.push(extraStyle);
  return `<${tag} class="${c}"${style.length ? ` style="${style.join(';')}"` : ''}${ctx.editor ? ` data-band="${which}"` : ''}>`;
}

export function renderHeader(h, ctx) {
  const c = { ...ctx, band: 'header' };
  const parts = h.elements.map(e => renderElement(e, c)).filter(x => x != null);
  return `${open('header', 'top', h.style, 'header', ctx)}\n  ${parts.join('\n  ')}\n</header>`;
}

/* spread out, the footer is a grid: the first element at the left, the last at the right and the rest between, as
   the old footer's three were; any other count gets its own columns */
export function renderFooter(f, ctx) {
  const c = { ...ctx, band: 'footer' };
  const parts = f.elements.map(e => renderElement(e, c)).filter(x => x != null);
  if (f.style.toTop) parts.push(`<a class="totop" href="#" aria-label="${esc(ctx.wording.toTop)}">${UP}</a>`);
  const n = parts.length;
  const cols = f.style.alignment === 'spread' && n !== 3
    ? `grid-template-columns:${n <= 1 ? '1fr' : `1fr${' auto'.repeat(n - 2)} 1fr`};column-gap:1.5rem` : '';
  return `${open('footer', 'foot', f.style, 'footer', ctx, cols)}\n  ${parts.join('\n  ')}\n</footer>`;
}
