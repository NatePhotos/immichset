/* Every setting the app understands, in one list. The setup page, the Connections screen, the startup
   summary and docker-compose.example.yml are all described from here, so a setting is added once.

   `key` is the name the server code reads from CFG; `env` is the environment variable that sets it.
   How a raw text value becomes the value in CFG is decided by `type`, and matches what the server
   did when it read process.env directly, so an install driven by environment variables behaves
   exactly as it always has. */

const S = (key, env, group, type, o = {}) => ({
  key, env, group, type, label: o.label || env, help: o.help || '',
  secret: !!o.secret, required: !!o.required, def: o.def ?? (type === 'int' ? 0 : type === 'on' ? 'on' : ''),
  wizard: o.wizard || '',          /* the setup step that collects it; '' means advanced or env-only */
  live: !!o.live,                  /* takes effect at once when changed from the Connections screen */
  envOnly: !!o.envOnly, hidden: !!o.hidden, choices: o.choices || null,
});

export const SETTINGS = [
  /* core: where the app lives. Env only, because the settings file itself is found through DATA_DIR. */
  S('port', 'PORT', 'core', 'int', { def: 3000, envOnly: true, label: 'Port', help: 'The port the app listens on inside the container.' }),
  S('dataDir', 'DATA_DIR', 'core', 'str', { def: '/data', envOnly: true, label: 'Data folder', help: 'Where the database, covers and settings file are kept.' }),
  S('webDir', 'WEB_DIR', 'core', 'str', { def: '/app/web', envOnly: true, hidden: true }),

  /* Immich */
  S('immichUrl', 'IMMICH_URL', 'immich', 'url', { required: true, wizard: 'immich', live: true, label: 'Immich address',
    help: 'Where this app reaches Immich. From inside a container, "localhost" is the container itself: use the computer\'s network address, e.g. http://192.168.1.20:2283.' }),
  S('immichKey', 'IMMICH_API_KEY', 'immich', 'str', { required: true, secret: true, wizard: 'immich', live: true, label: 'Immich read-only key',
    help: 'An Immich API key that can read albums and photos. Never use a key that can delete.' }),
  S('immichWriteKey', 'IMMICH_WRITE_KEY', 'immich', 'str', { secret: true, wizard: 'immich', live: true, label: 'Immich write key (optional)',
    help: 'A second key, only if you want to add or remove photos from the admin panel.' }),
  S('uploadMaxMb', 'UPLOAD_MAX_MB', 'immich', 'int', { def: 250, live: true, label: 'Largest photo, MB' }),
  S('uploadMaxVideoMb', 'UPLOAD_MAX_VIDEO_MB', 'immich', 'int', { def: 4096, live: true, label: 'Largest video, MB' }),

  /* secrets the app makes for itself */
  S('secret', 'APP_SECRET', 'secrets', 'str', { required: true, secret: true, label: 'App secret', help: 'Signs sign-in cookies and unsubscribe links. Made for you.' }),
  S('adminToken', 'ADMIN_TOKEN', 'secrets', 'str', { required: true, secret: true, label: 'Admin API token', help: 'For scripts. Bypasses the emailed code, so treat it like a password. Made for you.' }),

  /* you */
  S('adminEmail', 'ADMIN_EMAIL', 'admin', 'email', { wizard: 'account', label: 'Your email', help: 'You sign in with this, and it receives alerts and sign-in codes.' }),
  S('adminPass', 'ADMIN_PASSWORD', 'admin', 'str', { secret: true, envOnly: true, label: 'Admin password', help: 'Optional. If set it is applied to your account every time the app starts. The setup page stores only a hash in the database.' }),
  S('admin2fa', 'ADMIN_2FA', 'admin', 'on', { wizard: 'email', label: 'Emailed sign-in code', help: 'On whenever email works. Turn it off only if you cannot receive email.' }),

  /* email */
  S('resendKey', 'RESEND_API_KEY', 'email', 'str', { secret: true, wizard: 'email', live: true, label: 'Resend API key', help: 'A Resend key with sending access.' }),
  S('mailFrom', 'MAIL_FROM', 'email', 'str', { wizard: 'email', live: true, label: 'Send from', help: 'For example: Your Studio <hello@yourdomain.com>. The domain must be verified in Resend.' }),
  S('mailReplyTo', 'MAIL_REPLY_TO', 'email', 'str', { wizard: 'email', live: true, label: 'Replies go to' }),
  S('remindDays', 'REMIND_DAYS', 'email', 'int', { def: 7, live: true, label: 'Default expiry reminder, days' }),

  /* public address */
  S('publicUrl', 'PUBLIC_URL', 'public', 'url', { wizard: 'public', live: true, label: 'Public address', help: 'The https address your clients use. Links in emails are built from it.' }),
  S('clientIpHeader', 'CLIENT_IP_HEADER', 'public', 'str', { live: true, choices: ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for', 'none'],
    label: 'Where the visitor\'s address comes from',
    help: 'Behind a Cloudflare Tunnel use cf-connecting-ip. Leave empty to use X-Forwarded-For. This decides what the sign-in limits and activity log see, so set it to a header your own proxy writes.' }),
  S('sessionDays', 'SESSION_DAYS', 'public', 'int', { def: 30, live: true, label: 'Client session, days' }),

  /* brand */
  S('brandName', 'BRAND_NAME', 'brand', 'str', { wizard: 'brand', live: true, label: 'Business name' }),
  S('brandUrl', 'BRAND_URL', 'brand', 'str', { wizard: 'brand', live: true, label: 'Your website' }),
  S('brandSocial', 'BRAND_SOCIAL', 'brand', 'str', { wizard: 'brand', live: true, label: 'Social link' }),
  S('brandSocialLabel', 'BRAND_SOCIAL_LABEL', 'brand', 'str', { wizard: 'brand', live: true, label: 'Social label', help: 'For example @yourstudio.' }),
  S('brandAddress', 'BRAND_ADDRESS', 'brand', 'str', { wizard: 'brand', live: true, label: 'Postal address', help: 'Printed in every mailing, as the law requires. Needed before any real mailing.' }),

  /* mailings */
  S('mailingMax', 'MAILING_MAX', 'mailings', 'int', { def: 500, live: true, label: 'Most people in one mailing' }),
  S('mailingDayMax', 'MAILING_DAY_MAX', 'mailings', 'int', { def: 500, live: true, label: 'Most emails a day', help: 'Resend\'s free plan allows 100 a day.' }),
  S('mailingIntervalMs', 'MAILING_INTERVAL_MS', 'mailings', 'int', { def: 600, live: true, label: 'Pause between sends, ms' }),
  S('mailSend', 'MAIL_SEND', 'mailings', 'on', { live: true, label: 'Mailings send for real', help: 'Off turns every mailing into a simulation.' }),
  S('resendWebhookSecret', 'RESEND_WEBHOOK_SECRET', 'mailings', 'str', { secret: true, wizard: 'extras', live: true, label: 'Resend webhook secret', help: 'So bounces and spam complaints are never mailed again.' }),
  S('resendBase', 'RESEND_API_URL', 'internal', 'url', { def: 'https://api.resend.com', hidden: true }),

  /* hints from the installer's bundled-Immich compose file; never set by hand, never shown */
  S('immichBundled', 'IMMICHSET_BUNDLED_IMMICH', 'internal', 'url', { envOnly: true, hidden: true }),
  S('bundledMl', 'IMMICHSET_BUNDLED_ML', 'internal', 'on', { envOnly: true, hidden: true }),
  S('bundledImport', 'IMMICHSET_BUNDLED_IMPORT', 'internal', 'str', { envOnly: true, hidden: true }),
  S('immichHint', 'IMMICHSET_IMMICH_HINT', 'internal', 'url', { envOnly: true, hidden: true }),
  S('setupFromInternet', 'SETUP_FROM_INTERNET', 'internal', 'flag', { envOnly: true, hidden: true }),

  /* backups */
  S('backupDir', 'BACKUP_DIR', 'backups', 'str', { label: 'Backup folder' }),
  S('backupKeep', 'BACKUP_KEEP', 'backups', 'int', { def: 14, label: 'Backups kept' }),

  /* dynamic DNS */
  S('hostingerToken', 'HOSTINGER_TOKEN', 'dns', 'str', { secret: true, wizard: 'extras', label: 'Hostinger DNS token' }),
  S('cfToken', 'CLOUDFLARE_TOKEN', 'dns', 'str', { secret: true, wizard: 'extras', label: 'Cloudflare DNS token' }),
  S('dnsDomain', 'DNS_DOMAIN', 'dns', 'str', { wizard: 'extras', label: 'DNS domain' }),
  S('dnsHost', 'DNS_HOST', 'dns', 'str', { wizard: 'extras', label: 'DNS host' }),
  S('dnsApply', 'DNS_APPLY', 'dns', 'on', { label: 'Update DNS (off: only watch)' }),
  S('dnsEvery', 'DNS_CHECK_MINUTES', 'dns', 'int', { def: 10, label: 'DNS check every, minutes' }),

  /* public website */
  S('cfAccountId', 'CF_ACCOUNT_ID', 'website', 'str', { wizard: 'extras', live: true, label: 'Cloudflare account ID' }),
  S('cfPagesToken', 'CF_PAGES_TOKEN', 'website', 'str', { secret: true, wizard: 'extras', live: true, label: 'Cloudflare Pages token' }),
  S('cfPagesProject', 'CF_PAGES_PROJECT', 'website', 'str', { wizard: 'extras', live: true, label: 'Cloudflare Pages project' }),
  S('siteUrl', 'SITE_URL', 'website', 'url', { wizard: 'extras', live: true, label: 'Portfolio address' }),

  /* downloads */
  S('prezip', 'PREZIP', 'downloads', 'on', { label: 'Prepare zips ahead of time' }),
  S('zipDir', 'ZIP_DIR', 'downloads', 'str', { label: 'Zip folder' }),
  S('zipMaxActive', 'ZIP_MAX_ACTIVE', 'downloads', 'int', { def: 3, label: 'Downloads at once' }),
  S('zipTotalMbit', 'ZIP_TOTAL_MBIT', 'downloads', 'int', { def: 120, label: 'Share of upload speed, Mbit/s' }),
  S('zipRateMbit', 'ZIP_RATE_MBIT', 'downloads', 'int', { def: 0, label: 'Cap per download, Mbit/s' }),
  S('zipMaxGb', 'ZIP_MAX_GB', 'downloads', 'int', { def: 100, label: 'Zip storage, GB' }),
  S('zipMinFreeGb', 'ZIP_MIN_FREE_GB', 'downloads', 'int', { def: 50, label: 'Keep this much disk free, GB' }),
  S('zipSweepMin', 'ZIP_SWEEP_MINUTES', 'downloads', 'int', { def: 60, label: 'Look for new zips every, minutes' }),
  S('zipSettleMin', 'ZIP_SETTLE_MINUTES', 'downloads', 'int', { def: 10, label: 'Wait after changes, minutes' }),
  S('zipStallSec', 'ZIP_STALL_SECONDS', 'downloads', 'int', { def: 120, label: 'Give up a stalled download after, seconds' }),

  /* self-checks */
  S('healthMinutes', 'HEALTH_MINUTES', 'health', 'int', { def: 30, label: 'Self-check every, minutes' }),
  S('healthFirstSec', 'HEALTH_FIRST_SECONDS', 'health', 'int', { def: 120, hidden: true }),
  S('healthMinFreeGb', 'HEALTH_MIN_FREE_GB', 'health', 'int', { def: 20, label: 'Warn below this free disk, GB' }),
];

