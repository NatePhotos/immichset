#!/usr/bin/env bash
# Put the current working copy onto the server, then prove it still works.
#
#   ./deploy.sh                 check, copy, restart, smoke test
#   ./deploy.sh --dry-run       say what it would do and stop
#   ./deploy.sh --no-test       skip the smoke test (you will regret this)
#   ./deploy.sh --rollback      put the previous files back and restart
#
# Settings come from .deploy.env beside this script — see .deploy.env.example.
# That file is gitignored because it names your server.

set -euo pipefail
cd "$(dirname "$0")"

[ -f .deploy.env ] && . ./.deploy.env

DEST="${DEST:-}"                 # directory holding server.mjs and web/ on the host
BASE="${BASE:-}"                 # https://your-domain
ADMIN_TOKEN="${ADMIN_TOKEN:-}"

DRY=0; TEST=1; ROLLBACK=0
for a in "$@"; do
  case "$a" in
    --dry-run)  DRY=1 ;;
    --no-test)  TEST=0 ;;
    --rollback) ROLLBACK=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

die() { echo "  ✗ $*" >&2; exit 1; }
say() { echo "  $*"; }

[ -n "$DEST" ] || die "DEST is not set (copy .deploy.env.example to .deploy.env)"
[ -n "$BASE" ] || die "BASE is not set"
[ -d "$DEST" ] || die "DEST does not exist or is not mounted: $DEST"

FILES=(server.mjs web/admin.html web/index.html web/site-admin.js web/design-admin.js web/builder-admin.js web/home.js web/admin-theme.css admin/overview.mjs admin/cover.mjs admin/logo.mjs
       site/blake3.mjs site/store.mjs site/build.mjs site/publish.mjs site/watch.mjs site/routes.mjs site/theme.mjs site/wording.mjs site/bands.mjs site/sitewide.mjs
       site/pages.mjs site/sanitize.mjs site/blocks/button.mjs site/blocks/columns.mjs site/blocks/common.mjs site/blocks/contact.mjs site/blocks/custom-html.mjs
       site/blocks/embed.mjs site/blocks/gallery-cards.mjs site/blocks/heading.mjs site/blocks/hero.mjs site/blocks/image-text.mjs site/blocks/image.mjs site/blocks/photo-grid.mjs
       site/blocks/registry.mjs site/blocks/rich-text.mjs site/blocks/spacer.mjs
       site/assets/site.css site/assets/site.js site/assets/blocks.css site/assets/motion.js site/assets/edit-bridge.js site/assets/bands.css site/assets/bands.js zip/writer.mjs zip/queue.mjs health/watchdog.mjs dropbox/dropbox.mjs mail/blast.mjs
       design/design.mjs design/css.mjs config/settings.mjs config/store.mjs config/request.mjs setup/claim.mjs setup/checks.mjs setup/provision.mjs setup/server.mjs web/setup.html)
PREV="$DEST/.previous"

# ---- rollback -------------------------------------------------------------
if [ "$ROLLBACK" = 1 ]; then
  [ -d "$PREV" ] || die "there is no previous copy to go back to"
  echo "rolling back"
  n=0
  for f in "${FILES[@]}"; do
    [ -f "$PREV/$f" ] || continue
    cp "$PREV/$f" "$DEST/$f"; say "restored $f"; n=$((n+1))
  done
  [ "$n" -gt 0 ] || die "the previous copy is empty"
  curl -fsS -m 20 -X POST "$BASE/api/admin/restart" -H "x-admin-token: $ADMIN_TOKEN" >/dev/null
  say "restarted"
  exit 0
fi

# ---- check before copying -------------------------------------------------
echo "checking"
node --check server.mjs || die "server.mjs has a syntax error"
say "✓ server.mjs parses"

# the panel and the gallery are each one file with script inside; a broken
# script there fails silently in the browser, so it is checked here instead
for f in web/admin.html web/index.html web/setup.html; do
  node --input-type=module --check < <(
    node -e '
      const fs=require("fs");
      const s=fs.readFileSync(process.argv[1],"utf8");
      const m=[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
      if(!m.length){ console.error("no script found"); process.exit(1); }
      process.stdout.write(m.join("\n;\n"));
    ' "$f"
  ) || die "$f has a syntax error in its script"
  say "✓ $f parses"
done

WHAT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
git diff --quiet 2>/dev/null || WHAT="$WHAT+uncommitted"
say "deploying $WHAT to $DEST"

if [ "$DRY" = 1 ]; then
  echo
  for f in "${FILES[@]}"; do
    if cmp -s "$f" "$DEST/$f"; then say "unchanged  $f"; else say "would copy $f"; fi
  done
  echo; say "dry run, nothing written"
  exit 0
fi

# ---- keep what is there, then copy ---------------------------------------
echo
echo "copying"
mkdir -p "$PREV/web"

# Snapshot everything that is there now, not only what is about to change:
# a partial snapshot mixes one deploy's files with another's, and rolling back
# to that combination would restore something that never ran.
for f in "${FILES[@]}"; do
  [ -f "$DEST/$f" ] && { mkdir -p "$PREV/$(dirname "$f")"; cp "$DEST/$f" "$PREV/$f"; }
done

CHANGED=0
for f in "${FILES[@]}"; do
  if cmp -s "$f" "$DEST/$f"; then
    say "unchanged  $f"
  else
    mkdir -p "$DEST/$(dirname "$f")"
    cp "$f" "$DEST/$f"
    say "copied     $f"
    CHANGED=1
  fi
done
[ "$CHANGED" = 0 ] && { say "nothing to deploy"; exit 0; }

# ---- restart and wait -----------------------------------------------------
echo
echo "restarting"
curl -fsS -m 20 -X POST "$BASE/api/admin/restart" -H "x-admin-token: $ADMIN_TOKEN" >/dev/null \
  || die "the restart call failed — is ADMIN_TOKEN right?"
for i in $(seq 1 30); do
  sleep 2
  if curl -fsS -m 5 "$BASE/healthz" >/dev/null 2>&1; then say "✓ back up after $((i*2))s"; break; fi
  [ "$i" = 30 ] && die "it did not come back within a minute — check the container"
done

# ---- prove it ------------------------------------------------------------
if [ "$TEST" = 0 ]; then
  echo; say "smoke test skipped"
  exit 0
fi
echo
echo "testing"
if ADMIN_TOKEN="$ADMIN_TOKEN" node smoke.mjs "$BASE"; then
  echo
  say "deployed $WHAT"
else
  echo
  echo "  ✗ the smoke test failed against the new build."
  echo "    ./deploy.sh --rollback  puts the previous files back."
  exit 1
fi
