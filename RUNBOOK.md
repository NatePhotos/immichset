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

It refuses to run without `IMMICH_URL`, `IMMICH_API_KEY`, `APP_SECRET` and `ADMIN_TOKEN`,
and says which is missing. Otherwise read the log ring from the container.

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
compose file.

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
