# Runbook

For whoever keeps this running — including an AI agent picking it up cold.
Read this before changing anything.

Site-specific values (hostnames, paths, which album is which) are deliberately **not**
here, because this file is public. They belong in a private note kept beside the server.

---

## The shape of it

```
client ──▶ reverse proxy (TLS) ──▶ immichset  ──▶ Immich  ──▶ photos on disk
                                        │
                                        └──▶ SQLite: galleries, sets, registrations,
                                             favourites, events, invites, mail, reminders
```

Immich owns the photos. immichset owns everything client-facing: who may see a gallery,
what they did, and the emails. A gallery is one or more **sets**, each backed by its own
Immich album.

Immich is never exposed to clients. Every image is proxied, so a forwarded URL grants
nothing without a session.

### Three files, no dependencies

| File | What it is |
|---|---|
| `server.mjs` | The whole server. Node built-ins only — `http`, `sqlite`, `crypto`, `fs`, `zlib`. |
| `zip/writer.mjs`, `zip/queue.mjs` | The zip file writer and the download queue. Small, pure, with tests in `zip/test` (`node --test zip/test/`; everything: `node --test admin/test health/test zip/test mail/test config/test setup/test site/test`). |
| `config/settings.mjs`, `config/store.mjs` | Every setting in one list, and where it comes from (environment, then the settings file, then the default). `config/test` includes a golden test that the same environment always builds the same config as before. |
| `setup/*.mjs`, `web/setup.html` | The first-run setup page and its server, the setup-code protection, and the tests behind every Test button (also used by Connections). `setup/test/fresh-install.test.mjs` walks a whole new install. |
| `mail/blast.mjs` | Fills a mailing template for one person, signs unsubscribe links, picks recipients, and decides how to react to the mail service. Pure, tested in `mail/test`. |
| `health/watchdog.mjs` | Runs the self-checks and decides when to email. Pure, tested in `health/test`. |
| `web/index.html` | The client gallery. One file: markup, CSS, script. |
| `web/admin.html` | The admin panel. Same. |

**There is no build step and no `node_modules`.** That is the point: nothing to update,
nothing to rot. Keep it that way — adding a dependency is a decision about the next five
years, not about this afternoon.

### Finding your way around `server.mjs`

Roughly in order: config and schema · migrations · prepared statements · sessions and
cookies · mail · backups · covers · Immich helpers · the image proxy · public gallery
routes (`/api/g/<slug>/…`) · admin routes (`/api/admin/…`) · static and slug routing ·
dynamic DNS · the scheduled jobs at the bottom.

Two keys to Immich: a read-only one for everything client-facing, and an optional
write one used only by the admin panel. Keeping them apart is deliberate.

---

## Deploying a change

```
./deploy.sh              check, copy, restart, test
./deploy.sh --dry-run    say what would change and stop
./deploy.sh --rollback   put the previous files back
```

Settings live in `.deploy.env` beside the script — copy `.deploy.env.example` and fill it
in. That file names your server, so it is gitignored.

What it does, in order: parses `server.mjs` and the script inside each HTML file, so a
typo never reaches the server; snapshots the three files currently on the host into
`.previous`; copies anything that differs; restarts and waits for `/healthz`; then runs
the smoke test. If the tests fail it says so and exits non-zero, and `--rollback` puts
back exactly the set that was running before.

Only `server.mjs` needs the restart — the two HTML files are read per request — but the
script restarts anyway, which costs a couple of seconds and removes a thing to remember.

**Do not skip the test.** It takes ninety seconds and it is the only thing standing between
a change and a client finding the problem for you. `--no-test` exists for emergencies.

### By hand, if the script is unavailable

Copy `server.mjs` and `web/*.html` to the app's directory on the host, then
`curl -X POST <base>/api/admin/restart -H "x-admin-token: <token>"`. The container's
`restart: always` brings it back on the new source.

### Changing configuration

Environment variables live in the container's compose file, not in this repo.
`docker-compose.example.yml` lists every one with a comment. Changing any of them means
editing the compose and redeploying the container — a restart is not enough.

---

## When something is wrong

**Start here:** `curl <base>/healthz` and read the log ring:

```
curl -s "<base>/api/admin/logs?n=50" -H "x-admin-token: <token>"
```

The app keeps its recent output in memory and serves it there, so you can see what it
said without shell access to the host.

### A gallery link is dead

Check DNS first — `dig +short <host>` against the connection's current address. For a
home connection the address moves; if `HOSTINGER_TOKEN`/`CLOUDFLARE_TOKEN` and
`DNS_DOMAIN`/`DNS_HOST` are set the app corrects it within two checks and emails you,
and the boot line says which provider it is using. If it is not set, fix the A record by
hand.

Then the certificate: `echo | openssl s_client -connect <host>:443 2>/dev/null |
openssl x509 -noout -dates`.

### Downloads are slow, or "you're Nth in line" for a long time

