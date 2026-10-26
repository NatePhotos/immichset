# Updating

## If you used the installer

In the install folder:

```bash
sh install.sh update
```

It downloads the newer versions and restarts. Your photos and settings are not touched. Immich stays on its current
major version (`v3`), so this never jumps you across a big change by itself. When Immich announces a new major version, read
its release notes first (and update the Immich phone app before the server).

It's good to **back up first** ([Backups](BACKUPS.md)) and to update about once a month.

## If you used a compose file (Portainer, Container Manager, etc.)

Pull the new image and recreate the container from the same screen (the "Pull" or "Recreate" button), or in a terminal in the
folder with your compose file:

```bash
docker compose pull
docker compose up -d
```

## If it goes wrong

Nothing is deleted by an update. See [Troubleshooting](TROUBLESHOOTING.md). To go back, run the previous version by naming
it in your compose file (the `image:` line, for example `ghcr.io/natephotos/immichset:1.0.0`).
