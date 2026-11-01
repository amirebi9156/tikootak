#!/bin/sh
# Create and enable a 2 GB swap file for low-memory servers. Safe to re-run.
# Usage: sudo sh scripts/setup-swap.sh
set -eu

SWAPFILE="${SWAPFILE:-/swapfile}"
SIZE_MB="${SWAP_MB:-2048}"

if [ "$(id -u)" -ne 0 ]; then
  echo "[FAIL] This script must be run as root." >&2
  exit 1
fi

# If any swap is already active, do nothing
if [ -n "$(swapon --show=NAME --noheadings 2>/dev/null || true)" ]; then
  echo "[OK] swap is already active:"
  swapon --show
  exit 0
fi

if [ ! -f "$SWAPFILE" ]; then
  echo "Creating $SWAPFILE (${SIZE_MB}MB)..."
  if command -v fallocate >/dev/null 2>&1; then
    fallocate -l "${SIZE_MB}M" "$SWAPFILE" 2>/dev/null || dd if=/dev/zero of="$SWAPFILE" bs=1M count="$SIZE_MB" status=none
  else
    dd if=/dev/zero of="$SWAPFILE" bs=1M count="$SIZE_MB" status=none
  fi
  chmod 600 "$SWAPFILE"
  mkswap "$SWAPFILE" >/dev/null
else
  chmod 600 "$SWAPFILE" 2>/dev/null || true
fi

# If the file exists but has no swap signature
if ! swapon "$SWAPFILE" 2>/dev/null; then
  mkswap "$SWAPFILE" >/dev/null
  swapon "$SWAPFILE"
fi

if ! awk -v f="$SWAPFILE" '$1 == f { found = 1 } END { exit !found }' /etc/fstab 2>/dev/null; then
  echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
fi

echo "[OK] swap enabled:"
swapon --show
