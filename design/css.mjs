/* Custom CSS sanitiser for gallery designs.
   Parses with a small tokenizer, checks every piece against an allow-list and writes the result back out from
   the parsed tree, never from the source text, so what comes out can only contain what was allowed in.
   Nothing can load an outside resource, run script, or reach outside the gallery container.
   The approach (parse, allow-list, scope every selector) is adapted from ImmichPager's custom-css compiler,
   copyright 2026 ImmichPager contributors, AGPL-3.0, used with permission. */

export const CSS_LIMIT = 20000;
export const SCOPE = ':where(#app,#lb)';
const MAX_RULES = 1000, MAX_DECLS = 4000, MAX_DEPTH = 8;

const PSEUDO_CLASSES = new Set(['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'first-child', 'last-child',
  'only-child', 'first-of-type', 'last-of-type', 'empty']);
const PSEUDO_ELEMENTS = new Set(['before', 'after', 'selection', 'first-line', 'first-letter', 'marker', 'placeholder']);
const LEGACY_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);   /* allowed with one colon */
const NTH = new Set(['nth-child', 'nth-of-type', 'nth-last-child', 'nth-last-of-type']);
const SELECTOR_ARGS = new Set(['not', 'is', 'where']);
const ATTR_NAME = /^(data-[a-z-]+|aria-[a-z-]+|hidden|role)$/i;
const ATTR_OPS = new Set(['=', '~=', '|=', '^=', '$=', '*=']);
const MEDIA_RULES = new Set(['media', 'supports']);

const UNITS = new Set(['px', 'em', 'rem', '%', 'vw', 'vh', 'svh', 'lvh', 'dvh', 'vmin', 'vmax', 'ch', 'ex', 'lh', 'deg',
  'rad', 'turn', 's', 'ms', 'fr', 'x', 'dppx', 'cqw', 'cqh']);
const FUNCTIONS = new Set(('var calc min max clamp rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix ' +
  'linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient ' +
  'repeating-conic-gradient cubic-bezier steps translate translatex translatey translate3d scale scalex scaley ' +
  'rotate skew skewx skewy matrix perspective blur brightness contrast drop-shadow grayscale hue-rotate invert ' +
  'opacity saturate sepia minmax repeat fit-content inset circle ellipse polygon counter counters env').split(' '));
const BAD_IDENTS = new Set(['expression', 'javascript', 'progid', 'url', 'src', 'vbscript']);
const BAD_PROPS = new Set(['behavior', '-moz-binding', '-ms-behavior', 'src']);
const PROP = /^(--[\w-]+|-?[a-z][a-z-]*)$/i;
const VALUE_DELIMS = new Set([',', '/', '+', '-', '*']);

class CssError extends Error {
  constructor(message, t) { super(message); this.line = t ? t.line : 1; this.col = t ? t.col : 1; }
}

/* ---------- tokenizer ---------- */
const isIdentStart = (c) => /[A-Za-z_]/.test(c || '');
const isIdentChar = (c) => /[\w-]/.test(c || '');
const isDigit = (c) => /[0-9]/.test(c || '');

