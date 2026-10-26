/* What this server may believe about a request that came through a proxy.

   An address in X-Forwarded-For is only as honest as whoever set it. Behind Cloudflare the header is
   *appended to*, so its first entry can be written by the visitor; and with the app's port open directly,
   anyone can send one. Sign-in throttles and the activity log key off this address, so a forged one would
   let someone dodge them. CLIENT_IP_HEADER names the single header the owner's own proxy overwrites:

     ''                 the first X-Forwarded-For entry (how it has always worked)
     cf-connecting-ip   Cloudflare's own header (a Cloudflare Tunnel, or Cloudflare in front)
     x-real-ip          a header the owner's reverse proxy sets
     none               never trust a header: the address of whatever connected */

export const CLIENT_IP_CHOICES = ['', 'cf-connecting-ip', 'x-real-ip', 'x-forwarded-for', 'none'];

export function clientIp(req, header = '') {
  const sock = req.socket?.remoteAddress || '';
  if (header === 'none') return sock;
  const name = header || 'x-forwarded-for';
  return String(req.headers[name] || '').split(',')[0].trim() || sock;
}

/* Secure cookies are right behind an https proxy, but would never arrive over plain http on the home network. */
export function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

/* the host the browser asked for, as the proxy passed it on */
export const requestHost = req => String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
