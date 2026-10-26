#!/bin/sh
# immichset installer: sets up immichset, and (optionally) Immich with it, in one folder.
#
#   sh install.sh                 guided install
#   sh install.sh --dry-run       show exactly what it would do, change nothing
#   sh install.sh tunnel          put it online over https with a Cloudflare Tunnel
#   sh install.sh try-online      a temporary web address, to try it with a friend
#   sh install.sh status | stop | start | update | uninstall
#
# It never deletes your photos or your database. `uninstall` only stops the containers.
# Read it before you run it; it is short and does nothing hidden.

set -eu

IMMICH_RELEASE="v3.3.5"                 # the Immich release this installer was tested with
IMMICHSET_VERSION="dev"                 # set when a release is made
IMMICHSET_REPO="https://raw.githubusercontent.com/NatePhotos/immichset/main/install"
SRC_IMMICH="${IMMICHSET_SOURCE_IMMICH:-https://github.com/immich-app/immich/releases/download/${IMMICH_RELEASE}}"
SRC_OURS="${IMMICHSET_SOURCE:-$IMMICHSET_REPO}"
MARK_BEGIN="# >>> immichset (added by install.sh; safe to edit, replaced on update) >>>"
MARK_END="# <<< immichset <<<"

# ------------------------------------------------------------------ small helpers
say()  { printf '%s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }
die()  { printf '\nCannot continue: %s\n' "$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

EXTRA=""; DRY=0; YES=0; DIR=""; CMD=""; WANT_IMMICH=""; WANT_ML=""; PHOTOS=""; DBDIR=""; IMPORT=""; PORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;  --yes|-y) YES=1 ;;  --dir) DIR="$2"; shift ;;
    --immich) WANT_IMMICH=yes ;;  --no-immich) WANT_IMMICH=no ;;
    --ml) WANT_ML=yes ;;  --no-ml) WANT_ML=no ;;
    --photos) PHOTOS="$2"; shift ;;  --db) DBDIR="$2"; shift ;;  --import) IMPORT="$2"; shift ;;  --port) PORT="$2"; shift ;;
    stop) if [ "$CMD" = try-online ]; then EXTRA=stop; else CMD=stop; fi ;;
    install|tunnel|try-online|status|start|update|uninstall) CMD="$1" ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "I don't know what '$1' means. Try: sh install.sh --help" ;;
  esac
  shift
done
[ -n "$CMD" ] || CMD=install

# A question with a default. --yes (and no keyboard) takes the default.
have_tty() { ( : </dev/tty ) 2>/dev/null; }
ask() {  # ask "question" "default"
  if [ "$YES" = 1 ] || ! have_tty; then ANSWER="$2"; return 0; fi
  printf '%s [%s] ' "$1" "$2" >/dev/tty; IFS= read -r ANSWER </dev/tty || ANSWER=""
  [ -n "$ANSWER" ] || ANSWER="$2"
}
yesno() { ask "$1 (y/n)" "$2"; case "$ANSWER" in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac; }

# Every write goes through here, so --dry-run can show it and skip it.
do_run() { if [ "$DRY" = 1 ]; then say "  would run: $*"; else "$@"; fi; }