function tokenize(src) {
  const toks = [];
  let i = 0, line = 1, col = 1, ws = false;
  const at = (n = 0) => src[i + n];
  const adv = (n = 1) => { for (let k = 0; k < n; k++) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
  const push = (t, v, extra, l, c) => { toks.push({ t, v, ws, line: l, col: c, ...extra }); ws = false; };
  while (i < src.length) {
    const c = at(), l = line, cl = col;
    if (c === ' ' || c === '\t' || c === '\n') { ws = true; adv(); continue; }
    if (c === '/' && at(1) === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new CssError('This comment is never closed', { line: l, col: cl });
      adv(end + 2 - i); ws = true; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j++;
      if (src[j] !== c) throw new CssError('This text in quotes is never closed', { line: l, col: cl });
      if (j - i > 201) throw new CssError('This text in quotes is too long', { line: l, col: cl });
      const v = src.slice(i + 1, j);
      adv(j + 1 - i); push('str', v, { q: c }, l, cl); continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(at(1)))) {
      let j = i;
      while (isDigit(src[j])) j++;
      if (src[j] === '.' && isDigit(src[j + 1])) { j++; while (isDigit(src[j])) j++; }
      const v = src.slice(i, j);
      let unit = '';
      if (src[j] === '%') { unit = '%'; j++; }
      else if (isIdentStart(src[j])) { const s = j; while (isIdentChar(src[j])) j++; unit = src.slice(s, j); }
      adv(j - i); push('num', v, { unit }, l, cl); continue;
    }
    if (isIdentStart(c) || (c === '-' && (isIdentStart(at(1)) || (at(1) === '-' && isIdentChar(at(2)))))) {
      let j = i;
      while (isIdentChar(src[j])) j++;
      const v = src.slice(i, j);
      if (src[j] === '(') { adv(j + 1 - i); push('func', v, {}, l, cl); }
      else { adv(j - i); push('ident', v, {}, l, cl); }
      continue;
    }
    if (c === '@') {
      let j = i + 1;
      while (isIdentChar(src[j])) j++;
      if (j === i + 1) throw new CssError('Unexpected "@"', { line: l, col: cl });
      const v = src.slice(i + 1, j);
      adv(j - i); push('at', v, {}, l, cl); continue;
    }
    if (c === '#') {
      let j = i + 1;
      while (isIdentChar(src[j])) j++;
      if (j === i + 1) throw new CssError('Unexpected "#"', { line: l, col: cl });
      const v = src.slice(i + 1, j);
      adv(j - i); push('hash', v, {}, l, cl); continue;
    }
    if ('{}()[]:;,.>+~*=|^$!/-'.includes(c)) { adv(); push('delim', c, {}, l, cl); continue; }
    throw new CssError(`Unexpected character "${c}"`, { line: l, col: cl });
  }
  return toks;
}

const text = (t) => t.t === 'ident' || t.t === 'delim' ? t.v
  : t.t === 'func' ? t.v + '(' : t.t === 'at' ? '@' + t.v : t.t === 'hash' ? '#' + t.v
  : t.t === 'num' ? t.v + t.unit : t.q + t.v + t.q;
const ser = (toks) => toks.map((t, i) => (t.ws && i > 0 ? ' ' : '') + text(t)).join('');

/* ---------- selectors ---------- */
/* Index of the ")" that closes the "(" just before toks[from]. */
function closeParen(toks, from) {
  let d = 1;
  for (let k = from; k < toks.length; k++) {
    if (toks[k].t === 'func' || (toks[k].t === 'delim' && toks[k].v === '(')) d++;
    else if (toks[k].t === 'delim' && toks[k].v === ')' && --d === 0) return k;
  }
  throw new CssError('A bracket is never closed', toks[from - 1]);
}

function splitCommas(toks) {
  const parts = [[]];
  let d = 0;
  for (const t of toks) {
    if (t.t === 'func' || (t.t === 'delim' && (t.v === '(' || t.v === '['))) d++;
    if (t.t === 'delim' && (t.v === ')' || t.v === ']')) d--;
    if (d === 0 && t.t === 'delim' && t.v === ',') parts.push([]); else parts[parts.length - 1].push(t);
  }
  return parts;
}

