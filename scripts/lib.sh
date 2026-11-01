#!/usr/bin/env bash
# Shared functions for the backup/restore/migrate scripts (loaded with source)

# Notification (same settings as monitor.sh: ALERT_WEBHOOK_URL or ALERT_BOT_TOKEN+ALERT_CHAT_ID)
notify() {
  echo "$1"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then curl -fsS -m 15 -d "$1" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true; fi
  if [ -n "${ALERT_BOT_TOKEN:-}" ] && [ -n "${ALERT_CHAT_ID:-}" ]; then
    curl -fsS -m 15 "${ALERT_API_BASE:-https://api.telegram.org}/bot${ALERT_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${ALERT_CHAT_ID}" --data-urlencode "text=$1" >/dev/null 2>&1 || true
  fi
}

# AES-256 encrypt/decrypt with BACKUP_PASSPHRASE (from the environment, not the command line)
enc_file() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -in "$1" -out "$2" -pass env:BACKUP_PASSPHRASE; }
dec_file() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -in "$1" -out "$2" -pass env:BACKUP_PASSPHRASE 2>/dev/null; }

# Decrypts the file (if .enc) and sets OPEN_TAR to the plain tar.gz path. $1=file  $2=work dir
open_backup() {
  local f="$1" work="$2"
  [ -f "$f" ] || { echo "File not found: $f"; return 1; }
  if [ -f "$f.sha256" ]; then
    ( cd "$(dirname "$f")" && sha256sum -c "$(basename "$f").sha256" >/dev/null 2>&1 ) \
      || { echo "[FAIL] Backup checksum mismatch (file is incomplete or corrupted)"; return 1; }
    echo "[OK] Checksum is correct"
  fi
  case "$f" in
    *.enc)
      if [ -z "${BACKUP_PASSPHRASE:-}" ]; then read -r -s -p "Backup passphrase (BACKUP_PASSPHRASE): " BACKUP_PASSPHRASE; echo; export BACKUP_PASSPHRASE; fi
      dec_file "$f" "$work/backup.tar.gz" || { echo "[FAIL] Decryption failed; wrong passphrase or corrupted file"; return 1; }
      OPEN_TAR="$work/backup.tar.gz" ;;
    *) OPEN_TAR="$f" ;;
  esac
  tar tzf "$OPEN_TAR" >/dev/null 2>&1 || { echo "[FAIL] Archive is not valid (wrong passphrase or corrupted file)"; return 1; }
}

# Deep check of the backup contents; the extracted dir is kept in VERIFY_DIR. Returns: 0 healthy, 1 has problems
verify_archive() {
  local tarf="$1" d="$2" bad=0
  mkdir -p "$d"; tar xzf "$tarf" -C "$d" || { echo "[FAIL] Extraction failed"; return 1; }
  for need in env db.sql.gz gateway synapse manifest.txt; do
    [ -e "$d/$need" ] && echo "[OK] $need" || { echo "[FAIL] $need is missing from the backup"; bad=1; }
  done
  gzip -t "$d/db.sql.gz" 2>/dev/null && echo "[OK] db.sql.gz is valid" || { echo "[FAIL] db.sql.gz is corrupted"; bad=1; }
  if gunzip -c "$d/db.sql.gz" 2>/dev/null | grep 'CREATE TABLE public.users' >/dev/null; then echo "[OK] users table exists in the Postgres dump"; else echo "[FAIL] Postgres dump is incomplete (no users table)"; bad=1; fi
  ls "$d"/synapse/*.signing.key >/dev/null 2>&1 && echo "[OK] Synapse signing key is present" || { echo "[FAIL] Synapse signing key is missing (without it the new server cannot keep the old identity)"; bad=1; }
  local db; db="$(ls "$d"/gateway/*.db 2>/dev/null | head -1)"
  if [ -n "$db" ]; then
    if command -v python3 >/dev/null; then
      r="$(python3 - "$db" <<'PY'
import sqlite3,sys
c=sqlite3.connect('file:%s?mode=ro'%sys.argv[1],uri=True)
ok=c.execute('PRAGMA integrity_check').fetchone()[0]
n=c.execute('SELECT COUNT(*) FROM registrations').fetchone()[0]
print(ok,n)
PY
)" || r="err"
      case "$r" in "ok "*) echo "[OK] Gateway database is healthy (users: ${r#ok })";; *) echo "[FAIL] Gateway database has a problem: $r"; bad=1;; esac
    else echo "[WARN] python3 not found; gateway database integrity not checked"; fi
  else echo "[FAIL] Gateway database is missing"; bad=1; fi
  [ -f "$d/manifest.txt" ] && sed 's/^/  - /' "$d/manifest.txt"
  return "$bad"
}

export OFFLINE_LOADED=0
load_offline_images() {
  for f in offline-images.tar.gz offline-images.tar images.tar.gz; do
    if [ -f "$f" ]; then echo "Loading offline images from $f ..."; docker load -i "$f" >/dev/null && echo "[OK] Images loaded"; return 0; fi
  done
  return 0
}
