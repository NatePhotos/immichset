# Updating

## If you used the installer

In the install folder:

```bash
sh install.sh update
```

It downloads the new versions and restarts. Your photos and settings are not touched. It stops and asks if Immich has a
major new release, because those can need extra steps; read Immich's release notes, then run it again with `--allow-major`.

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