Full-gallery downloads are limited by your upload speed, not by the NAS. `GET /api/admin/zips` (or the
Downloads tab) shows what is running and waiting. Raise `ZIP_MAX_ACTIVE` only if your uplink can carry
more; lower `ZIP_TOTAL_MBIT` to leave more room for browsing. A zip that shows "failed" is retried hourly,
or on **Rebuild now**; "over_budget" means `ZIP_MAX_GB` or `ZIP_MIN_FREE_GB` leaves no room, and that
download is built as it is sent instead. If the reverse proxy buffers responses (nginx: `proxy_buffering off`),
it will drain a zip into its own storage and bypass the speed limit; the app sends `X-Accel-Buffering: no`
to prevent that.

### A mailing is paused, stuck, or someone says they still get email

**Paused**: the mail service refused a request (usually the Resend key or domain), or ten sends in a row
failed. Fix it, then **Resume** from Contacts › Mailings. **Failed rows** can be retried from the same page.
**"Still getting email"**: if they unsubscribed from mailings they still get gallery notices and reminders by
design; the second button on the unsubscribe page, or adding them under Unsubscribed with "Everything", stops
those too. **Nothing sends at all**: check `BRAND_ADDRESS` is set, that you are signed in in the browser (the API
token cannot send mailings), and that `MAIL_SEND` is not `off`. **Emergency stop**: set `MAIL_SEND=off` and
restart; every mailing is then simulated. Rotating `APP_SECRET` breaks every unsubscribe link already sent;
they show a page asking the person to reply instead.

### An email says "needs attention"

It names the check. **Immich**: the NAS or container is down, the key was revoked, or an Immich update
changed its photo-list format (the message says which). **Disk space**: free some, or lower `ZIP_MAX_GB`.
**Backups**: the backup folder is not mounted or writable. **Prepared zips**: open the gallery's Downloads
tab for the error, then Rebuild now. **Downloads**: people waited ~30 minutes; see the usage numbers on the
same tab. `GET /api/admin/health` shows the current state of every check; `HEALTH_MINUTES=0` turns the watch off.

### Photos do not load but the page does

Immich is unreachable or the read key has lapsed. `GET /api/admin/albums` through the
app proves both at once. A 401 from Immich means the key; a timeout means Immich.

### "Could not send your code" at sign-in

Mail. `GET /api/admin/mail-status` says whether it is configured. The log ring carries
the provider's own error. If the provider is fine, check SPF, DKIM and DMARC still
resolve — a domain move silently breaks them.

### Locked out of the admin panel

Two-factor mails a code; if mail is broken the code never arrives. Set `ADMIN_2FA: "off"`
in the compose and redeploy to get back in, then turn it on again. `ADMIN_TOKEN` also
works as an `x-admin-token` header and bypasses two-factor entirely — that is how every
command in this runbook authenticates, and it is why the token is a secret.

### The app will not start

A fresh install with no Immich address or key is not broken: it is in **setup mode**, and prints a setup
code in the log. Open `/setup` and enter it (`docker exec <container> cat /data/setup-code.txt`). An
install whose settings come from the compose file never enters setup. If the log says the data folder
is not writable, the container runs as uid 1000: `chown -R 1000:1000 <folder>`, or set `user:`.
`APP_SECRET` and `ADMIN_TOKEN` are made automatically (stored in `/data/immichset.json`) if nobody
supplied them. Otherwise read the log ring from the container.

### Restoring from a backup

`BACKUP_DIR` holds a dated SQLite snapshot per day plus a `covers/` folder. To restore:
stop the container, put the chosen `gallery-YYYY-MM-DD.db` in place of `gallery.db` in
`DATA_DIR`, copy the cover files back into `DATA_DIR/covers`, start it again.

The photos are not in there and do not need to be — they are Immich's. **Immich has its
own database, and this backup does not cover it.** Turn on Immich's scheduled backup
separately; without it the photos survive but the albums do not, and galleries point at
albums.

---

## Secrets

Six things are secret. None belongs in this repo; `.gitignore` already blocks the real
compose file. A secret may come from the compose file (which wins) or from `/data/immichset.json`,
which the setup page and Connections screen write (mode 0600, not encrypted, not in the backups;
download it from Connections after signing in, and keep it private). `APP_SECRET` and
`ADMIN_TOKEN` are generated into that file if neither place has them. Losing `APP_SECRET` signs
everyone out and breaks the unsubscribe links in emails already sent.

| Name | What it opens | Rotating it |
|---|---|---|
| `ADMIN_TOKEN` | Full admin API, bypassing two-factor | Any long random string; change and redeploy |
| `APP_SECRET` | Signs every session cookie | Changing it signs everyone out, clients included |
| `ADMIN_PASSWORD` | The admin sign-in | Change and redeploy |
| `IMMICH_API_KEY` | Read-only Immich | Reissue in Immich, change, redeploy |
| `IMMICH_WRITE_KEY` | Uploading and trashing | As above. Needs `asset.upload`, `album.create`, `albumAsset.create`, and `asset.delete` + `albumAsset.delete` to remove |
| `RESEND_API_KEY` | Sending mail as your domain | Reissue at the provider |
| DNS provider token | Rewriting one A record | Reissue; least privilege is DNS edit on the one zone |

