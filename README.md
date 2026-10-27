# immichset

Client photo galleries on top of [Immich](https://immich.app), a self-hosted alternative to
Pixieset's gallery delivery, for photographers who already keep their work in Immich.

Immich stays the photo engine: ingest, thumbnails, transcoding, storage. **immichset** owns
everything client-facing: the gallery page, who may see it, and what they did.

> **Early software.** One author, and it handles authentication and client personal data. It has
> a test suite (including a walk through a brand-new install), but read the code before you put it
> in front of paying clients.

---

## What it does

- **Branded gallery pages**: full-bleed cover, justified grid, fullscreen lightbox, slideshow
- **Sets**: deliver a gallery in named parts (Ceremony, Dancing), reorderable; a gallery with
  one set never shows its name
- **Any image as the cover**: upload one or pick from the album, with a focal point so a tall
  photo crops on the right thing
- **Photo order**: newest first, or chronological
- **Two independent gates per gallery**: ask for an email, require a password, both, or neither
- **Favourites**: clients pick their photos; you see each client's list, and they can download
  just those
- **Downloads**: web size or full resolution per photo, and each set as a zip that is built ahead of
  time and can resume if the connection drops. Only a few downloads run at once; the rest wait in
  line with their place shown, so a big gallery cannot starve everyone else on a home connection
- **Link previews**: a pasted gallery link shows its cover, title and date
- **Save to Photos on iOS**: via the share sheet, not a file dumped into Downloads
- **Activity**: who registered, who opened it, what was downloaded
- **Email**: "your gallery is ready", plus expiry reminders you schedule per gallery
- **Upload from the admin panel**: drag photos in, or start a fresh Immich album with the
  gallery; optional, and off unless you give it a key that may write
- **Mobile admin**: create and manage galleries from a phone
- **Nightly database backups** that are consistent while running

The Immich API key never reaches the browser. Every image is proxied, so a forwarded link
doesn't grant access.

## How it fits together

```
client ──▶ immichset ──▶ sessions, registrations, events, email   (SQLite)
                      ──▶ Immich, with a read-only key the client never sees
```

A gallery is made of **sets**: named parts, each backed by its own Immich album. One set is the
normal case and the client just sees the photos; add a second and a row of names appears for them
to switch between, with Download All following whichever is open.

A gallery lives at `https://your-domain/<slug>`. The older `/g/<slug>` form redirects there, so
links already sent out keep working, and slugs that would collide with the app's own paths
(`admin`, `api`, `healthz`, …) are refused.

Each set points at an Immich album. Add or remove photos in Immich and the set follows, or, with
a write key set, drop them straight onto the set in the admin panel and immichset creates the album
and uploads for you.

## Quick start

**Never done this before? Read [docs/START-HERE.md](docs/START-HERE.md).** It can install immichset *and* Immich for you.

The short version, if you already run Immich:

You need Immich running, and about ten minutes.

1. Save [`docker-compose.quickstart.yml`](docker-compose.quickstart.yml) as `docker-compose.yml` and run
   `docker compose up -d`.
2. Run `docker logs immichset` to see your **setup code**, then open `http://<your server>:3000/setup`.
3. Follow the page. It asks for your Immich key, optionally a Resend key for email, and who you are,
   and **tests each one** before you move on, telling you in plain words what to fix.

That's the whole install. The step-by-step guide, with exactly which permissions to tick in Immich,
how to verify an email domain, and how to put it on the internet over https, is
**[docs/SETUP.md](docs/SETUP.md)**, which has a screenshot for every step and starts from nothing
(installing Docker and Immich).

Prefer environment variables? [`docker-compose.example.yml`](docker-compose.example.yml) lists every
setting; anything set there wins over what the setup page saved. Running from a clone of this repo
instead of the image works the same way (`node server.mjs`, with the settings as environment variables).

### The keys it needs

| Key | Where from | Needed for |
|---|---|---|
| Immich read-only API key | Immich › Account Settings › API Keys | Everything: showing photos |
| Immich write key *(optional)* | The same place; a second key | Adding and removing photos from the admin |
| Resend API key *(optional)* | resend.com › API Keys (sending access) | Gallery emails, reminders, mailings, sign-in codes |
| Cloudflare / Hostinger token *(optional)* | Your DNS provider | Keeping a home address up to date |
| Cloudflare Pages token *(optional)* | Cloudflare | Publishing a portfolio website |

The app makes its own session secret and admin token. You never invent those.

### Branding

Set your business name, address and links in the admin under **Connections › Your business** (or with
`BRAND_NAME`, `BRAND_URL`, `BRAND_SOCIAL` and `BRAND_SOCIAL_LABEL`). Upload your own logo on the same screen: a PNG with a
transparent background and black artwork, which is used as a mask, so it renders white over the cover photo and dark in the
footer. The upload is kept in the data folder and refused if it has a solid background. Without one, a neutral aperture is
used. It also becomes the favicon and iOS home-screen icon. Files placed by hand still work: `brand-logo.png` and an
optional white `brand-logo-dark.png` for dark browser tabs, in the data folder or the web folder.

### Managing photos

Optional, and off unless `IMMICH_WRITE_KEY` is set. With it, a gallery's **Photos** tab is enough
to run a shoot without opening Immich:

- **Add**: drop a batch on the album the gallery reads from, or let the new-gallery form create
  that album first
- **Replace**: swap one photo for a re-edit; the new file goes in before the old one comes out,
  and if the old one was the cover, the cover follows
- **Remove from gallery**: out of the album, still in Immich
- **Move to trash**: into Immich's trash, where it keeps for 30 days, with an undo in the toast

Photos and video both: JPEG, PNG, HEIC, WebP, AVIF, GIF, TIFF, DNG, and MP4, MOV, M4V, WebM, MKV,
AVI, WMV, 3GP, MTS, M2TS, MPEG. `UPLOAD_MAX_MB` caps a photo (default 250) and
`UPLOAD_MAX_VIDEO_MB` a video (default 4096).

A file is streamed straight through to Immich rather than read into memory first, so a multi-gigabyte
video costs tens of megabytes of RAM to pass on, not its own size. One file per request, so each gets
its own progress bar and one failure does not take the batch down. Immich deduplicates by checksum, so
re-dropping a folder is safe: what is already there comes back as a duplicate rather than a second copy.

Nothing here deletes a file outright: trashing is Immich's recoverable trash, and the panel's undo
only reaches photos it trashed itself.

### Covers

A gallery's cover is a photo from its album, or an image of your own. An uploaded cover is stored
beside the database in `DATA_DIR/covers`, never added to the album and never pushed into Immich, so
clients see it on the cover and in emails but never in the grid. No write key needed.

JPEG, PNG, WebP, AVIF or GIF. HEIC is refused because browsers will not display it. Drop in a
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

### Watching itself, and download numbers

Every `HEALTH_MINUTES` (default 30) the app checks Immich, free disk space, the newest backup, failed
zips, and whether people have been stuck in the download line. A problem has to survive two checks
before it emails you; it repeats at most once a day and sends a note when it clears. The Immich check
also reads one real album the way galleries do, so an Immich update that changes its photo-list format
shows up here before a client sees an empty gallery. The results appear as cards on the admin Home page.

The **Downloads** tab shows the last 30 days: full downloads, bytes sent, how long people waited, the
busiest moment, and how many hours the line backed up. If the line keeps backing up, your upload speed
is the limit. Album photo lists are cached for a minute, so opening a gallery no longer costs a dozen
Immich calls; changes made from the admin panel clear the cache at once.

### Emailing your contacts

**Contacts** lists everyone who registered for a gallery. Tick some people (or none, for everyone in the
current filter) and choose **Email**: pick a mailing template, edit it, preview it as any recipient, send a
test to yourself, then review and send. The starter templates are New work, Seasonal check-in and Your
gallery is closing soon; make your own under **Mailing templates**. Placeholders: `{{name}}` (first name),
`{{title}}`, `{{subtitle}}`, `{{link}}`, `{{expiry}}` (the person's most recent live gallery), `{{brand}}`,
`{{site}}`. A template that uses a gallery placeholder skips anyone without a live gallery.

The editor works like a campaign editor: **subject** and **preview text** (the line shown in the inbox),
an optional **title**, an **image** (each person's own gallery cover, a picture you upload, or none), the
**message** with bold, italic, underline and links, a **button** that goes to each person's gallery, your
website or any address, and an optional "Available until" line from their gallery's expiry date. Uploaded
pictures are shrunk in your browser, stored in `DATA_DIR/mail-images` under unguessable names, and kept
forever so old emails keep working; they are included in the nightly backup. Gallery passwords can't be
included, because only a hash of them is stored.

What keeps this safe to use on real clients:
- **Every mailing carries your postal address and a working unsubscribe link**, and sets the one-click
  unsubscribe headers mail apps look for. Set `BRAND_ADDRESS` before sending; until then only previews and
  tests work. Registering for a gallery is not the same as agreeing to marketing, so for clients in the EU
  or Canada consider asking first.
- **Unsubscribing** stops mailings but not the gallery notices and reminders that person asked for; a second
  button on the page stops everything. Bounces and spam complaints (via the optional webhook) stop everything.
  **Unsubscribed** in Contacts lists them; removing someone is a deliberate, confirmed action.
- **Nothing sends by accident**: the review step states the exact count, a confirmation only authorises the
  exact list it showed, a double click makes one mailing, and a mailing can be cancelled or paused. Real
  mailings need your browser sign-in (password and emailed code), never the API token, and are capped by
  `MAILING_MAX` and `MAILING_DAY_MAX`. A mailing survives a restart without mailing anyone twice.
- Reserved addresses (`.invalid`, `.test`, `example.com`) are never mailed, and `MAIL_SEND=off` turns every
  mailing into a simulation.

### Email

Verify your domain in Resend and add the DNS records it gives you, including DMARC. Mail sent from
a residential IP without SPF and DKIM will land in spam.

## Security notes

- Passwords are scrypt with a per-user salt; sign-in is throttled per IP
- Admin sign-in is email + password + a 6-digit code emailed to you (`ADMIN_2FA: "off"` disables
  it if your mail provider fails and you are locked out)
- Session cookies are HttpOnly, SameSite=Lax, and Secure behind HTTPS
- Gallery visitors' emails are **collected, not verified**: deliberately, matching how Pixieset
  works. The password is the access control; registration is to know your audience
- Keys entered in the setup page are stored in `/data/immichset.json` (mode 0600, not encrypted, never
  copied into the backup folder, never sent back to a browser). Settings made as environment variables
  win over it. The setup page itself needs a one-time code from the container log and disappears
  for good when you finish
- Gallery pages load their typeface from Google Fonts, so a client's browser contacts Google when it
  opens one. Host the font yourself (the link is at the top of `web/index.html`) if that matters
- Image requests are checked against the gallery's album, so a session for one gallery cannot
  read another's photos
- The write key is separate from the read key, and the client-facing path never touches it. It
  holds only what the Photos tab needs, and trashing goes to Immich's recoverable trash, nothing
  in this app can delete a photo outright. Leave the two `*.delete` permissions off and the panel
  becomes add-only

### Dynamic DNS

Optional. A gallery served from a home connection is only reachable while its A record
matches whatever address the ISP last handed out, and nothing announces a change, the first
sign is a client saying the link is dead.

Set `DNS_DOMAIN`, `DNS_HOST` and a token for whoever hosts the domain's DNS
(`HOSTINGER_TOKEN` or `CLOUDFLARE_TOKEN`), and the app checks every `DNS_CHECK_MINUTES`
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
sent, so neighbouring records (SPF, DKIM, DMARC) are never part of the request. The lookups use
IPv4-only endpoints: asked over a dual-stack connection, the usual ones answer with an IPv6
address.

### Public website

Optional. The admin panel's **Website** section builds a portfolio site and publishes it to Cloudflare Pages, so the
public site never depends on this machine. Pages are made of blocks (banner, heading, text, photo, image and text,
gallery cards, photo grid, button, space or line, columns, contact details, video or map, custom HTML) that you add,
arrange, style and animate in a full-screen page editor with a live preview at phone, tablet and desktop size.
The header and its menu, the footer, the theme (colours, fonts, text size, photo spacing, card shape and logo) and the
words the site writes by itself (the "not found" page, the photo viewer's buttons) are edited in the same editor: click
the header or footer in the preview, or pick Header, Footer, Theme or Wording beside the pages. On phones the menu can
fold behind a menu button that works without JavaScript. Edits are an autosaved draft with undo and redo; the public
site changes only when you press **Publish**. A site made before the page editor existed keeps looking exactly the same
until you change it. Entrance and hover effects
respect visitors who ask their device for less motion, and the content of every page shows without JavaScript
(photo grids appear as a plain grid instead of the staggered layout, and the photo viewer needs JavaScript).
Uploaded originals also go to Immich, into a `Website – <gallery>` (or `Website – Pages`) album, using the write key.

Set `CF_ACCOUNT_ID`, `CF_PAGES_TOKEN` (an account token with **Cloudflare Pages → Edit**),
`CF_PAGES_PROJECT` and `SITE_URL`. Without them the section still edits and previews.
Each publish is kept as a version (the last 10) and can be restored. Failed publishes, photos
that never reach Immich, and the site going down are emailed to `ADMIN_EMAIL`.

## Backups

`BACKUP_DIR` enables a daily `VACUUM INTO` snapshot, keeping `BACKUP_KEEP` days. It is consistent
while the app is serving, unlike copying the live file. Uploaded covers are copied alongside it
into `BACKUP_DIR/covers`, since they live on disk rather than in the database and a snapshot
without them restores galleries pointing at files that are not there. A cover that has been
replaced is kept for as long as the snapshots that reference it. **Immich's own database is separate**:
enable its scheduled backup too.

## Keeping it running

[`RUNBOOK.md`](RUNBOOK.md) is the operations guide: how it fits together, how to deploy,
what to do when something breaks, how to restore, and the traps that have already cost
somebody a day. Written for whoever holds this next, including someone picking it up
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
removes it, including when a check fails part way. Originals are fetched as a one-kilobyte
range, so a gallery of video does not mean downloading a gigabyte to test a URL. Exit code 0
means everything passed.

Run it after any change, and before sending a gallery to a client.

## Limitations

- No watermarking
- One admin account

## Licence

AGPL-3.0. If you run a modified version as a network service, publish your changes.

The gallery design system adapts ideas from [ImmichPager](https://gitlab.com/wispd/ImmichPager) (AGPL-3.0, used with permission); see `NOTICE`.
