#!/usr/bin/env bash
# Full encrypted backup: Postgres database + Synapse (signing key and media) + gateway database and media + .env
# Output: backups/tikootak-YYYYmmdd-HHMMSS.tar.gz.enc  (+ .sha256 file)
# Passphrase: BACKUP_PASSPHRASE in .env (generated if missing). Keep a copy somewhere safe, away from the server;
# without it the backup cannot be opened. (BACKUP_ENCRYPT=0 -> no encryption)
# Off-site copy (optional, in .env):  BACKUP_SCP_TARGET=user@host:/path   or   RESTIC_REPOSITORY/RESTIC_PASSWORD
set -euo pipefail
umask 077
cd "$(dirname "$0")/.." || exit 1
. ./scripts/lib.sh
set -a; . ./.env; set +a

if [ "${BACKUP_ENCRYPT:-1}" != 0 ] && [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  BACKUP_PASSPHRASE="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  echo "BACKUP_PASSPHRASE=$BACKUP_PASSPHRASE" >> .env
  export BACKUP_PASSPHRASE
  echo "=============================================================="
  echo " Backup passphrase was generated and saved in .env:"
  echo "   $BACKUP_PASSPHRASE"
  echo " Save a copy of it somewhere safe now (saved messages / password manager)."
  echo " The .env file is inside the encrypted backup; if you lose the server and .env and do not have this passphrase, the backup is useless."
  echo "=============================================================="
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir -p backups

docker compose exec -T postgres pg_dump -U synapse --clean --if-exists synapse | gzip > "$STAGE/db.sql.gz"

# SQLite: consistent copy of the database (official backup API; safe even during writes)
DBFILE="$(basename "${DB_PATH_IN_CONTAINER:-/data/gateway.db}")"
docker compose exec -T gateway node -e "
const D=require('better-sqlite3');const d=new D(process.env.DB_PATH);
d.backup('/data/.snapshot.db').then(()=>{d.close();}).catch(e=>{console.error(e.message);process.exit(1);});"
mkdir -p "$STAGE/gateway"
( cd data/gateway && tar cf - --exclude="$DBFILE" --exclude="$DBFILE-wal" --exclude="$DBFILE-shm" --exclude=.snapshot.db . ) | tar xf - -C "$STAGE/gateway"
mv data/gateway/.snapshot.db "$STAGE/gateway/$DBFILE"
cp -r data/synapse "$STAGE/synapse"
cp .env "$STAGE/env"
cp -r certs "$STAGE/certs" 2>/dev/null || true

USERS="$(sqlite3 "$STAGE/gateway/$DBFILE" 'select count(*) from registrations' 2>/dev/null || python3 -c "import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute('select count(*) from registrations').fetchone()[0])" "$STAGE/gateway/$DBFILE" 2>/dev/null || echo '?')"
cat > "$STAGE/manifest.txt" <<M
created=$(date -u +%FT%TZ)
host=$(hostname)
domain=${DOMAIN}
public_ip=${PUBLIC_IP}
users=${USERS}
encrypted=${BACKUP_ENCRYPT:-1}
gateway_mb=$(du -sm "$STAGE/gateway" | cut -f1)
synapse_mb=$(du -sm "$STAGE/synapse" | cut -f1)
M

TMP="$STAGE/out.tar.gz"
EXTRAS=()
[ -d "$STAGE/certs" ] && EXTRAS+=(certs)
tar -czf "$TMP" -C "$STAGE" env db.sql.gz gateway synapse manifest.txt "${EXTRAS[@]}"
if [ "${BACKUP_ENCRYPT:-1}" != 0 ]; then
  OUT="backups/tikootak-${STAMP}.tar.gz.enc"; enc_file "$TMP" "$OUT"
else OUT="backups/tikootak-${STAMP}.tar.gz"; cp "$TMP" "$OUT"; fi
chmod 600 "$OUT"
( cd backups && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
echo "Backup created: $OUT ($(du -h "$OUT" | cut -f1), users: $USERS)"

# Keep the last 14 backups
# Never let housekeeping fail the backup: with pipefail, `ls` on a glob with no match (e.g. old hamdam-* names) returns 2
# and set -e would abort here, after the backup file already exists but BEFORE the off-site copy runs.
{ ls -1t backups/tikootak-*.tar.gz* backups/hamdam-*.tar.gz* 2>/dev/null || true; } | { grep -v '\.sha256$' || true; } | awk '!seen[$0]++' | tail -n +15 | while read -r f; do rm -f -- "$f" "$f.sha256"; done || true

if [ -n "${BACKUP_SCP_TARGET:-}" ]; then
  if scp -q -o BatchMode=yes -o ConnectTimeout=20 "$OUT" "$OUT.sha256" "$BACKUP_SCP_TARGET/"; then echo "Sent to $BACKUP_SCP_TARGET."
  else notify "TIKOOTAK ($(hostname)): sending backup to $BACKUP_SCP_TARGET failed"; fi
fi
if [ -n "${RESTIC_REPOSITORY:-}" ]; then
  export RESTIC_REPOSITORY RESTIC_PASSWORD
  restic snapshots >/dev/null 2>&1 || restic init
  restic backup "$OUT"
  restic forget --keep-daily 7 --keep-weekly 4 --prune
  echo "Also sent to restic."
fi