export const BY_ENV = new Map(SETTINGS.map(s => [s.env, s]));
export const BY_KEY = new Map(SETTINGS.map(s => [s.key, s]));

/* one raw text value (or nothing) -> the value the server uses. This is the same arithmetic the
   server always did on process.env: an empty value means "use the default". */
export function normalise(s, raw) {
  const r = raw === undefined || raw === null ? '' : String(raw);
  switch (s.type) {
    case 'int': return Number(r || s.def);
    case 'on': return (r || 'on').toLowerCase() !== 'off';
    case 'flag': return (r || 'off').toLowerCase() === 'on';      /* off unless switched on */
    case 'email': return (r || '').trim().toLowerCase();
    case 'url': return (r || s.def || '').replace(/\/+$/, '');
    default: return r || s.def || '';
  }
}

/* is this text acceptable for the setting? used by the setup page before anything is saved */
export function validate(env, raw) {
  const s = BY_ENV.get(env);
  if (!s) return { ok: false, error: 'Unknown setting' };
  let v = raw === undefined || raw === null ? '' : String(raw).trim();
  if (v.length > 2000) return { ok: false, error: 'That is too long' };
  if (!v) return { ok: true, value: '' };
  switch (s.type) {
    case 'int': {
      if (!/^\d{1,9}$/.test(v)) return { ok: false, error: 'Use a whole number' };
      return { ok: true, value: v };
    }
    case 'on':
    case 'flag': {
      v = v.toLowerCase();
      return v === 'on' || v === 'off' ? { ok: true, value: v } : { ok: false, error: 'Use on or off' };
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { ok: true, value: v.toLowerCase() } : { ok: false, error: 'That is not an email address' };
    case 'url': {
      let u; try { u = new URL(v); } catch { return { ok: false, error: 'That is not a web address. Start it with http:// or https://' }; }
      if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'Start it with http:// or https://' };
      return { ok: true, value: v.replace(/\/+$/, '') };
    }
    default: {
      if (s.choices && !s.choices.includes(v)) return { ok: false, error: `Use one of: ${s.choices.filter(Boolean).join(', ')}` };
      if (env === 'MAIL_FROM' && !/^([^<>]+<)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(v))
        return { ok: false, error: 'Use the form: Your Studio <hello@yourdomain.com>' };
      if (/[\r\n]/.test(v)) return { ok: false, error: 'That must be on one line' };
      return { ok: true, value: v };
    }
  }
}
