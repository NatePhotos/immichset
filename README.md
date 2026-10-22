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
- **Any image as the cover** — upload one, or pick from the album
- **Two independent gates per gallery** — ask for an email, require a password, both, or neither
- **Downloads** — single photos at full resolution, or the whole gallery as a zip, with progress
  and a working cancel
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

Galleries point at an Immich album. Add or remove photos in Immich and the gallery follows —
or, with a write key set, drop them straight into the admin panel and immichset creates the
album and uploads for you.

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

`UPLOAD_MAX_MB` caps each file (default 250). Photo formats only: JPEG, PNG, HEIC, WebP, AVIF,
GIF, TIFF and DNG. One file per request, so each gets its own progress bar and one failure does
not take the batch down. Immich deduplicates by checksum, so re-dropping a folder is safe — the
photos already there come back as duplicates rather than second copies.

Nothing here deletes a file outright: trashing is Immich's recoverable trash, and the panel's undo
only reaches photos it trashed itself.

### Covers

A gallery's cover is a photo from its album, or an image of your own. An uploaded cover is stored
beside the database in `DATA_DIR/covers`, never added to the album and never pushed into Immich, so
clients see it on the cover and in emails but never in the grid. No write key needed.

JPEG, PNG, WebP, AVIF or GIF, under 12 MB — HEIC is refused because browsers will not display it.
The file is served as uploaded, with no resizing step, so export it web-sized. Note that
`BACKUP_DIR` snapshots the database only: keep your own copy of `DATA_DIR` if the covers matter.

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

## Backups

`BACKUP_DIR` enables a daily `VACUUM INTO` snapshot, keeping `BACKUP_KEEP` days. It is consistent
while the app is serving, unlike copying the live file. **Immich's own database is separate** —
enable its scheduled backup too.

## Limitations

- Client favourites are not implemented yet
- Only full-resolution downloads; no "web size" option
- No watermarking
- One admin account
- No tests

## Licence

AGPL-3.0. If you run a modified version as a network service, publish your changes.
