#!/usr/bin/env bash
# TIKOOTAK interactive installer. Run as root from the extracted folder:
#   sudo bash install.sh
# It asks for your domain, installs everything, then opens the management menu (sudo tikootak).
cd "$(dirname "$0")" || exit 1
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
