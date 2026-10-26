/* Who may use the setup page. A fresh install has no password yet, so the page is protected by a code
   that is printed in the container's log and written to a file only the person running the container
   can read. The pieces here are pure, with the clock passed in, so they can be tested exactly. */

import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

/* Crockford base32: no I, L, O or U, so a code read off a screen cannot be mistyped as another letter */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function makeCode() {
  const b = randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[b[i] % 32];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
export function normaliseCode(input) {
  return String(input || '').toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}
export function codeMatches(input, code) {
  const a = Buffer.from(normaliseCode(input)), b = Buffer.from(normaliseCode(code));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/* Wrong guesses are limited per address, and in total: after too many from anywhere the page stays
   locked until the container restarts, so changing address does not buy more tries. */
export function createLimiter({ perIp = 10, windowMs = 15 * 60_000, globalMax = 60, globalWindowMs = 3600_000, now = Date.now } = {}) {
  const byIp = new Map();
  let all = [];
  return {
    blocked(ip) {
      const t = now();
      all = all.filter(x => t - x < globalWindowMs);
      if (all.length >= globalMax) return 'locked';
      const rec = byIp.get(ip);
      if (rec && t - rec.t < windowMs && rec.n >= perIp) return 'ip';
      return null;
    },
    fail(ip) {
      const t = now();
      const rec = byIp.get(ip);
      if (!rec || t - rec.t >= windowMs) byIp.set(ip, { n: 1, t });
      else rec.n++;
      all.push(t);
    },
  };
}

/* the cookie that says "this browser entered the code": an expiry and a signature, nothing else */
const mac = (secret, exp) => createHmac('sha256', secret).update(`setup.${exp}`).digest('base64url');
export function makeToken(secret, ttlMs = 12 * 3600_000, now = Date.now()) {
  const exp = now + ttlMs;
  return `${exp}.${mac(secret, exp)}`;
}
export function checkToken(secret, token, now = Date.now()) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  const want = Buffer.from(mac(secret, exp)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/* A browser may only talk to the setup API from the page it was given. The Origin header must name the
   same host the request arrived on. */
export function sameOrigin(headers) {
  const o = headers.origin;
  if (!o) return false;
  try { return new URL(o).host === String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim(); } catch { return false; }
}