function complexSelector(toks, nested, scope = SCOPE) {
  if (!toks.length) throw new CssError('There is an empty selector', null);
  const out = [];
  let k = 0, rooted = false, afterComb = false;
  const space = (t) => { if (t.ws && out.length && !afterComb) out.push(' '); afterComb = false; };
  const isRoot = (a, b) => a.t === 'ident' && ['html', 'body'].includes(a.v.toLowerCase()) ? 1
    : a.t === 'delim' && a.v === ':' && b && b.t === 'ident' && ['root', 'scope'].includes(b.v.toLowerCase()) ? 2 : 0;
  if (!nested) {
    const n = isRoot(toks[0], toks[1]);
    if (n) { out.push(scope); rooted = true; k = n; }
  }
  while (k < toks.length) {
    const t = toks[k], nx = toks[k + 1];
    if (t.t === 'delim' && ['>', '+', '~'].includes(t.v)) {
      if (!out.length || afterComb) throw new CssError('A selector cannot start with this', t);
      while (out[out.length - 1] === ' ') out.pop();
      out.push(` ${t.v} `); afterComb = true; k++; continue;
    }
    space(t);
    if (t.t === 'ident') { out.push(t.v); k++; }
    else if (t.t === 'delim' && t.v === '*') { out.push('*'); k++; }
    else if (t.t === 'delim' && t.v === '.' && nx && nx.t === 'ident' && !nx.ws) { out.push('.' + nx.v); k += 2; }
    else if (t.t === 'hash') { out.push('#' + t.v); k++; }
    else if (t.t === 'delim' && t.v === '[') {
      const end = toks.findIndex((x, j) => j > k && x.t === 'delim' && x.v === ']');
      if (end < 0) throw new CssError('A [ is never closed', t);
      const inner = toks.slice(k + 1, end);
      if (!inner.length || inner[0].t !== 'ident' || !ATTR_NAME.test(inner[0].v))
        throw new CssError('Only data-*, aria-*, hidden and role attribute selectors are allowed', inner[0] || t);
      if (inner.length > 1) {
        let j = 1, op = '';
        while (j < inner.length && inner[j].t === 'delim' && '~|^$*='.includes(inner[j].v)) op += inner[j++].v;
        if (!ATTR_OPS.has(op) || j !== inner.length - 1 || !['str', 'ident'].includes(inner[j].t))
          throw new CssError('This attribute selector is not allowed', inner[1]);
        out.push(`[${inner[0].v}${op}${text(inner[j])}]`);
      } else out.push(`[${inner[0].v}]`);
      k = end + 1;
    } else if (t.t === 'delim' && t.v === ':') {
      let dbl = false, p = k + 1;
      if (toks[p] && toks[p].t === 'delim' && toks[p].v === ':') { dbl = true; p++; }
      const name = toks[p];
      if (!name || (name.t !== 'ident' && name.t !== 'func') || name.ws) throw new CssError('This ":" is not followed by a name', t);
      const lc = name.v.toLowerCase();
      if (name.t === 'ident') {
        if (dbl) { if (!PSEUDO_ELEMENTS.has(lc)) throw new CssError(`::${name.v} is not allowed`, name); }
        else if (!PSEUDO_CLASSES.has(lc) && !LEGACY_ELEMENTS.has(lc)) {
          if (lc === 'root' || lc === 'scope') throw new CssError(`:${name.v} can only start a selector`, name);
          throw new CssError(`:${name.v} is not allowed`, name);
        }
        out.push((dbl ? '::' : ':') + lc); k = p + 1;
      } else {
        if (dbl) throw new CssError(`::${name.v}() is not allowed`, name);
        const end = closeParen(toks, p + 1), inner = toks.slice(p + 1, end);
        if (NTH.has(lc)) {
          if (!inner.length || inner.some((x) => !(x.t === 'num' || x.t === 'ident' || (x.t === 'delim' && '+-'.includes(x.v)))))
            throw new CssError(`:${name.v}() takes a number pattern such as 2n+1`, name);
          out.push(`:${lc}(${ser(inner)})`);
        } else if (SELECTOR_ARGS.has(lc)) {
          out.push(`:${lc}(${selectorList(inner, true, scope)})`);
        } else throw new CssError(`:${name.v}() is not allowed`, name);
        k = end + 1;
      }
    } else throw new CssError(`"${text(t)}" is not allowed in a selector`, t);
  }
  if (afterComb) throw new CssError('A selector cannot end with this', toks[toks.length - 1]);
  return (rooted || nested ? '' : scope + ' ') + out.join('');
}

