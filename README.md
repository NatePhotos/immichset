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
- **Two independent gates per gallery** — ask for an email, require a password, both, or neither
- **Downloads** — single photos at full resolution, or the whole gallery as a zip, with progress
  and a working cancel
- **Save to Photos on iOS** — via the share sheet, not a file dumped into Downloads
- **Activity** — who registered, who opened it, what was downloaded
- **Email** — "your gallery is ready", plus expiry reminders you schedule per gallery
- **Mobile admin** — create and manage galleries from a phone
- **Nightly database backups** that are consistent while running

The Immich API key never reaches the browser. Every image is proxied, so a forwarded link
doesn't grant access.

## How it fits together

```
client ──▶ immichset ──▶ sessions, registrations, events, email   (SQLite)
                      ──▶ Immich, with a read-only key the client never sees
```

Galleries point at an Immich album. Add or remove photos in Immich and the gallery follows.

## Requirements

- A running Immich instance (developed against v3.2)
- Docker, and a reverse proxy terminating HTTPS
- Optionally a [Resend](https://resend.com) account for email

## Install

1. Clone this repo onto the host.
2. `cp docker-compose.example.yml docker-compose.yml` and fill it in.
3. In Immich, create a **read-only** API key: `asset.read`, `asset.view`, `asset.download`,
   `album.read`, `album.download`, `timeline.read`, `timeline.download`.
4. Generate long random values for `APP_SECRET` and `ADMIN_TOKEN`.
5. `docker compose up -d`
6. Point your proxy at the container and open `/admin`.

### Branding

Set `BRAND_NAME`, `BRAND_URL`, `BRAND_SOCIAL` and `BRAND_SOCIAL_LABEL`. For your own logo, drop a
**`web/brand-logo.png`** — black artwork on a transparent background. It is used as a mask, so it
renders white over the cover photo and dark in the footer. Without one, a neutral aperture is used.

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
