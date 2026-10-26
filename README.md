# immichset

Client photo galleries on top of [Immich](https://immich.app) — a self-hosted alternative to
Pixieset's gallery delivery, for photographers who already keep their work in Immich.

Immich stays the photo engine: ingest, thumbnails, transcoding, storage. **immichset** owns
everything client-facing — the gallery page, who may see it, and what they did.

> **Early software.** One author, no test suite, and it handles authentication and client
> personal data. Read it before you put it in front of paying clients.

---

## What it does

- **Branded gallery pages** — full-bleed cover, justified grid, fullscreen lightbox, slideshow
- **Sets** — deliver a gallery in named parts (Ceremony, Dancing), reorderable; a gallery with
  one set never shows its name
- **Any image as the cover** — upload one or pick from the album, with a focal point so a tall
  photo crops on the right thing
- **Photo order** — newest first, or chronological
- **Two independent gates per gallery** — ask for an email, require a password, both, or neither
- **Favourites** — clients pick their photos; you see each client's list, and they can download
  just those
- **Downloads** — web size or full resolution per photo, and each set as a zip that is built ahead of
  time and can resume if the connection drops. Only a few downloads run at once; the rest wait in
  line with their place shown, so a big gallery cannot starve everyone else on a home connection
- **Link previews** — a pasted gallery link shows its cover, title and date
- **Save to Photos on iOS** — via the share sheet, not a file dumped into Downloads
- **Activity** — who registered, who opened it, what was downloaded
- **Email** — "your gallery is ready", plus expiry reminders you schedule per gallery
- **Upload from the admin panel** — drag photos in, or start a fresh Immich album with the
  gallery; optional, and off unless you give it a key that may write
- **Mobile admin** — create and manage galleries from a phone
- **Nightly database backups** that are consistent while running

The Immich API key never reaches the browser. Every image is proxied, so a forwarded link
doesn't grant access.

## How it fits together

```
client ──▶ immichset ──▶ sessions, registrations, events, email   (SQLite)
                      ──▶ Immich, with a read-only key the client never sees
```

A gallery is made of **sets** — named parts, each backed by its own Immich album. One set is the
normal case and the client just sees the photos; add a second and a row of names appears for them
to switch between, with Download All following whichever is open.

A gallery lives at `https://your-domain/<slug>`. The older `/g/<slug>` form redirects there, so
links already sent out keep working, and slugs that would collide with the app's own paths
(`admin`, `api`, `healthz`, …) are refused.

Each set points at an Immich album. Add or remove photos in Immich and the set follows — or, with
a write key set, drop them straight onto the set in the admin panel and immichset creates the album
and uploads for you.

## Requirements

- A running Immich instance (developed against v3.2)
- Docker, and a reverse proxy terminating HTTPS
- Optionally a [Resend](https://resend.com) account for email

## Install

1. Clone this repo onto the host.
2. `cp docker-compose.example.yml docker-compose.yml` and fill it in.
3. In Immich, create a **read-only** API key: `asset.read`, `asset.view`, `asset.download`,
   `album.read`, `album.download`, `timeline.read`, `timeline.download`.
   To manage photos from the admin panel, create a **second** key and set it as
   `IMMICH_WRITE_KEY`: `asset.upload`, `album.create` and `albumAsset.create` to add,
   plus `asset.delete` and `albumAsset.delete` to remove. Keeping the two keys apart means
   the client-facing path cannot change anything in Immich even if it is compromised.
   Grant only the half you want — the panel probes the key on startup and shows just the
   actions it will allow.
4. Generate long random values for `APP_SECRET` and `ADMIN_TOKEN`.
5. `docker compose up -d`
6. Point your proxy at the container and open `/admin`.

### Branding

Set `BRAND_NAME`, `BRAND_URL`, `BRAND_SOCIAL` and `BRAND_SOCIAL_LABEL`. For your own logo, drop a
**`web/brand-logo.png`** — black artwork on a transparent background. It is used as a mask, so it
renders white over the cover photo and dark in the footer. Without one, a neutral aperture is used.

It also becomes the favicon and iOS home-screen icon. Optionally add
**`web/brand-logo-dark.png`** — the same mark in white — and browsers in dark mode will use it,
so the icon stays visible on a dark tab strip.

### Managing photos

Optional, and off unless `IMMICH_WRITE_KEY` is set. With it, a gallery's **Photos** tab is enough
to run a shoot without opening Immich:

- **Add** — drop a batch on the album the gallery reads from, or let the new-gallery form create
  that album first
- **Replace** — swap one photo for a re-edit; the new file goes in before the old one comes out,
  and if the old one was the cover, the cover follows
- **Remove from gallery** — out of the album, still in Immich
- **Move to trash** — into Immich's trash, where it keeps for 30 days, with an undo in the toast

Photos and video both: JPEG, PNG, HEIC, WebP, AVIF, GIF, TIFF, DNG, and MP4, MOV, M4V, WebM, MKV,
AVI, WMV, 3GP, MTS, M2TS, MPEG. `UPLOAD_MAX_MB` caps a photo (default 250) and
`UPLOAD_MAX_VIDEO_MB` a video (default 4096).

A file is streamed straight through to Immich rather than read into memory first, so a multi-gigabyte
video costs tens of megabytes of RAM to pass on, not its own size. One file per request, so each gets
its own progress bar and one failure does not take the batch down. Immich deduplicates by checksum, so
re-dropping a folder is safe — what is already there comes back as a duplicate rather than a second copy.

Nothing here deletes a file outright: trashing is Immich's recoverable trash, and the panel's undo
only reaches photos it trashed itself.

### Covers

A gallery's cover is a photo from its album, or an image of your own. An uploaded cover is stored
beside the database in `DATA_DIR/covers`, never added to the album and never pushed into Immich, so
clients see it on the cover and in emails but never in the grid. No write key needed.

JPEG, PNG, WebP, AVIF or GIF — HEIC is refused because browsers will not display it. Drop in a
full-resolution export: anything over 2400px on its long edge is resized in the browser before it
uploads, by canvas rather than a server-side image library. An image that is already web-sized goes
up untouched, and a GIF is never redrawn, since it may be animated. Covers are included in the nightly backup.

### Download zips and the queue

Each set of a published gallery that allows downloads gets one zip, built in the background and kept in
`ZIP_DIR` (default `DATA_DIR/zips`). It is a plain store-only zip written by the app itself, so it opens
anywhere and can be served with HTTP Range: a phone that loses signal resumes instead of starting over.
When photos are added or removed the zip is rebuilt once the set has held still for `ZIP_SETTLE_MINUTES`,
and an out-of-date zip is never served. Zips are deleted when a gallery is unpublished, expires, is
deleted or has downloads switched off, and the least recently used are removed past `ZIP_MAX_GB`.

Favourites and hand-picked selections can't be prepared ahead, so Immich builds them as they are sent;
they use the same queue. Up to `ZIP_MAX_ACTIVE` downloads run at once and share `ZIP_TOTAL_MBIT` of your
upload speed; anyone else sees "You're 2nd in line" and starts automatically. The **Downloads** tab shows
each set's zip and the queue. Keep `ZIP_DIR` on a local disk, not a network share. Set `PREZIP=off` to
turn the prepared zips off and keep only the queue.

### Email

Verify your domain in Resend and add the DNS records it gives you, including DMARC. Mail sent from
a residential IP without SPF and DKIM will land in spam.

## Security notes

- Passwords are scrypt with a per-user salt; sign-in is throttled per IP
- Admin sign-in is email + password + a 6-digit code emailed to you (`ADMIN_2FA: "off"` disables
  it if your mail provider fails and you are locked out)
- Session cookies are HttpOnly, SameSite=Lax, and Secure behind HTTPS
- Gallery visitors' emails are **collected, not verified** — deliberately, matching how Pixieset
  works. The password is the access control; registration is to know your audience
- Image requests are checked against the gallery's album, so a session for one gallery cannot
  read another's photos
- The write key is separate from the read key, and the client-facing path never touches it. It
  holds only what the Photos tab needs, and trashing goes to Immich's recoverable trash — nothing
  in this app can delete a photo outright. Leave the two `*.delete` permissions off and the panel
  becomes add-only

### Dynamic DNS

Optional. A gallery served from a home connection is only reachable while its A record
matches whatever address the ISP last handed out, and nothing announces a change — the first
sign is a client saying the link is dead.

Set `DNS_DOMAIN`, `DNS_HOST` and a token for whoever hosts the domain's DNS —
`HOSTINGER_TOKEN` or `CLOUDFLARE_TOKEN` — and the app checks every `DNS_CHECK_MINUTES`
(default 10) and corrects the record itself, emailing you when it does.
`DNS_APPLY: "off"` watches and emails without changing anything.

Both tokens can be set at once. That is for moving a domain from one to the other: until
the nameserver change has fully spread, either copy of the record may be the one people
see, so both are kept right. Remove the old token once the move is done.

The Cloudflare token needs only **Zone → DNS → Edit**, limited to the one domain. The
record must already exist; the app corrects an address, it never creates a record, and it
leaves the record's proxy setting as it is.

Guards, because this writes to live DNS: two independent lookups must agree before anything
is believed, private, loopback and carrier-NAT addresses are refused, a new address must appear
twice running, and at most one change is made per hour. Only the one `name`/`type` named above is
sent, so neighbouring records — SPF, DKIM, DMARC — are never part of the request. The lookups use
IPv4-only endpoints: asked over a dual-stack connection, the usual ones answer with an IPv6
address.

### Public website

Optional. The admin panel's **Website** section edits a simple portfolio site — galleries,
About and Contact pages, colours and fonts — and publishes it to Cloudflare Pages, so the
public site never depends on this machine. Uploaded originals also go to Immich, into a
`Website – <gallery>` album, using the write key.

Set `CF_ACCOUNT_ID`, `CF_PAGES_TOKEN` (an account token with **Cloudflare Pages → Edit**),
`CF_PAGES_PROJECT` and `SITE_URL`. Without them the section still edits and previews.
Each publish is kept as a version (the last 10) and can be restored. Failed publishes, photos
that never reach Immich, and the site going down are emailed to `ADMIN_EMAIL`.

## Backups

`BACKUP_DIR` enables a daily `VACUUM INTO` snapshot, keeping `BACKUP_KEEP` days. It is consistent
while the app is serving, unlike copying the live file. Uploaded covers are copied alongside it
into `BACKUP_DIR/covers`, since they live on disk rather than in the database and a snapshot
without them restores galleries pointing at files that are not there. A cover that has been
replaced is kept for as long as the snapshots that reference it. **Immich's own database is separate** —
enable its scheduled backup too.

## Keeping it running

[`RUNBOOK.md`](RUNBOOK.md) is the operations guide: how it fits together, how to deploy,
what to do when something breaks, how to restore, and the traps that have already cost
somebody a day. Written for whoever holds this next, including an AI agent picking it up
cold. Site-specific values belong in a private note beside the server, not in this repo.

## Checking it still works

`smoke.mjs` walks a running instance the way a client would and prints a line per check.
It needs nothing installed.

```
ADMIN_TOKEN=... node smoke.mjs https://your-domain
ADMIN_TOKEN=... node smoke.mjs https://your-domain --write    # also uploads and trashes a photo
```

It builds a throwaway gallery called `smoke-check` against the smallest album it can find,
exercises the gates, the sets, the sizes, favourites, ordering, expiry and the backups, then
removes it — including when a check fails part way. Originals are fetched as a one-kilobyte
range, so a gallery of video does not mean downloading a gigabyte to test a URL. Exit code 0
means everything passed.

Run it after any change, and before sending a gallery to a client.

## Limitations

- No watermarking
- One admin account

## Licence

AGPL-3.0. If you run a modified version as a network service, publish your changes.
