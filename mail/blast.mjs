/* The pure parts of a mailing: filling a template for one person, signing unsubscribe links,
   deciding who gets it, and what to do when the mail service answers. No network, no database,
   no clock of its own, so each piece can be tested without sending anything. */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/* placeholders that need a gallery behind them, and the one that also needs an expiry date */
export const VARS = ['name', 'title', 'subtitle', 'link', 'expiry', 'brand', 'site', 'unsubscribe'];
const GALLERY_VARS = new Set(['title', 'subtitle', 'link', 'expiry']);
const URL_VARS = new Set(['link', 'site', 'unsubscribe']);
const TOKEN = /\{\{\s*(\w+)\s*\}\}/g;

const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safeUrl = u => /^https?:\/\/[^\s<>"]+$/i.test(String(u || '')) ? String(u) : '';

/* which placeholders a text uses, and which of those we do not know */
export function scanVars(...texts) {
  const used = new Set(), unknown = new Set();
  for (const t of texts) for (const m of String(t || '').matchAll(TOKEN)) {
    const k = m[1].toLowerCase();
    (VARS.includes(k) ? used : unknown).add(k);
  }
  return { used: [...used], unknown: [...unknown], usesGallery: [...used].some(k => GALLERY_VARS.has(k)) };
}

/* the greeting uses the first word of the name, or "there" */
export const firstName = n => (String(n || '').trim().split(/\s+/)[0] || 'there');

/* ---------------------------------------------------------------------- the design */
/* What a mailing looks like besides its words: a hidden preview line, an optional title, an image
   (each person's gallery cover, or one the owner uploaded), a button, and an expiry line. Whatever
   comes in from the browser is cut down to exactly this shape, so nothing else can ride along. */
export const IMAGE_FILE = /^[0-9a-f]{20}\.(jpg|png|webp)$/;
export function cleanDesign(d) {
  d = d && typeof d === 'object' ? d : {};
  const str = (v, n) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
  const img = d.image && typeof d.image === 'object' ? d.image : {}, btn = d.button && typeof d.button === 'object' ? d.button : {};
  const file = IMAGE_FILE.test(img.file || '') ? img.file : '';
  let mode = ['cover', 'custom', 'none'].includes(img.mode) ? img.mode : 'none';
  if (mode === 'custom' && !file) mode = 'none';
  return {
    preheader: str(d.preheader, 200), title: str(d.title, 120),
    image: { mode, file: mode === 'custom' ? file : '' },
    button: { text: str(btn.text, 40), mode: ['gallery', 'site', 'custom', 'none'].includes(btn.mode) ? btn.mode : 'none', url: safeUrl(btn.url) },
    showExpiry: d.showExpiry === true,
  };
}

/* **bold**, *italic*, __underline__ and [text](https://link) in the message. Applied to the
   template's own words only, never to a person's name or any other substituted value. */
function inlineHtml(escaped) {
  return escaped
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)<>]+)\)/g, '<a href="$2" style="color:#1a1a1a;text-decoration:underline">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/__(.+?)__/g, '<u>$1</u>');
}
const inlineText = t => t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)<>]+)\)/g, '$1 ($2)').replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1$2').replace(/__(.+?)__/g, '$1');

const SENT_OPEN = '', SENT_CLOSE = '';

/* One person's copy. Words and substituted values are kept apart: the template's text is escaped
   and formatted, a value (a name someone typed into a form, say) is only escaped, so it can never
   become markup or a link.
   recipient: { name, gallery: {title, subtitle, link, expiry, cover} | null }
   ctx: { brand, site, address, unsubscribe, logo, social:{url,label}|null, replyTo, imageBase } */