# ------------------------------------------------------------------ the platform
detect_platform() {
  if [ -n "${IMMICHSET_PLATFORM:-}" ]; then PLATFORM="$IMMICHSET_PLATFORM"; return; fi
  if [ -f /etc/synoinfo.conf ]; then PLATFORM=synology
  elif [ -f /etc/unraid-version ]; then PLATFORM=unraid
  elif [ -f /etc/config/qpkg.conf ]; then PLATFORM=qnap
  elif grep -qi microsoft /proc/version 2>/dev/null; then PLATFORM=wsl
  elif [ "$(uname -s)" = Darwin ]; then PLATFORM=mac
  elif [ -r /etc/os-release ] && grep -qi 'ugos' /etc/os-release 2>/dev/null; then PLATFORM=ugreen
  elif [ -r /proc/device-tree/model ] && grep -qi 'raspberry' /proc/device-tree/model 2>/dev/null; then PLATFORM=pi
  else PLATFORM=linux; fi
}
default_base() {
  case "$PLATFORM" in
    synology|ugreen) [ -d /volume1 ] && echo /volume1/docker/immichset || echo "$HOME/immichset" ;;
    qnap)  echo /share/Container/immichset ;;
    unraid) echo /mnt/user/appdata/immichset ;;
    *) echo "$HOME/immichset" ;;
  esac
}
timezone() {
  if [ -r /etc/timezone ]; then cat /etc/timezone
  elif [ -L /etc/localtime ]; then readlink /etc/localtime | sed 's|.*/zoneinfo/||'
  else echo UTC; fi
}
lan_ip() {
  ip=""
  # Linux: the address used to reach the internet is the home-network one (not Docker's or Tailscale's)
  if command -v ip >/dev/null 2>&1; then ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}') || ip=""; fi
  # Mac: Wi-Fi is usually en0, a wired connection en1 or en2
  if [ -z "$ip" ] && command -v ipconfig >/dev/null 2>&1; then
    for n in en0 en1 en2 en3; do ip=$(ipconfig getifaddr "$n" 2>/dev/null) || ip=""; [ -n "$ip" ] && break; done
  fi
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then ip=$(hostname -I 2>/dev/null | awk '{print $1}') || ip=""; fi
  echo "${ip:-localhost}"
}
random32() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 32 || true; }
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }

