# Start here

**immichset** lets a photographer (or anyone with a lot of photos) share them with clients through clean gallery
pages: a link, an optional password, favourites, and downloads, on a computer you own. You don't need to be technical
to set it up, but you do need to follow the steps in order. This page tells you which steps are yours.

## What you're building

```
Your photos ──► Immich (keeps them, makes thumbnails) ──► immichset (the gallery pages) ──► your clients
   on your own computer                                       reachable over the internet
```

- **Immich** is a free program that stores your photos and creates the small preview pictures. It is where you add photos.
- **immichset** turns an Immich album into a gallery your client can open with a link. It never changes your photos.
- **Docker** is the program that runs both of them on your computer. You install it once.

## Which path are you on?

| You are... | Follow |
|---|---|
| **New to all of this**, or you don't have Immich | [Install everything](install/NEW.md) (about 30 minutes plus download time) |
| **You have a NAS and its Docker app, but no terminal** | [Install everything from your NAS's Docker app](install/NO-TERMINAL.md) (paste one file) |
| **Already running Immich** | [Add immichset to your Immich](install/HAVE-IMMICH.md) (about 10 minutes) |
| **Just curious**, want to try it on a laptop | [Install everything](install/NEW.md), on a Mac or Linux laptop, and skip the "online" part |

Once it is running, the rest of the journey is the same for everyone:

1. [Get photos in and make your first gallery](PHOTOS.md)
2. [Put it online so clients can open it from anywhere](ONLINE.md)
3. [Add your name, address and logo](BRANDING.md) (optional; skip it in setup and add it any time)
4. [Set up email](EMAIL.md) (optional, but gallery links and reminders need it)
5. [Back it up](BACKUPS.md) (please do this before a real client uses it)
6. [Keep it up to date](UPDATING.md)

Something went wrong? [Troubleshooting](TROUBLESHOOTING.md). A word you don't know? [Glossary](GLOSSARY.md).
The wizard that sets everything up, step by step with screenshots: [SETUP.md](SETUP.md).

## What it costs, and how long it takes

These are rough estimates; prices change and vary by country.

| | Cost | Time |
|---|---|---|
| The software (Docker, Immich, immichset) | Free | |
| A computer to run it | You may already own one. A used mini PC or a small NAS is roughly $150–600. | |
| A domain name for clients (needed for the best way to go online) | About $10–15 a year | 10 minutes |
| Cloudflare (the tunnel that makes it reachable) | Free plan is enough. It may ask for a card to open the account; you are not charged. | 15 minutes |
| Email sending (Resend) | Free up to 100 emails a day | 20 minutes (waiting for DNS) |
| Installing everything | | 30–60 minutes (the first download is large) |

## What your computer needs

Immich is the demanding part. Its own guide says 6 GB of memory minimum and 8 GB recommended, and 4 GB works only
with "machine learning" (smart search and face grouping) switched off. Two processor cores minimum, four recommended.
Put the database on a fast disk (an SSD) inside the computer, never on a network share. It must be a 64-bit Intel/AMD
or ARM computer. A Raspberry Pi 5 with 8 GB works. An old laptop with 8 GB works well.

Windows is possible but Immich discourages it; use a Mac, Linux, or a NAS if you can. (Windows works through WSL, see
[Docker](install/DOCKER.md).)

## Is it safe to put online?

What clients can reach is only the gallery pages, each behind the gate you choose (an email, a password, both, or
neither). Immich itself is never exposed, and its keys never reach a browser. You sign in to the admin with a password
and a code emailed to you. Do **not** open Immich's own port (2283) on your router; the guides never ask you to.