export function render({ subject, body, design }, recipient, ctx) {
  const dz = cleanDesign(design);
  const g = recipient.gallery || null;
  const one = v => String(v ?? '').replace(/[\r\n]+/g, ' ');
  const values = {
    name: firstName(recipient.name), brand: ctx.brand || '', site: ctx.site || '', unsubscribe: ctx.unsubscribe || '',
    title: g?.title ?? null, subtitle: g?.subtitle ?? null, link: g?.link ?? null, expiry: g?.expiry ?? null,
  };
  const unresolved = new Set();

  /* swap each placeholder for a marker, format the words, then put the (escaped) values back */
  const fill = (text, mode) => {
    const held = [];
    const marked = String(text || '').replace(/[]/g, '').replace(TOKEN, (m, name) => {
      const k = name.toLowerCase();
      if (!VARS.includes(k)) return m;
      const v = values[k];
      if (v == null) { if (GALLERY_VARS.has(k)) unresolved.add(k); return ''; }
      if (v === '') return '';
      held.push({ k, v: one(v) });
      return `${SENT_OPEN}${held.length - 1}${SENT_CLOSE}`;
    });
    const back = f => marked.replace(new RegExp(`${SENT_OPEN}(\\d+)${SENT_CLOSE}`, 'g'), (_, i) => f(held[Number(i)]));
    if (mode === 'text') return back(h => h.v);
    if (mode === 'plain') return back(h => h.v);
    const formatted = inlineHtml(esc(marked).replace(new RegExp(`${SENT_OPEN}(\\d+)${SENT_CLOSE}`, 'g'), m => m));
    return formatted.replace(new RegExp(`${SENT_OPEN}(\\d+)${SENT_CLOSE}`, 'g'), (_, i) => {
      const h = held[Number(i)];
      if (URL_VARS.has(h.k)) { const u = safeUrl(h.v); return u ? `<a href="${esc(u)}" style="color:#1a1a1a;text-decoration:underline">${esc(u)}</a>` : ''; }
      return esc(h.v);
    });
  };
  const plain = t => fill(t, 'plain').trim();

  const subj = plain(subject).slice(0, 200);
  const preheader = plain(dz.preheader);
  const title = plain(dz.title);
  const text = inlineText(fill(body, 'text'));
  const paras = fill(body, 'html').split(/\n{2,}/).filter(s => s.trim())
    .map(t => `<p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#333">${t.trim().replace(/\n/g, '<br>')}</p>`).join('');

  const img = dz.image.mode === 'cover' ? safeUrl(g?.cover)
            : dz.image.mode === 'custom' ? safeUrl(`${ctx.imageBase || ''}${dz.image.file}`) : '';
  const imgLink = dz.image.mode === 'cover' ? safeUrl(g?.link) : '';
  const btnText = plain(dz.button.text);
  const btnUrl = dz.button.mode === 'gallery' ? safeUrl(g?.link) : dz.button.mode === 'site' ? safeUrl(ctx.site) : dz.button.mode === 'custom' ? dz.button.url : '';
  const showButton = !!(btnText && btnUrl);
  const expiry = dz.showExpiry && g?.expiry ? one(g.expiry) : '';

  const f = footer(ctx);
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f4">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#f4f4f4">${esc(preheader)}${'&nbsp;&zwnj;'.repeat(40)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff">
${ctx.logo ? `<tr><td align="center" style="padding:40px 32px 22px"><img src="${esc(ctx.logo)}" width="64" height="64" alt="${esc(ctx.brand || '')}" style="display:block;border:0"></td></tr>` : ''}
${title ? `<tr><td align="center" style="padding:6px 32px 22px"><div style="font-family:Helvetica,Arial,sans-serif;font-size:19px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#1a1a1a">${esc(title)}</div></td></tr>` : ''}
${img ? `<tr><td style="padding:0">${imgLink ? `<a href="${esc(imgLink)}">` : ''}<img src="${esc(img)}" width="560" alt="${esc(title || ctx.brand || '')}" style="display:block;width:100%;height:auto;border:0">${imgLink ? '</a>' : ''}</td></tr>` : ''}
<tr><td style="padding:30px 36px 8px;font-family:Helvetica,Arial,sans-serif">${paras}</td></tr>
${showButton ? `<tr><td align="center" style="padding:10px 32px ${expiry ? '12' : '34'}px"><a href="${esc(btnUrl)}" style="display:inline-block;padding:15px 44px;background:#1a1a1a;color:#fff;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:.24em;text-transform:uppercase">${esc(btnText)}</a></td></tr>` : ''}
${expiry ? `<tr><td align="center" style="padding:0 32px 34px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#8a8a8a">Available until ${esc(expiry)}</td></tr>` : ''}
<tr><td align="center" style="padding:0 32px 32px;border-top:1px solid #eee"><div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.8;color:#999;padding-top:22px">${f.html}</div></td></tr>
</table></td></tr></table></body></html>`;
  const lines = [title, text, showButton ? `${btnText}: ${btnUrl}` : '', expiry ? `Available until ${expiry}` : ''].filter(Boolean);
  return { subject: subj, html, text: `${lines.join('\n\n')}\n\n--\n${f.text}`, unresolved: [...unresolved] };
}

/* The footer every mailing carries: who it is from, where, why they are getting it, and the way out. */
function footer(ctx) {
  const why = `You're getting this because you registered for a gallery with ${ctx.brand || 'us'}.`;
  const u = safeUrl(ctx.unsubscribe), site = safeUrl(ctx.site), soc = ctx.social && safeUrl(ctx.social.url);
  const name = site ? `<a href="${esc(site)}" style="color:#777;text-decoration:none">${esc(ctx.brand || site)}</a>` : esc(ctx.brand || '');
  const html = [
    name,
    ctx.replyTo ? 'Questions? Reply to this email.' : '',
    soc ? `<a href="${esc(soc)}" style="color:#999">${esc(ctx.social.label || 'Instagram')}</a>` : '',
    `<span style="display:block;height:8px"></span>${ctx.address ? esc(ctx.address) + '<br>' : ''}${esc(why)}`,
    u ? `<a href="${esc(u)}" style="color:#999">Unsubscribe</a>` : '',
  ].filter(Boolean).join('<br>');
  const text = [ctx.brand, ctx.replyTo ? 'Questions? Reply to this email.' : '', soc ? `${ctx.social.label || 'Instagram'}: ${soc}` : '',
                ctx.address, why, u ? `Unsubscribe: ${u}` : ''].filter(Boolean).join('\n');
  return { html, text };
}

/* ------------------------------------------------------------ unsubscribe links */
/* Opaque and unforgeable: AES-256-GCM under a key derived from the app secret, with a random IV.
   The address is not readable from the link, and no database lookup is needed to trust one. */
const unsubKey = secret => createHmac('sha256', secret).update('unsub-v1').digest();
export function unsubToken(email, mailingId, secret) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', unsubKey(secret), iv);
  const enc = Buffer.concat([c.update(JSON.stringify({ e: String(email).toLowerCase(), m: mailingId || null }), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}
export function readUnsubToken(tok, secret) {
  try {
    const b = Buffer.from(String(tok), 'base64url');
    if (b.length < 29) return null;
    const d = createDecipheriv('aes-256-gcm', unsubKey(secret), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const p = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
    return typeof p.e === 'string' && p.e.includes('@') ? { email: p.e, mailing: p.m || null } : null;
  } catch { return null; }
}
export const maskEmail = e => { const [u = '', d = ''] = String(e).split('@'); return `${u.slice(0, 1)}•••@${d}`; };

/* ------------------------------------------------------------------ who gets it */
/* addresses that must never receive real mail: reserved by standard, used for tests and examples */
export function isReservedAddress(email) {
  const d = String(email).toLowerCase().split('@')[1] || '';
  return /\.(invalid|test|example|localhost)$/.test(d) || ['example.com', 'example.net', 'example.org'].includes(d);
}

/* rows: one per registration, newest first (email, name, gid, title, subtitle, slug, expires_at,
   published_at, dl_at). Returns who to send to and who is left out, and why. The same rules as the
   Contacts list: one entry per lowercase address, hidden ones out. */
export function selectRecipients({ rows, hidden = new Set(), suppressed = new Map(), gallery = null, who = 'any',
                                   picked = null, usesGallery = false, needsExpiry = false, now = Date.now() }) {
  const live = r => !!r.published_at && !(r.expires_at && Date.parse(r.expires_at) < now);
  const by = new Map();
  for (const r of rows) {
    if (gallery != null && r.gid !== gallery) continue;
    if (who === 'downloaded' && !r.dl_at) continue;
    const k = String(r.email).trim().toLowerCase();
    if (!k || hidden.has(k)) continue;
    const c = by.get(k) || { email: k, name: null, galleryRow: null };
    c.name = c.name || r.name || null;
    /* rows are newest first: the newest live gallery (one with an expiry date, if the words need one) */
    if (!c.galleryRow && live(r) && (!needsExpiry || r.expires_at)) c.galleryRow = r;
    by.set(k, c);
  }
  const send = [], skipped = [];
  const want = picked ? new Set(picked.map(e => String(e).trim().toLowerCase())) : null;
  if (want) for (const e of want) if (!by.has(e)) skipped.push({ email: e, reason: 'not_a_contact' });
  for (const c of [...by.values()].sort((a, b) => a.email.localeCompare(b.email))) {
    if (want && !want.has(c.email)) continue;
    const s = suppressed.get(c.email);
    if (s) { skipped.push({ email: c.email, reason: s.reason === 'bounced' || s.reason === 'complained' ? 'bounced' : 'unsubscribed' }); continue; }
    if (isReservedAddress(c.email)) { skipped.push({ email: c.email, reason: 'reserved' }); continue; }
    if (usesGallery && !c.galleryRow) { skipped.push({ email: c.email, reason: 'no_live_gallery' }); continue; }
    send.push({ email: c.email, name: c.name, galleryId: c.galleryRow ? c.galleryRow.gid : null });
  }
  return { send, skipped };
}

/* a fingerprint of exactly what will go out, so a confirmation can only authorise that */
export const planHash = (snapshot, send) =>
  createHash('sha256').update(JSON.stringify([snapshot.subject, snapshot.body, snapshot.design ?? null, send.map(s => s.email).sort()])).digest('hex');

/* ------------------------------------------------------------ the mail service's answers */
/* What to do with one send's outcome. attempts counts tries including this one. */
export function classify(status, retryAfterSec, attempts) {
  if (status >= 200 && status < 300) return { action: 'sent' };
  if (status === 429) return { action: 'retry', delayMs: Math.max(1, Number(retryAfterSec) || 30) * 1000, count: false };
  if (status === 401 || status === 403) return { action: 'pause' };
  if (status === 400 || status === 404 || status === 409 || status === 422) return { action: 'fail' };
  /* a 5xx or no answer at all: try again after a longer wait each time, then give up */
  if (attempts >= 4) return { action: 'fail' };
  return { action: 'retry', delayMs: [60_000, 300_000, 1_800_000][attempts - 1] ?? 1_800_000, count: true };
}

/* ------------------------------------------------------------------ the webhook */
/* Resend signs with Svix: HMAC-SHA256 over "id.timestamp.body" using the base64 part of the secret */
export function verifySvix(headers, rawBody, secret, now = Date.now()) {
  const id = headers['svix-id'], ts = headers['svix-timestamp'], sig = headers['svix-signature'];
  if (!id || !ts || !sig || !secret) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const want = createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest();
  return String(sig).split(' ').some(part => {
    const [, v] = part.split(',');
    try { const got = Buffer.from(v || '', 'base64'); return got.length === want.length && timingSafeEqual(got, want); } catch { return false; }
  });
}
