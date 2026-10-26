# Backups: don't lose the photos

Hard drives fail. A backup is a second copy somewhere else. Aim for **3-2-1**: three copies, on two kinds of storage, one of
them away from your home.

**RAID is not a backup.** A mirrored pair of drives survives one drive dying, but not deletion, a virus, a fire or theft.

## What to back up

| What | Where it lives | Why |
|---|---|---|
| Your photos | Immich's **photo folder** (`UPLOAD_LOCATION`, folders `library`, `upload`, `profile`) | The originals. Most important. |
| Immich's database dumps | `backups` inside that same folder | Immich writes one nightly (about 02:00, keeps 14). It remembers albums and faces. |
| immichset's data | The immichset **data folder** (`/data`) | Your galleries, settings, contacts. |
| The `.env` file | The install folder | Holds the database password you will need to restore. |

If you copy the photo folder and the immichset data folder, you can rebuild everything else.

## A simple plan

1. **Copy 2:** a USB drive plugged into the computer, copied weekly (many NASes have a "backup" app that does this on a schedule).
2. **Copy 3 (off-site):** a cloud backup of the same folders (Backblaze B2, a second NAS at a relative's house, or a drive you
   swap and keep elsewhere).
3. When you've set up an off-site copy, tick it off in the **Getting started** list on Home.

## Download your settings

In the admin, **Connections** has a button to download your settings file. Keep it somewhere safe, but treat it like a password: it
contains your keys.

## Practice a restore

A backup you've never restored is only a hope. Once, try this: copy the data folder to a different computer, install immichset
there pointing at the copy, and check your galleries appear. Do it before you need it.