function selectorList(toks, nested = false, scope = SCOPE) {
  return splitCommas(toks).map((p) => complexSelector(p, nested, scope)).join(',');
}

/* ---------- declarations ---------- */
function validateValue(toks, prop) {
  let depth = 0;
  for (const t of toks) {
    if (t.t === 'func') {
      if (!FUNCTIONS.has(t.v.toLowerCase())) throw new CssError(`${t.v}() is not allowed`, t);
      if (++depth > MAX_DEPTH) throw new CssError('Brackets are nested too deeply', t);
    } else if (t.t === 'delim' && t.v === '(') {
      if (++depth > MAX_DEPTH) throw new CssError('Brackets are nested too deeply', t);
    } else if (t.t === 'delim' && t.v === ')') {
      if (--depth < 0) throw new CssError('There is a ")" without a matching "("', t);
    } else if (t.t === 'ident') {
      const lc = t.v.toLowerCase();
      if (BAD_IDENTS.has(lc)) throw new CssError(`"${t.v}" is not allowed`, t);
      if (prop === 'position' && lc === 'fixed') throw new CssError('position: fixed would escape the gallery', t);
    } else if (t.t === 'num') {
      if (t.unit && !UNITS.has(t.unit.toLowerCase())) throw new CssError(`The unit "${t.unit}" is not allowed`, t);
    } else if (t.t === 'hash') {
      if (!/^[0-9a-f]+$/i.test(t.v) || ![3, 4, 6, 8].includes(t.v.length)) throw new CssError(`"#${t.v}" is not a colour`, t);
    } else if (t.t === 'str') {
      /* inert: nothing that takes a URL is allowed, and "<" never gets this far */
    } else if (t.t === 'delim' && VALUE_DELIMS.has(t.v)) {
      /* ok */
    } else throw new CssError(`"${text(t)}" is not allowed in a value`, t);
  }
  if (depth !== 0) throw new CssError('A "(" is never closed', toks[0]);
}

function declarations(toks, count) {
  const out = [];
  let cur = [], d = 0;
  const flush = () => {
    if (!cur.length) return;
    const [p, colon] = cur;
    if (p.t !== 'ident' || !PROP.test(p.v) || BAD_PROPS.has(p.v.toLowerCase())) throw new CssError(`"${text(p)}" is not an allowed property`, p);
    if (!colon || colon.t !== 'delim' || colon.v !== ':') throw new CssError('Expected ":" after the property name', colon || p);
    let val = cur.slice(2), important = false;
    const n = val.length;
    if (n >= 2 && val[n - 2].t === 'delim' && val[n - 2].v === '!' && val[n - 1].t === 'ident' && val[n - 1].v.toLowerCase() === 'important') {
      important = true; val = val.slice(0, n - 2);
    }
    if (!val.length) throw new CssError(`"${p.v}" has no value`, p);
    validateValue(val, p.v.toLowerCase());
    if (++count.n > MAX_DECLS) throw new CssError('Too many declarations', p);
    out.push(`${p.v.toLowerCase().startsWith('--') ? p.v : p.v.toLowerCase()}:${ser(val)}${important ? '!important' : ''}`);
    cur = [];
  };
  for (const t of toks) {
    if (t.t === 'delim' && (t.v === '{' || t.v === '}')) throw new CssError('Nested rules are not supported; write separate rules', t);
    if (t.t === 'func' || (t.t === 'delim' && t.v === '(')) d++;
    if (t.t === 'delim' && t.v === ')') d--;
    if (d === 0 && t.t === 'delim' && t.v === ';') flush(); else cur.push(t);
  }
  flush();
  return out.join(';');
}