Anything pasted into a chat, a ticket or a log is burned. Rotate it.

---

## Working on this

**Run the smoke test before you start and before you finish.** Before, so you know what
was already broken. After, so you know what you broke. `./deploy.sh` runs it for you at
the end; running it at the start is on you.

**Commit before handing over, and commit after.** If two people — or two agents — have
this open at once, `git add -A` sweeps up whatever the other one left uncommitted and
ships it under your message. That has already happened here once.

**No dependencies.** If something seems to need one, it probably needs less cleverness
instead. The one genuine exception on the horizon is server-side image processing; nothing
else has come close.

**Comments say why, not what.** The code says what it does. Explain the constraint that
made it look like that, especially where it looks odd.

**Honour the two-key split.** Client-facing code paths use the read key. If a change makes
the public side able to write to Immich, that is a bug however well it works.

---

## Traps

Hard-won. Every one of these cost real time.

**The Immich timeline returns newest first.** Chronological is the reverse. A gallery's
`sort_order` decides, and the admin grid has to match or what you arrange is not what
they see.

**`max-height: 100%` does nothing inside an auto-sized grid track.** The track grows to
the content, so the percentage measures against the content and the constraint evaporates.
`minmax(0, 1fr)`.

**`background-size: cover` leaves no slack when the image and the window are the same
shape**, so a focal point has nothing to move. Size it explicitly, a little larger.

**Public IP lookups answer over IPv6 on a dual-stack connection**, which is useless for an
A record. Use the v4-only hostnames, and never trust a single source.

**An empty id list can mean "all".** Before sending one to any API that deletes or
restores, make sure it does not. Probe with a well-formed id that belongs to nothing.

**SMB is case-insensitive and Linux is not.** `Photos` and `photos` are the same directory
from a Mac and two different ones in the container.

**A Docker named volume bakes its `driver_opts` at creation.** Changing credentials in the
compose does nothing until the volume is removed and recreated.

**Immich cannot show an API key again after creation**, and editing a key's permissions is
a different act from recreating it. `Invalid API key` means recreated; `Missing required
permission` means wrongly scoped.

**`GID` is reserved in zsh.** Naming a shell variable that fails strangely.

**`pkill -f "node server.mjs"` does not match `node /full/path/server.mjs`.** Stray test
processes that survive a cleanup will answer on the port you thought you freed and hand
you baffling results.

**Not every upstream sends `content-length`.** A test that reads the header rather than
measuring the body it received will pass against one server and fail against another,
and the failure will look like a bug in the thing being tested.

**A partial snapshot is worse than none.** Saving only the files a deploy changes leaves
a `.previous` that mixes one deploy with another, so rolling back restores a combination
that never ran. Snapshot the whole set every time.

**Reverse proxies compress HTML and often not JSON.** Check rather than assume.

**`immutable` is right for a photo and wrong for a cover.** A photo is addressed by asset
id and never changes; a cover is addressed by gallery and can be swapped.

**`position: fixed` is measured against the layout viewport, not what is on screen.** On
iOS the visible area can sit lower inside that viewport — after a keyboard closes, or when
locking the body collapses the page — and a full-screen overlay then renders above the
screen, taking its top bar with it. `visualViewport.offsetTop` is the only thing that
reports the gap; the lightbox follows it through `--lbt`. The same applies in Chrome on
iPhone, which is WebKit underneath.

**There are three ways out of the lightbox and they are easy to break.** The X in the top
bar, Escape on a desktop, and a tap on the dark surround — which works because `.bar` is
`pointer-events:none`, so a tap over it falls through to the stage, and because the
`touchmove` handler calls `preventDefault`, so a swipe between photos never synthesises the
click that would dismiss it. Change either of those and the gesture quietly stops working,
or starts firing when it should not. `smoke.mjs` asserts all three are still wired.

## Installer and bundled Immich

`install/install.sh` sets up immichset, optionally with Immich's official release files downloaded alongside
(`IMMICH_RELEASE` in the script is the tested version). Our compose files layer on top of Immich's through
`COMPOSE_FILE` in `.env`; Immich's own files are never edited.

Traps:
- Never regenerate `DB_PASSWORD` in an existing install: the database was initialised with it and Immich won't start.
- Compose merges list keys by appending, so our files avoid redefining lists Immich already sets.
- Every module `server.mjs` imports must be in the `FILES` list of `deploy.sh` (a test enforces this).
- The real-Docker check is `.github/workflows/bundled.yml`; locally only fakes are exercised.
