#!/usr/bin/env bash
# TIKOOTAK installer - one file, two ways to use it:
#  A) ONE LINE on a fresh server (it downloads the project for you; asks ONLINE or OFFLINE):
#       bash <(curl -fsSL https://raw.githubusercontent.com/amirebi9156/tikootak/main/install.sh)
#  B) From an already extracted folder (kit/release):   sudo bash install.sh
# Options for A (everything can be given to skip the questions):
#   --online | --offline      mode (online = download latest release from GitHub; offline = use a file you uploaded)
#   --file PATH               release/kit file to use (offline; tikootak-full-X.tar or tikootak-X.tar.gz)
#   --domain D                your domain (A record must already point to this server)
#   --version X.Y.Z           release to download (default: latest)
#   --repo OWNER/NAME         GitHub repo (default amirebi9156/tikootak)
#   --token T                 GitHub token for a PRIVATE repo (or env TOKEN; never paste it in chats)
#   --mirror-base URL         download from your own mirror instead of GitHub (needs LATEST + tikootak-X.tar.gz[.sha256])
#   --restore FILE            after install, restore this encrypted backup (moving servers)
#   --dir DIR                 install folder (default /root/tikootak)
#   --yes                     do not ask the final confirmation
#   anything else is passed to scripts/bootstrap.sh (e.g. --mirror https://docker.arvancloud.ir --npm URL --lock-admin)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
run_local() {
cd "$HERE" || exit 1
[ "$(id -u)" = 0 ] || { echo "Run as root:  sudo bash install.sh"; exit 1; }
chmod +x scripts/*.sh
echo "=============================================="
echo "  TIKOOTAK installer  (version $(cat VERSION 2>/dev/null))"
echo "=============================================="
DOM=""
[ -f .env ] && DOM="$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"
[ "$DOM" = chat.example.ir ] && DOM=""
if [ -z "$DOM" ]; then read -r -p "Your domain (e.g. tikootak.ir): " DOM; fi
[ -n "$DOM" ] || { echo "Domain is required."; exit 1; }
echo
echo "Before continuing make sure:"
echo "  1) DNS: A record of $DOM points to this server (Arvan cloud icon GREY / DNS only)"
echo "  2) The cloud firewall allows: 22/tcp 80/tcp 443/tcp 7881/tcp 7882/udp 3478/udp 30000-30100/udp"
read -r -p "Start the installation? (y/N) " a; [ "$a" = y ] || exit 0
./scripts/bootstrap.sh --domain "$DOM" "$@" || { echo; echo "Installer stopped. Fix the problem above and run again: sudo bash install.sh"; exit 1; }
echo
read -r -p "Open the management menu now? (y/N) " a; [ "$a" = y ] && exec ./scripts/tikootak.sh menu
exit 0
}

# Inside an extracted project folder -> the classic local flow (B)
if [ -n "$HERE" ] && [ -f "$HERE/VERSION" ] && [ -f "$HERE/scripts/bootstrap.sh" ] && [ -z "${TIKOOTAK_FORCE_REMOTE:-}" ]; then
  run_local "$@"
fi

REPO="${TIKOOTAK_REPO:-amirebi9156/tikootak}"; TOKEN="${TOKEN:-}"; MIRROR_BASE="${MIRROR_BASE:-}"
MODE=""; FILE=""; DOMAIN=""; VER=""; RESTORE=""; DIR="/root/tikootak"; YES=0; EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    --online) MODE=online;; --offline) MODE=offline;;
    --file) FILE="$2"; shift;; --domain) DOMAIN="$2"; shift;; --version) VER="${2#v}"; shift;;
    --repo) REPO="$2"; shift;; --token) TOKEN="$2"; shift;; --mirror-base) MIRROR_BASE="$2"; shift;;
    --restore) RESTORE="$2"; shift;; --dir) DIR="$2"; shift;; --yes|-y) YES=1;;
    -h|--help) sed -n 2,19p "${BASH_SOURCE[0]:-$0}" 2>/dev/null || echo "see the header of install.sh"; exit 0;;
    *) EXTRA+=("$1");;
  esac; shift
done

R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; N=$'\e[0m'
say()  { echo "${G}==${N} $1"; }
warn() { echo "${Y}[WARN]${N} $1"; }
die()  { echo "${R}[FAIL]${N} $1"; [ -n "${2:-}" ] && echo "   -> $2"; exit 1; }
# prompts read from the terminal, so this also works when the script itself arrives through a pipe
have_tty() { [ -r /dev/tty ] && : </dev/tty 2>/dev/null; }
ask() { # ask "question" default -> REPLY
  local a=""
  if have_tty; then read -r -p "$1" a </dev/tty || a=""; fi
  REPLY="${a:-${2:-}}"
}
ask_secret() { local a=""; if have_tty; then read -r -s -p "$1" a </dev/tty || a=""; echo; fi; REPLY="$a"; }

[ "$(id -u)" = 0 ] || die "Run as root (sudo -i first)."
command -v apt-get >/dev/null || die "Only Ubuntu/Debian are supported."

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ---- 1. mode -------------------------------------------------------------------------------------------------
if [ -z "$MODE" ]; then
  [ -n "$FILE" ] && MODE=offline
fi
if [ -z "$MODE" ]; then
  have_tty || die "No terminal to ask questions. Give --online or --offline."
  echo
  echo "How do you want to install TIKOOTAK?"
  echo "  1) ONLINE  - this server can reach GitHub; download the latest release automatically"
  echo "  2) OFFLINE - GitHub/Docker Hub are blocked; you upload the kit file yourself (scp / WinSCP)"
  ask "Choose 1 or 2 [1]: " 1
  case "$REPLY" in 2|offline|o) MODE=offline;; *) MODE=online;; esac
fi

# ---- 2. get the release file -------------------------------------------------------------------------------------
fetch_online() {
  command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl ca-certificates; } >/dev/null 2>&1
  command -v curl >/dev/null || die "curl is missing and could not be installed."
  if [ -n "$MIRROR_BASE" ]; then
    [ -n "$VER" ] || VER="$(curl -fsSL "$MIRROR_BASE/LATEST" | tr -d '[:space:]')"
    [ -n "$VER" ] || die "Cannot read $MIRROR_BASE/LATEST"
    A="tikootak-$VER.tar.gz"; say "Downloading $A from your mirror"
    curl -fSL -o "$TMP/$A" "$MIRROR_BASE/$A" || die "Download failed."
    curl -fsSL -o "$TMP/$A.sha256" "$MIRROR_BASE/$A.sha256" || true
    FILE="$TMP/$A"; return
  fi
  command -v python3 >/dev/null || { apt-get update -qq && apt-get install -y -qq python3; } >/dev/null 2>&1
  command -v python3 >/dev/null || die "python3 is required (apt install python3)."
  local api="https://api.github.com/repos/$REPO/releases" rel json code
  if [ -n "$VER" ]; then rel="$api/tags/v$VER"; else rel="$api/latest"; fi
  while :; do
    local auth=(); [ -n "$TOKEN" ] && auth=(-H "Authorization: Bearer $TOKEN")
    code="$(curl -sS -o "$TMP/rel.json" -w '%{http_code}' ${auth[@]+"${auth[@]}"} -H 'Accept: application/vnd.github+json' "$rel" 2>"$TMP/curl.err")" || code=000
    [ "$code" = 200 ] && break
    if [ "$code" = 000 ]; then
      die "Cannot reach GitHub ($(tr -d '\n' <"$TMP/curl.err" | cut -c1-120))." "GitHub is probably blocked here. Re-run and choose OFFLINE, or use --mirror-base URL."
    fi
    if { [ "$code" = 404 ] || [ "$code" = 401 ] || [ "$code" = 403 ]; } && [ -z "$TOKEN" ] && have_tty; then
      echo "GitHub answered $code: the repo is private (or the release does not exist)."
      echo "Create a fine-grained token (only this repo, permission 'Contents: read') and paste it here (it is not shown):"
      ask_secret "Token: "; TOKEN="$REPLY"; [ -n "$TOKEN" ] || die "No token given."
      continue
    fi
    die "GitHub answered HTTP $code for $rel" "Wrong --repo/--version, or the token is invalid/expired."
  done
  VER="$(python3 -c 'import sys,json;print(json.load(open(sys.argv[1]))["tag_name"].lstrip("v"))' "$TMP/rel.json")"
  A="tikootak-$VER.tar.gz"; say "Downloading release $VER"
  local n url
  for n in "$A" "$A.sha256"; do
    url="$(python3 -c 'import sys,json;n=sys.argv[2];print(next((a["url"] for a in json.load(open(sys.argv[1]))["assets"] if a["name"]==n),""))' "$TMP/rel.json" "$n")"
    [ -n "$url" ] || die "Asset $n is not in release $VER."
    local auth=(); [ -n "$TOKEN" ] && auth=(-H "Authorization: Bearer $TOKEN")
    curl -fSL ${auth[@]+"${auth[@]}"} -H 'Accept: application/octet-stream' -o "$TMP/$n" "$url" || die "Download of $n failed."
  done
  FILE="$TMP/$A"
}

find_offline() {
  local c=() f
  for f in /root/tikootak-full-*.tar /root/tikootak-*.tar.gz /home/*/tikootak-full-*.tar /home/*/tikootak-*.tar.gz /tmp/tikootak-full-*.tar /tmp/tikootak-*.tar.gz "$PWD"/tikootak-full-*.tar "$PWD"/tikootak-*.tar.gz; do
    [ -f "$f" ] && c+=("$f")
  done
  printf '%s\n' ${c[@]+"${c[@]}"} | awk '!s[$0]++'
}

if [ "$MODE" = online ]; then
  [ -n "$FILE" ] || fetch_online
else
  if [ -z "$FILE" ]; then
    mapfile -t FOUND < <(find_offline)
    if [ "${#FOUND[@]}" -gt 0 ]; then
      echo "Found these files on this server:"; i=1; for f in "${FOUND[@]}"; do echo "  $i) $f"; i=$((i+1)); done
      ask "Choose a number, or type another path [1]: " 1
      if [[ "$REPLY" =~ ^[0-9]+$ ]] && [ "$REPLY" -ge 1 ] && [ "$REPLY" -le "${#FOUND[@]}" ]; then FILE="${FOUND[$((REPLY-1))]}"; else FILE="$REPLY"; fi
    else
      echo "No tikootak-full-*.tar / tikootak-*.tar.gz found in /root, /home, /tmp or here."
      echo "Upload it first, from your own computer (PowerShell):"
      echo "   scp tikootak-full-X.Y.Z.tar root@THIS_SERVER_IP:/root/"
      ask "Path of the uploaded file (empty = quit): " ""; FILE="$REPLY"
      [ -n "$FILE" ] || die "Nothing to install. Upload the file and run this command again."
    fi
  fi
fi
[ -f "$FILE" ] || die "File not found: $FILE"

# integrity check when a .sha256 sits next to the file
if [ -f "$FILE.sha256" ]; then
  (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" >/dev/null 2>&1) || die "Checksum mismatch for $FILE" "The file is damaged or incomplete; copy it again."
  say "Checksum OK"
fi

# ---- 3. unpack -------------------------------------------------------------------------------------------------
if [ -f "$DIR/.env" ]; then
  die "$DIR already holds an installation (.env exists)." "To upgrade use: cd $DIR && ./scripts/update.sh --file $FILE   (or choose another --dir)"
fi
mkdir -p "$TMP/x" && tar xf "$FILE" -C "$TMP/x" || die "Cannot unpack $FILE (is it a TIKOOTAK .tar/.tar.gz?)"
SRC="$(find "$TMP/x" -maxdepth 1 -mindepth 1 -type d | head -1)"
[ -n "$SRC" ] && [ -f "$SRC/VERSION" ] && [ -x "$SRC/scripts/bootstrap.sh" -o -f "$SRC/scripts/bootstrap.sh" ] || die "This archive does not look like TIKOOTAK."
say "TIKOOTAK $(cat "$SRC/VERSION") -> $DIR"
mkdir -p "$DIR" && cp -a "$SRC"/. "$DIR"/ || die "Cannot copy files to $DIR"
chmod +x "$DIR"/scripts/*.sh "$DIR"/install.sh 2>/dev/null || true
if [ "$MODE" = online ] && [ -z "$MIRROR_BASE" ]; then
  # remember where updates come from, so "tikootak update" works later (file stays private, git-ignored)
  { echo "REPO=$REPO"; echo "TOKEN=$TOKEN"; echo "MIRROR_BASE="; } > "$DIR/.update.conf"; chmod 600 "$DIR/.update.conf"
fi
cd "$DIR" || exit 1

# ---- 4. questions + go -----------------------------------------------------------------------------------------
if [ -z "$DOMAIN" ]; then
  have_tty || die "Give --domain example.com"
  echo; echo "Domain: its A record must already point to this server (Arvan cloud icon must be GREY / DNS only)."
  ask "Your domain (e.g. example.com): " ""; DOMAIN="$REPLY"
fi
[ -n "$DOMAIN" ] || die "Domain is required."
if [ -z "$RESTORE" ] && have_tty && [ "$YES" != 1 ]; then
  ask "Moving from an old server? Path of the encrypted backup (.enc) to restore after install, or Enter to skip: " ""; RESTORE="$REPLY"
fi
[ -z "$RESTORE" ] || [ -f "$RESTORE" ] || die "Backup file not found: $RESTORE"

echo
echo "  mode:   $MODE"; echo "  domain: $DOMAIN"; echo "  folder: $DIR"; [ -n "$RESTORE" ] && echo "  restore: $RESTORE"
if [ "$YES" != 1 ]; then ask "Start the installation? (Y/n) " y; case "$REPLY" in n|N) echo "Cancelled. Files are in $DIR; run ./scripts/bootstrap.sh --domain $DOMAIN later."; exit 0;; esac; fi

BOOT=(./scripts/bootstrap.sh --domain "$DOMAIN" --yes)
[ "$MODE" = offline ] && [ -f offline-images.tar.gz ] && BOOT+=(--offline)
[ "$MODE" = online ] && BOOT+=(--online)
BOOT+=(${EXTRA[@]+"${EXTRA[@]}"})
"${BOOT[@]}" || die "bootstrap.sh failed." "Read the messages above; after fixing, run again: cd $DIR && ./scripts/bootstrap.sh --domain $DOMAIN --yes"

if [ -n "$RESTORE" ]; then
  say "Restoring backup (it will ask for the backup passphrase)"
  IP="$(grep -E '^PUBLIC_IP=' .env | cut -d= -f2-)"
  ./scripts/restore.sh ${IP:+--ip "$IP"} "$RESTORE" || die "restore.sh failed." "Retry: cd $DIR && ./scripts/restore.sh --dry-run $RESTORE"
  ./scripts/doctor.sh || true
fi
say "Done. Manage with: sudo tikootak   (status, logs, backup, update)"
