#!/usr/bin/env bash
# TIKOOTAK admin tool. Usage: ./scripts/admin.sh <command>   (if docker needs sudo: sudo ./scripts/admin.sh ...)
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env; set +a

gw() { # METHOD PATH [json body] -> readable JSON output
  docker compose exec -T -e M="$1" -e P="$2" -e B="${3:-}" gateway node -e '
    (async () => {
      const r = await fetch("http://127.0.0.1:3000" + process.env.P, {
        method: process.env.M,
        headers: { "x-admin-key": process.env.GATEWAY_ADMIN_KEY, "content-type": "application/json" },
        body: process.env.B || undefined,
      });
      const t = await r.text();
      try { console.log(JSON.stringify(JSON.parse(t), null, 1)); } catch { console.log(t); }
      process.exit(r.ok ? 0 : 1);
    })().catch((e) => { console.error(e.message); process.exit(2); });'
}

uid() { case "$1" in @*:*) echo "$1";; @*) echo "$1:$DOMAIN";; *) echo "@$1:$DOMAIN";; esac; }

case "${1:-help}" in
  stats)    gw GET /api/admin/stats ;;
  users)    gw GET /api/admin/users ;;
  posts)    gw GET /api/admin/posts ;;
  tracks)   gw GET /api/admin/tracks ;;
  invites)  gw GET /api/admin/invites ;;
  invite)   gw POST /api/admin/invites "{\"max_uses\":${2:-1},\"expires_days\":${3:-7}}" ;;   # ./admin.sh invite [max uses] [valid days]
  audit)    gw GET "/api/admin/audit?limit=${2:-50}" ;;
  rotate-key)
    echo "The admin key will be replaced. The old key stops working and the gateway restarts."
    read -r -p "Continue? (y/N) " a; [ "$a" = y ] || exit 0
    NEW="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    sed -i '/^GATEWAY_ADMIN_KEY=/d' .env; echo "GATEWAY_ADMIN_KEY=$NEW" >> .env
    docker compose up -d gateway && echo "[OK] New key saved in .env (GATEWAY_ADMIN_KEY)." ;;
  delpost)  [ -n "${2:-}" ] || { echo "[FAIL] Give the post id (from: ./scripts/admin.sh posts)"; exit 1; }; gw DELETE "/api/admin/posts/$2" ;;
  deltrack) [ -n "${2:-}" ] || { echo "[FAIL] Give the track id (from: ./scripts/admin.sh tracks)"; exit 1; }; gw DELETE "/api/admin/tracks/$2" ;;
  wipe)     [ -n "${2:-}" ] || { echo "[FAIL] Give a username"; exit 1; }; read -r -p "All content of $2 will be deleted permanently. Continue? (y/N) " a; [ "$a" = y ] || exit 0; U="$(uid "$2")"; gw DELETE "/api/admin/users/$(printf '%s' "$U" | sed 's/@/%40/;s/:/%3A/')/content" ;;
  ban)
    [ -n "${2:-}" ] || { echo "[FAIL] Give a username"; exit 1; }
    U="$(uid "$2")"
    echo "User $U will be deactivated: cannot log in and sessions are closed (content is not deleted; use wipe for that)."
    read -r -p "Continue? (y/N) " a; [ "$a" = y ] || exit 0
    gw POST "/api/admin/users/$(printf '%s' "$U" | sed 's/@/%40/;s/:/%3A/')/ban" '{"reason":"admin"}' >/dev/null || true
    docker compose exec -T postgres psql -U synapse -d synapse -v ON_ERROR_STOP=1 -c \
      "UPDATE users SET deactivated = 1 WHERE name = '$U'; DELETE FROM access_tokens WHERE user_id = '$U'; DELETE FROM devices WHERE user_id = '$U';" \
      && docker compose restart synapse && echo "[OK] Done." ;;
  signup)   # ./admin.sh signup close|open|status  - instantly stop/resume signups
    case "${2:-status}" in
      close)  gw POST /api/admin/settings '{"registration_open":false}' | head -20; echo "[OK] Signup closed." ;;
      open)   gw POST /api/admin/settings '{"registration_open":true}' | head -20; echo "[OK] Signup opened." ;;
      *)      gw GET /api/admin/settings ;;
    esac ;;
  overview) gw GET /api/admin/overview ;;
  purge)    # Full ban: deactivate chat account + delete all content + revoke its invite codes.  With --branch, all invitees too
    [ -n "${2:-}" ] || { echo "[FAIL] Give a username  (optional: --branch)"; exit 1; }
    U="$(uid "$2")"; C=false; [ "${3:-}" = "--branch" ] && C=true
    read -r -p "Full ban of $U (invitee branch: $C) is irreversible. Continue? (y/N) " a; [ "$a" = y ] || exit 0
    gw POST "/api/admin/users/$(printf '%s' "$U" | sed 's/@/%40/;s/:/%3A/')/purge" "{\"cascade\":$C}" ;;
  help|*)
    cat <<'TXT'
Commands:
  stats                overall stats (users, posts, tracks, file sizes)
  users                list users with post and track counts
  invites              list invite codes       |  invite [uses] [days]   create a new invite code
  posts / tracks       list latest posts / tracks (with ids)
  delpost <id>         delete a post           |  deltrack <id>  delete a track
  wipe <user>          delete all posts, comments, tracks and playlists of a user
  audit [count]        audit log (admin actions and failed attempts)
  rotate-key           generate a new admin key
  ban <user>           deactivate account (login blocked, sessions closed)
  purge <user> [--branch]  full ban + delete all content (--branch: all invitees too)
  signup close|open|status  instantly stop/resume signups   |  overview  capacity overview
TXT
    ;;
esac