/* ---------- rules ---------- */
function preludeOk(toks) {
  for (const t of toks) {
    const ok = t.t === 'ident' || t.t === 'num' || (t.t === 'delim' && '():,/'.includes(t.v));
    if (!ok) throw new CssError(`"${text(t)}" is not allowed here`, t);
  }
}

function blockEnd(toks, from) {   /* index of the "}" that closes the block opened at toks[from-1] */
  for (let k = from; k < toks.length; k++) {
    if (toks[k].t === 'delim' && toks[k].v === '{') throw new CssError('Nested rules are not supported; write separate rules', toks[k]);
    if (toks[k].t === 'delim' && toks[k].v === '}') return k;
  }
  throw new CssError('A { is never closed', toks[from - 1]);
}

function rules(toks, inAt, count, scope = SCOPE) {
  const out = [];
  let k = 0;
  while (k < toks.length) {
    const t = toks[k];
    if (t.t === 'at') {
      const name = t.v.toLowerCase();
      if (inAt || !MEDIA_RULES.has(name)) throw new CssError(`@${t.v} is not allowed`, t);
      const open = toks.findIndex((x, j) => j > k && x.t === 'delim' && x.v === '{');
      if (open < 0) throw new CssError(`@${t.v} needs a { block`, t);
      const prelude = toks.slice(k + 1, open);
      preludeOk(prelude);
      let d = 1, end = open + 1;
      for (; end < toks.length; end++) {
        if (toks[end].t === 'delim' && toks[end].v === '{') d++;
        else if (toks[end].t === 'delim' && toks[end].v === '}' && --d === 0) break;
      }
      if (d !== 0) throw new CssError('A { is never closed', toks[open]);
      const body = rules(toks.slice(open + 1, end), true, count, scope);
      if (body) out.push(`@${name} ${ser(prelude)}{${body}}`);
      k = end + 1; continue;
    }
    const open = toks.findIndex((x, j) => j >= k && x.t === 'delim' && (x.v === '{' || x.v === '}'));
    if (open < 0 || toks[open].v === '}') throw new CssError('Expected a { after this selector', toks[open] || t);
    const sel = selectorList(toks.slice(k, open), false, scope);
    const end = blockEnd(toks, open + 1);
    if (++count.rules > MAX_RULES) throw new CssError('Too many rules', t);
    const decls = declarations(toks.slice(open + 1, end), count);
    if (decls) out.push(`${sel}{${decls}}`);
    k = end + 1;
  }
  return out.join('');
}

/* Returns {css, error}. error is null or {message, line, col}; css is '' when there is an error.
   scope is the selector every rule is put under: the gallery by default, one website block for the site builder. */
export function compileCustomCss(src, { scope = SCOPE } = {}) {
  try {
    if (typeof src !== 'string') throw new CssError('Custom CSS must be text', null);
    if (src.length > CSS_LIMIT) throw new CssError(`Custom CSS is limited to ${CSS_LIMIT.toLocaleString('en-US')} characters`, null);
    const text0 = src.replace(/\r\n?/g, '\n');
    let line = 1, col = 1;
    for (const ch of text0) {
      if (ch === '\\') throw new CssError('Backslash escapes are not allowed', { line, col });
      if (ch === '<') throw new CssError('"<" is not allowed', { line, col });
      const code = ch.codePointAt(0);
      if ((code < 32 && ch !== '\n' && ch !== '\t') || code === 127) throw new CssError('Control characters are not allowed', { line, col });
      if (ch === '\n') { line++; col = 1; } else col++;
    }
    const css = rules(tokenize(text0), false, { rules: 0, n: 0 }, scope);
    return { css: css.replaceAll('<', '\\3c '), error: null };
  } catch (e) {
    if (!(e instanceof CssError)) throw e;
    return { css: '', error: { message: e.message, line: e.line, col: e.col } };
  }
}
