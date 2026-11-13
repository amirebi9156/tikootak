#!/usr/bin/env bash
# Host hardening (Ubuntu/Debian): firewall, fail2ban, automatic security updates, SSH.
# SAFE FOR SHARED SERVERS: it never wipes existing firewall rules, and when it turns the firewall on it first opens every
# port that is listening right now (VPN, tunnels, panels), so nothing that works today stops working.
# Usage:  sudo ./scripts/harden-host.sh [--dry-run] [--ssh-port N] [--ssh-keys-only] [--block-turn-internal]
#   --dry-run              only show what would be done, change nothing
#   --ssh-port N           SSH port (default: read from sshd, else 22)
#   --ssh-keys-only        disable SSH password login + root password login (only if you have an SSH key and tested it!)
#   --block-turn-internal  block the livekit container from reaching private/local networks (prevents TURN abuse)
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
DRY=0; KEYS_ONLY=0; BLOCK_TURN=0; SSH_PORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1;;
    --ssh-keys-only) KEYS_ONLY=1;;
    --block-turn-internal) BLOCK_TURN=1;;
    --ssh-port) shift; SSH_PORT="${1:-}";;
    *) echo "[FAIL] Unknown option: $1"; exit 1;;
  esac; shift
done
[ "$(id -u)" = 0 ] || [ "$DRY" = 1 ] || { echo "[FAIL] Run with sudo."; exit 1; }
run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }

# Detect the SSH port (not locking yourself out is the top priority)
if [ -z "$SSH_PORT" ]; then
  SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || true)"
  SSH_PORT="${SSH_PORT:-22}"
fi
echo "SSH port: $SSH_PORT"

# ---------- Packages ----------
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1
run apt-get -o DPkg::Lock::Timeout=300 -qq update
run apt-get -o DPkg::Lock::Timeout=300 -o Dpkg::Options::=--force-confold -qq install -y ufw fail2ban unattended-upgrades

# ---------- Firewall ----------
# Note: ports published by Docker bypass ufw, and only these are published (see docker-compose.yml)
# We NEVER reset ufw: existing rules stay. If ufw is off now, every port that is listening on a public address right now
# is allowed first, so a VPN / tunnel / panel on this server keeps working after "default deny incoming".
UFW_WAS_ACTIVE=0; ufw status 2>/dev/null | grep -q '^Status: active' && UFW_WAS_ACTIVE=1
if [ "$UFW_WAS_ACTIVE" = 0 ]; then
  KEEP="$(ss -H -ltun 2>/dev/null | awk '{l=$5; if (l ~ /^127\./ || l ~ /^\[?::1\]?:/ || l ~ /%lo/) next; n=split(l,a,":"); p=a[n]; if (p ~ /^[0-9]+$/) print $1, p}' | sort -u)"
  echo "Ports that stay open because they are in use right now:"
  [ -n "$KEEP" ] && echo "$KEEP" | sed 's/^/  /' || echo "  (none)"
  echo "$KEEP" | while read -r proto port; do
    [ -n "${port:-}" ] && run ufw allow "${port}/${proto}" comment "kept: in use before TIKOOTAK" >/dev/null
  done
  run ufw default deny incoming
  run ufw default allow outgoing
fi
run ufw allow "${SSH_PORT}/tcp" comment ssh
run ufw allow 80/tcp comment http
run ufw allow 443/tcp comment https
run ufw allow 7881/tcp comment livekit-tcp
run ufw allow 7882/udp comment livekit-udp
run ufw allow 3478/udp comment turn
run ufw allow 30000:30100/udp comment turn-relay
run ufw --force enable

# ---------- fail2ban (SSH) ----------
SSH_CLIENT_IP="$(echo "${SSH_CLIENT:-}" | awk '{print $1}')"   # never ban the address you are logged in from
if [ "$DRY" = 0 ]; then
  cat > /etc/fail2ban/jail.d/tikootak.local <<J
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 ${SSH_CLIENT_IP}
[sshd]
enabled = true
port = ${SSH_PORT}
maxretry = 5
findtime = 10m
bantime = 1h
J
  systemctl enable --now fail2ban
  systemctl restart fail2ban