# A database on a network share corrupts. Refuse nfs/cifs/smb/fuse, and Windows drives under WSL.
check_db_folder() {
  case "$PLATFORM:$1" in wsl:/mnt/[a-z]/*) die "The database folder can't be on a Windows drive ($1). Use a folder inside Ubuntu, like $HOME/immichset/db." ;; esac
  m="${IMMICHSET_MOUNTS:-/proc/mounts}"; [ -r "$m" ] || return 0
  fs=$(awk -v p="$1" '{ if (index(p, $2) == 1 && length($2) >= best) { best = length($2); t = $3 } } END { print t }' "$m")
  case "$fs" in nfs*|cifs|smb*|fuse*|9p|davfs) die "The database folder ($1) is on a network share ($fs). Immich's database must be on a disk inside this computer." ;; esac
}

# ------------------------------------------------------------------ docker
need_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker isn't installed. Install it first (see docs/START-HERE.md), then run this again."
  docker version >/dev/null 2>&1 || die "Docker is installed but this user can't use it. On a NAS, run this with sudo; on Linux, add your user to the docker group."
  docker compose version >/dev/null 2>&1 || die "This needs 'docker compose' (version 2). Update Docker, or install the Compose plugin."
}
compose() { ( cd "$DIR" && docker compose "$@" ); }

# ------------------------------------------------------------------ .env handling
setenv() {  # setenv KEY VALUE FILE : replace KEY=, else un-comment # KEY=, else append
  awk -v k="$1" -v v="$2" 'BEGIN{d=0} { if ($0 ~ "^"k"=" ) { print k"="v; d=1 } else if (!d && $0 ~ "^# *"k"=") { print k"="v; d=1 } else print } END { if (!d) print k"="v }' "$3" >"$3.tmp" && mv "$3.tmp" "$3" && chmod 600 "$3"
}
getenv() { if [ -f "$2" ]; then sed -n "s/^$1=//p" "$2" | head -n1; fi; }
fetch() {  # fetch URL DEST : to a temporary name, then moved into place
  tmp="$2.part"
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$tmp" || { rm -f "$tmp"; die "Couldn't download $1"; }
  else wget -qO "$tmp" "$1" || { rm -f "$tmp"; die "Couldn't download $1"; }; fi
  mv "$tmp" "$2"
}

# ------------------------------------------------------------------ the guided install
do_install() {
  step "Welcome"
  say "This sets up immichset (your client galleries), and optionally Immich (where your photos live)."
  say "Nothing is deleted, and you can stop at any time with Ctrl+C."
  detect_platform; say "Looks like: $PLATFORM"
  need_docker

  # How big is this computer? (Docker reports its own memory, which also covers Docker Desktop's VM.)
  info=$(docker info --format '{{.MemTotal}} {{.NCPU}} {{.Architecture}}' 2>/dev/null || echo "0 0 unknown")
  MEM_MB=$(( $(echo "$info" | awk '{print $1}') / 1048576 )); CPUS=$(echo "$info" | awk '{print $2}'); ARCH=$(echo "$info" | awk '{print $3}')
  say "This computer has about $((MEM_MB / 1024)) GB of memory and $CPUS processor cores ($ARCH)."
  if [ "$MEM_MB" -gt 0 ] && { [ "$MEM_MB" -lt 3500 ] || [ "$CPUS" -lt 2 ]; }; then
    warn "That is small for Immich (it likes 4 GB and 2 cores at least). You can still install immichset alone."
    [ "$WANT_IMMICH" = yes ] || WANT_IMMICH=no
    [ "$YES" = 1 ] && [ "$WANT_IMMICH" != no ] && die "Too small to run Immich. Re-run with --no-immich to install immichset alone."
  fi

  # Is there already an Immich on this computer?
  FOUND=""; NETWORK=""
  names=$(docker ps -a --format '{{.Names}} {{.Image}}' 2>/dev/null || true)
  FOUND=$(echo "$names" | awk '$2 ~ /immich-server/ {print $1; exit}')
  if [ -z "$WANT_IMMICH" ]; then
    if [ -n "$FOUND" ]; then
      say "I found Immich already running here ($FOUND), so I'll install only immichset and connect it to that."
      WANT_IMMICH=no
    else
      yesno "Install Immich too? Choose yes if you don't have it yet" y && WANT_IMMICH=yes || WANT_IMMICH=no
    fi
  fi
  if [ "$WANT_IMMICH" = no ] && [ -n "$FOUND" ]; then
    NETWORK=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$FOUND" 2>/dev/null | awk '{print $1}')
  fi

  step "Where things go"
  BASE_DEFAULT=$(default_base)
  [ -n "$DIR" ] || { ask "Install folder" "$BASE_DEFAULT"; DIR="$ANSWER"; }
  # Never install on top of a folder that already holds someone's files (only our own install folder is fine)
  if [ -d "$DIR" ] && [ ! -f "$DIR/.install-state" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
    die "$DIR already has files in it that aren't from this installer, and I won't mix with them. Choose an empty or new folder (for example $HOME/immichset-app) and run this again."
  fi
  UPLOAD="${PHOTOS:-}"; DBF="${DBDIR:-}"
  if [ "$WANT_IMMICH" = yes ]; then
    [ -n "$UPLOAD" ] || { ask "Folder for your photos (use your biggest disk; back it up)" "$DIR/library"; UPLOAD="$ANSWER"; }
    [ -n "$DBF" ] || { ask "Folder for Immich's database (must be a disk inside this computer)" "$DIR/postgres"; DBF="$ANSWER"; }
    check_db_folder "$DBF"
    ML=yes
    if [ "$MEM_MB" -gt 0 ] && [ "$MEM_MB" -lt 7500 ]; then ML=no; fi
    if [ "$ARCH" = x86_64 ] && [ -r /proc/cpuinfo ] && ! grep -q 'sse4_2' /proc/cpuinfo; then ML=no; fi
    [ -z "$WANT_ML" ] || ML="$WANT_ML"
    if [ -z "$WANT_ML" ]; then
      say "Machine learning gives smart search and face grouping but needs about 8 GB. Recommended here: $ML."
      yesno "Turn machine learning on?" "$( [ "$ML" = yes ] && echo y || echo n )" && ML=yes || ML=no
    fi
    [ -n "$IMPORT" ] || { ask "A folder of photos that already exists, to show in Immich (Enter for none)" ""; IMPORT="$ANSWER"; }
  fi
  DATA="$DIR/immichset-data"; BACKUPS="$DIR/immichset-backups"
  [ -n "$PORT" ] || PORT=3000
  while docker ps --format '{{.Ports}}' 2>/dev/null | grep -q ":${PORT}->"; do PORT=$((PORT + 1)); done

  step "What I will do"
  say "  folder:        $DIR"
  [ "$WANT_IMMICH" = yes ] && say "  photos:        $UPLOAD" && say "  database:      $DBF" && say "  machine learn: $ML"
  [ -n "$IMPORT" ] && say "  import folder: $IMPORT (read-only)"
  say "  settings:      $DATA"
  say "  backups:       $BACKUPS"
  say "  address:       port $PORT"
  say "  Immich:        $( [ "$WANT_IMMICH" = yes ] && echo "installed with it (release $IMMICH_RELEASE)" || echo "not installed${FOUND:+; connecting to $FOUND}" )"
  if [ "$DRY" = 1 ]; then
    say; say "Files it would write in $DIR:"; say "  docker-compose.yml  .env (private)  tunnel.env (private)  .install-state  INSTALL-NOTES.txt"
    [ "$WANT_IMMICH" = yes ] && say "  immichset.yml  (and immichset.import.yml if you gave an import folder)"
    say "Commands it would run:"; do_run mkdir -p "$DIR" "$DATA" "$BACKUPS"
    do_run docker compose pull; do_run docker compose up -d
    say; say "Dry run: nothing was downloaded or written."; return 0
  fi
  yesno "Go ahead?" y || die "Stopped. Nothing was changed."

  step "Setting up $DIR"
  mkdir -p "$DIR" "$DATA" "$BACKUPS" || die "Couldn't create $DIR. On a NAS, run with sudo, or pick a folder you own."
  # keep a copy of this script in the install folder so "sh install.sh update" works from there
  if [ -f "$0" ] && [ "$(cd "$(dirname "$0")" && pwd)/$(basename "$0")" != "$DIR/install.sh" ]; then cp "$0" "$DIR/install.sh" 2>/dev/null || true; fi
  if [ "$WANT_IMMICH" = yes ]; then
    mkdir -p "$UPLOAD" "$DBF" || die "Couldn't create your photo folders."
    fetch "$SRC_IMMICH/docker-compose.yml" "$DIR/docker-compose.yml"
    if ! { grep -q 'immich-server' "$DIR/docker-compose.yml" && grep -q 'UPLOAD_LOCATION' "$DIR/docker-compose.yml"; }; then die "The Immich file I downloaded doesn't look right. Nothing was started."; fi
    [ -f "$DIR/.env" ] || fetch "$SRC_IMMICH/example.env" "$DIR/.env"
    fetch "$SRC_OURS/immichset.yml" "$DIR/immichset.yml"
    [ -z "$IMPORT" ] || fetch "$SRC_OURS/immichset.import.yml" "$DIR/immichset.import.yml"
  else
    fetch "$SRC_OURS/immichset-only.yml" "$DIR/docker-compose.yml"
    [ -z "$NETWORK" ] || fetch "$SRC_OURS/immichset-network.yml" "$DIR/immichset-network.yml"
    [ -f "$DIR/.env" ] || : >"$DIR/.env"
  fi
  chmod 600 "$DIR/.env"
  [ -f "$DIR/tunnel.env" ] || { printf 'TUNNEL_TOKEN=\n' >"$DIR/tunnel.env"; chmod 600 "$DIR/tunnel.env"; }

  ENVF="$DIR/.env"
  if [ "$WANT_IMMICH" = yes ]; then
    setenv UPLOAD_LOCATION "$UPLOAD" "$ENVF"; setenv DB_DATA_LOCATION "$DBF" "$ENVF"
    # Never make a new database password when one exists: Immich's database was created with it.
    cur=$(getenv DB_PASSWORD "$ENVF"); if [ -z "$cur" ] || [ "$cur" = postgres ]; then setenv DB_PASSWORD "$(random32)" "$ENVF"; fi
  fi
  setenv TZ "$(timezone)" "$ENVF"
  # our own block, replaced each time so re-running never doubles it
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0==b {skip=1} !skip {print} $0==e {skip=0}' "$ENVF" >"$ENVF.tmp" && mv "$ENVF.tmp" "$ENVF" && chmod 600 "$ENVF"
  files="docker-compose.yml"; profiles=""
  [ -z "$NETWORK" ] || files="docker-compose.yml:immichset-network.yml"
  if [ "$WANT_IMMICH" = yes ]; then files="docker-compose.yml:immichset.yml"; [ -z "$IMPORT" ] || files="$files:immichset.import.yml"; [ "$ML" = yes ] && profiles="ml"; fi
  {
    printf '%s\n' "$MARK_BEGIN"
    [ "$WANT_IMMICH" = yes ] && { printf 'COMPOSE_PROJECT_NAME=immichset\nCOMPOSE_FILE=%s\n' "$files"; printf 'COMPOSE_PROFILES=%s\n' "$profiles"; }
    [ "$WANT_IMMICH" = no ] && [ -n "$NETWORK" ] && printf 'COMPOSE_FILE=%s\n' "$files"
    [ "$WANT_IMMICH" = no ] && printf 'COMPOSE_PROFILES=\n'
    printf 'IMMICHSET_TAG=%s\nIMMICHSET_PORT=%s\nIMMICHSET_DATA=%s\nIMMICHSET_BACKUPS=%s\nIMMICHSET_UID=%s\nIMMICHSET_GID=%s\n' "${IMMICHSET_IMAGE_TAG:-latest}" "$PORT" "$DATA" "$BACKUPS" "$(id -u)" "$(id -g)"
    [ "$WANT_IMMICH" = yes ] && printf 'IMMICHSET_ML=%s\n' "$( [ "$ML" = yes ] && echo on || echo off )"
    [ -z "$IMPORT" ] || printf 'IMMICHSET_IMPORT_FOLDER=%s\nIMMICHSET_IMPORT_PATH=/mnt/import\n' "$IMPORT"
    [ -z "$NETWORK" ] || printf 'IMMICH_NETWORK=%s\nIMMICHSET_IMMICH_HINT=http://immich-server:2283\n' "$NETWORK"
    printf '%s\n' "$MARK_END"
  } >>"$ENVF"
  chmod 600 "$ENVF"

  { printf 'immich_release=%s\nimmichset_version=%s\nimmich_installed=%s\ncompose_sha256=%s\n' "$IMMICH_RELEASE" "$IMMICHSET_VERSION" "$WANT_IMMICH" "$(sha "$DIR/docker-compose.yml")"; } >"$DIR/.install-state"
  cat >"$DIR/INSTALL-NOTES.txt" <<NOTES
immichset install folder: $DIR
  Start:    cd "$DIR" && docker compose up -d
  Stop:     cd "$DIR" && docker compose stop
  Update:   sh install.sh update
  Online:   sh install.sh tunnel
Back these up (3 copies, 1 somewhere else):
  ${UPLOAD:+your photos:       $UPLOAD}
  immichset settings:  $DATA   (and download the settings file from Connections)
  this folder's .env   (it holds Immich's database password)
NOTES

  step "Starting (the first start downloads a few gigabytes; be patient)"
  compose config -q || die "The configuration doesn't check out. Nothing was started."
  [ "${IMMICHSET_SKIP_PULL:-0}" = 1 ] || compose pull      # (tests with a locally built image skip the pull)
  compose up -d

  if [ "${IMMICHSET_NO_WAIT:-0}" != 1 ]; then
    step "Waiting for it to come up"
    i=0; until curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; do i=$((i + 1)); [ $i -gt 90 ] && { warn "Still not answering. Check: cd $DIR && docker compose logs immichset"; break; }; printf '.'; sleep 2; done; echo
  fi
  CODE=""; if [ -r "$DATA/setup-code.txt" ]; then CODE=$(cat "$DATA/setup-code.txt"); fi
  step "Done"
  say "Open this in your web browser:  http://$(lan_ip):$PORT/setup"
  name=$(hostname -s 2>/dev/null || hostname 2>/dev/null || true)
  case "$name" in ""|localhost) ;; *) say "  Or by this computer's name (works on many home networks):  http://$name.local:$PORT/setup" ;; esac
  say "  (On this same computer you can also use  http://localhost:$PORT/setup  if that address doesn't open.)"
  [ -z "$CODE" ] || say "Setup code:  $CODE"
  [ "$WANT_IMMICH" = yes ] && say "Do the setup page FIRST. It creates your Immich account for you. Immich itself can take a few minutes to start."
  say "Notes for later are in $DIR/INSTALL-NOTES.txt"
}

# ------------------------------------------------------------------ the other commands
find_dir() {
  if [ -z "$DIR" ]; then
    DIR="$(pwd)"
    if [ ! -f "$DIR/.install-state" ]; then detect_platform; d=$(default_base); if [ -f "$d/.install-state" ]; then DIR="$d"; fi; fi
  fi
  [ -f "$DIR/.install-state" ] || die "This isn't an immichset install folder ($DIR). Run this from inside the folder you installed into, or pass --dir /path/to/it."
}
do_tunnel() {
  find_dir; need_docker
  say "Paste your Cloudflare Tunnel token (the long text after --token in the dashboard). It isn't shown or saved anywhere but $DIR/tunnel.env."
  if [ "$YES" = 1 ] || ! have_tty; then TOKEN="${TUNNEL_TOKEN:-}"; else printf 'Token: ' >/dev/tty; stty -echo </dev/tty 2>/dev/null || true; IFS= read -r TOKEN </dev/tty || TOKEN=""; stty echo </dev/tty 2>/dev/null || true; echo; fi
  [ -n "$TOKEN" ] || die "No token entered."
  ( umask 077; printf 'TUNNEL_TOKEN=%s\n' "$TOKEN" >"$DIR/tunnel.env" ); chmod 600 "$DIR/tunnel.env"
  cur=$(getenv COMPOSE_PROFILES "$DIR/.env")
  case ",$cur," in *,tunnel,*) ;; *) setenv COMPOSE_PROFILES "${cur:+$cur,}tunnel" "$DIR/.env" ;; esac
  if [ -z "$(getenv COMPOSE_FILE "$DIR/.env")" ]; then compose --profile tunnel up -d; else compose up -d; fi
  say "Started. In Cloudflare, add a Public hostname pointing at  http://immichset:3000  and wait for the tunnel to say Healthy."
}
do_try_online() {
  find_dir; need_docker
  case "${EXTRA:-start}" in stop) compose --profile try stop try-online; return ;; esac
  compose --profile try up -d try-online
  say "Waiting for a temporary address..."
  i=0; addr=""; while [ $i -lt 30 ]; do addr=$(docker logs immichset_try 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true); [ -n "$addr" ] && break; i=$((i + 1)); sleep 2; done
  [ -n "$addr" ] || die "No address appeared yet. Look at: docker logs immichset_try"
  say "Your temporary address:  $addr"
  say "Use it as the Public address while you test. It changes every time it restarts, so links you send stop working."
  say "This is for trying it out only. For real clients use:  sh install.sh tunnel"
}
do_update() {
  find_dir; need_docker
  compose pull
  compose up -d
  say "Updated. If Immich shipped a new major version, read its release notes first, and update the Immich phone app before the server."
}
do_uninstall() {
  find_dir; need_docker
  compose down
  say "Stopped and removed the containers. Your files are untouched:"
  for d in "$(getenv UPLOAD_LOCATION "$DIR/.env")" "$(getenv DB_DATA_LOCATION "$DIR/.env")" "$(getenv IMMICHSET_DATA "$DIR/.env")" "$(getenv IMMICHSET_BACKUPS "$DIR/.env")"; do
    [ -n "$d" ] && [ -d "$d" ] && say "  $d  ($(du -sh "$d" 2>/dev/null | awk '{print $1}'))"
  done
  say "Delete them yourself only when you are sure you have another copy."
}

main() {
  case "$CMD" in
    install) do_install ;;
    tunnel) do_tunnel ;;
    try-online) do_try_online ;;
    status) find_dir; need_docker; compose ps ;;
    stop) find_dir; need_docker; compose stop ;;
    start) find_dir; need_docker; compose up -d ;;
    update) do_update ;;
    uninstall) do_uninstall ;;
  esac
}
main "$@"
