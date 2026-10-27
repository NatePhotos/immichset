/* HTML sanitiser for the website's rich text and custom HTML blocks. Splits the source into tags and text, keeps only
   allow-listed tags and attributes, checks every link, and writes the result out from the parsed pieces, never from the
   source, so nothing that was not allowed can come out. The same idea as design/css.mjs. Pure. */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�';
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/* Links on the website may only be web pages, email addresses and phone numbers. */
const URL_OK = /^(?:https?:\/\/[^\s"'<>\\]+|mailto:[^\s"'<>\\]+|tel:\+?[0-9().-]+)$/i;
export function safeUrl(u) {
  const s = decodeEntities(String(u ?? '')).trim();
  if (s.length > 2000 || /[\u0000-\u001f\u007f]/.test(s)) return '';
  return URL_OK.test(s) ? s : '';
}

const escText = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const escAttr = t => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const RICH = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'span'];
const TAGS = {
  rich: new Set(RICH),
  custom: new Set([...RICH, 'div', 'section', 'h1', 'h5', 'h6', 'hr', 'figure', 'figcaption', 'small', 'sup', 'sub',
                   'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre']),
};
const VOID = new Set(['br', 'hr']);
/* containers whose content is code or would load something: dropped together with everything inside */
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'applet', 'template', 'noscript', 'textarea', 'title',
  'svg', 'math', 'select', 'xmp', 'plaintext', 'noembed', 'noframes']);
const GLOBAL_ATTRS = new Set(['class', 'title']);
const TAG_ATTRS = { a: new Set(['href', 'target', 'rel']), td: new Set(['colspan', 'rowspan']), th: new Set(['colspan', 'rowspan']) };
const CLASS_OK = /^[A-Za-z0-9 _-]{0,200}$/;
const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;

/* index of the ">" that ends the tag whose attributes start at k, skipping quoted values; -1 if there is none */
function tagEnd(s, k) {
  let q = null;
  for (; k < s.length; k++) {
    const c = s[k];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '>') return k;
  }
  return -1;
}

function attrs(tag, src) {
  const kept = new Map();
  for (const m of src.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (kept.has(name) || !(GLOBAL_ATTRS.has(name) || TAG_ATTRS[tag]?.has(name))) continue;
    const v = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
    if (name === 'class') { if (CLASS_OK.test(v) && v.trim()) kept.set(name, v.trim()); }
    else if (name === 'href') { const u = safeUrl(v); if (u) kept.set(name, u); }
    else if (name === 'target') { if (v === '_blank') kept.set(name, v); }
    else if (name === 'rel') { /* written below, never taken from the source */ }
    else if (name === 'colspan' || name === 'rowspan') { if (/^[1-9][0-9]?$/.test(v)) kept.set(name, v); }
    else kept.set(name, v.slice(0, 300));
  }
  if (tag === 'a' && kept.get('target') === '_blank') kept.set('rel', 'noopener noreferrer');
  return [...kept].map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
}

export function sanitizeHtml(src, mode = 'rich') {
  const allow = TAGS[mode];
  if (!allow) throw new Error(`unknown sanitiser mode ${mode}`);
  const s = String(src ?? '');
  const open = [];
  let i = 0, out = '';
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { out += escText(decodeEntities(s.slice(i))); break; }
    if (lt > i) out += escText(decodeEntities(s.slice(i, lt)));
    i = lt;
    if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); i = e < 0 ? s.length : e + 3; continue; }
    if (s[i + 1] === '!' || s[i + 1] === '?') { const e = s.indexOf('>', i); i = e < 0 ? s.length : e + 1; continue; }
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(s.slice(i, i + 64));
    if (!m) { out += '&lt;'; i++; continue; }
    const end = tagEnd(s, i + m[0].length);
    if (end < 0) break;                                   /* an unfinished tag at the very end is dropped */
    const name = m[2].toLowerCase(), closing = m[1] === '/';
    const attrSrc = s.slice(i + m[0].length, end);
    i = end + 1;
    if (!closing && DROP.has(name)) {
      const re = new RegExp(`</${name}`, 'ig');
      re.lastIndex = i;
      const found = re.exec(s);
      if (!found) { i = s.length; continue; }
      const e = tagEnd(s, found.index + name.length + 2);
      i = e < 0 ? s.length : e + 1;
      continue;
    }
    if (!allow.has(name)) continue;
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at < 0) continue;
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }
    out += `<${name}${attrs(name, attrSrc)}>`;
    if (!VOID.has(name)) open.push(name);
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}