else echo "[dry-run] fail2ban jail for sshd (5 attempts/10 min -> 1 hour ban)"; fi

# ---------- Automatic security updates ----------
if [ "$DRY" = 0 ]; then
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'A'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
A
else echo "[dry-run] unattended-upgrades will be enabled"; fi

# ---------- SSH ----------
# Only touched with --ssh-keys-only AND when root already has an authorized key. We never switch off root password login
# for someone who has no key (that would lock them out of their own server).
if [ "$DRY" = 0 ]; then
  mkdir -p /etc/ssh/sshd_config.d
  if [ "$KEYS_ONLY" = 1 ] && [ ! -s /root/.ssh/authorized_keys ]; then
    echo "[WARN] --ssh-keys-only skipped: /root/.ssh/authorized_keys is empty, so password login stays ON (otherwise you would be locked out)."
    KEYS_ONLY=0
  fi
  {
    echo "MaxAuthTries 4"
    echo "X11Forwarding no"
    [ "$KEYS_ONLY" = 1 ] && { echo "PermitRootLogin prohibit-password"; echo "PasswordAuthentication no"; echo "KbdInteractiveAuthentication no"; }
  } > /etc/ssh/sshd_config.d/99-tikootak.conf
  if sshd -t 2>/dev/null; then systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  else echo "[FAIL] SSH config was invalid; file removed"; rm -f /etc/ssh/sshd_config.d/99-tikootak.conf; fi
  if [ "$KEYS_ONLY" = 1 ]; then echo "[WARN] Password login is now disabled. Before closing this terminal, open another one and test logging in with your key."; fi
else echo "[dry-run] SSH: MaxAuthTries 4 $([ "$KEYS_ONLY" = 1 ] && echo ", root key-only, password login disabled (only if root has an authorized key)")"; fi

# ---------- Prevent TURN abuse for internal network scanning (optional) ----------
if [ "$BLOCK_TURN" = 1 ] && [ "$DRY" = 1 ]; then
  echo "[dry-run] iptables rule (DOCKER-USER) for livekit + systemd service tikootak-turn-guard"
elif [ "$BLOCK_TURN" = 1 ]; then
  cat > /usr/local/sbin/tikootak-turn-guard.sh <<'G'
#!/usr/bin/env bash
# The livekit container may not connect to private/local networks (except replies to established connections).
LK="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$(docker ps -qf name=livekit | head -n1)" 2>/dev/null | awk '{print $1}')"
[ -n "$LK" ] || exit 0
iptables -N TIKOOTAK-TURN 2>/dev/null || iptables -F TIKOOTAK-TURN
iptables -C DOCKER-USER -s "$LK" -j TIKOOTAK-TURN 2>/dev/null || iptables -I DOCKER-USER -s "$LK" -j TIKOOTAK-TURN
for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 127.0.0.0/8; do
  iptables -A TIKOOTAK-TURN -d "$net" -m conntrack ! --ctstate ESTABLISHED,RELATED -j DROP
done
iptables -A TIKOOTAK-TURN -j RETURN
G
  chmod 755 /usr/local/sbin/tikootak-turn-guard.sh
  cat > /etc/systemd/system/tikootak-turn-guard.service <<'S'
[Unit]
Description=TIKOOTAK TURN egress guard
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/tikootak-turn-guard.sh
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
S
  systemctl daemon-reload; systemctl enable tikootak-turn-guard.service
  /usr/local/sbin/tikootak-turn-guard.sh || true
  echo "[OK] TURN guard rule enabled. After every livekit rebuild run: systemctl restart tikootak-turn-guard"
fi

echo
echo "[OK] Done. Verify with: ufw status verbose ; fail2ban-client status sshd"
