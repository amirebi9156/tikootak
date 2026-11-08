#!/usr/bin/env bash
# Terminal helpers for the installer (sourced, not executed).
# Rule: the terminal shows ONE short line per action; all noisy output (apt, docker, npm) goes to the log file.
#   step "Title"                      -> "[3/9] Title"
#   ok / info / warn / die            -> status lines
#   qrun "Label" command args...      -> runs quietly with a spinner, prints "✔ Label (12s)" or the last lines of its output on failure
LOG="${LOG:-/var/log/tikootak-bootstrap.log}"
touch "$LOG" 2>/dev/null || LOG=/dev/null

if [ -t 1 ]; then R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[1m'; D=$'\e[2m'; N=$'\e[0m'; else R=""; G=""; Y=""; B=""; D=""; N=""; fi
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *UTF-8*|*utf8*|*UTF8*) S_OK="✔"; S_BAD="✘"; S_WARN="!"; S_ARROW="→";;
  *) S_OK="OK"; S_BAD="X"; S_WARN="!"; S_ARROW="->";;
esac

_log() { printf '%s %s\n' "$(date +%T)" "$*" >>"$LOG" 2>/dev/null || true; }
# apt/needrestart/debconf can leave the terminal in raw mode (every line then starts further to the right); undo that.
term_sane() { if [ -t 1 ]; then stty sane 2>/dev/null || true; fi; return 0; }

STEP_N=0; STEP_TOTAL="${STEP_TOTAL:-9}"
step() { STEP_N=$((STEP_N + 1)); term_sane; printf '\n%s[%s/%s] %s%s\n' "$B" "$STEP_N" "$STEP_TOTAL" "$1" "$N"; _log "== [$STEP_N/$STEP_TOTAL] $1"; }
ok()   { printf '  %s%s%s %s\n' "$G" "$S_OK" "$N" "$1"; _log "OK   $1"; }
info() { printf '    %s%s%s\n' "$D" "$1" "$N"; _log "     $1"; }
warn() { printf '  %s%s%s %s\n' "$Y" "$S_WARN" "$N" "$1"; [ -n "${2:-}" ] && printf '    %s%s %s%s\n' "$D" "$S_ARROW" "$2" "$N"; _log "WARN $1"; return 0; }
die()  {
  term_sane
  printf '\n  %s%s %s%s\n' "$R" "$S_BAD" "$1" "$N"
  [ -n "${2:-}" ] && printf '    %s %s\n' "$S_ARROW" "$2"
  printf '    Full log: %s\n' "$LOG"
  _log "FAIL $1"; exit 1
}

LAST_OUT=""
# qrun "label" cmd args...   (stdin is /dev/null so nothing can ask a question on the terminal)
qrun() {
  local label="$1" pid rc i=0 t0=$SECONDS sp='|/-\'; shift
  LAST_OUT="$(mktemp /tmp/tikootak-run.XXXXXX)"
  _log "RUN  $label :: $*"
  ( "$@" ) </dev/null >"$LAST_OUT" 2>&1 &
  pid=$!
  if [ -t 1 ]; then
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r  %s %s (%ss)' "${sp:$((i % 4)):1}" "$label" $((SECONDS - t0)); i=$((i + 1)); sleep 0.2
    done
    printf '\r\033[K'
  fi
  wait "$pid"; rc=$?
  { echo "---- $label (exit $rc)"; cat "$LAST_OUT"; } >>"$LOG" 2>/dev/null || true
  term_sane
  if [ "$rc" = 0 ]; then ok "$label ($((SECONDS - t0))s)"
  else
    printf '  %s%s%s %s failed (exit %s)\n' "$R" "$S_BAD" "$N" "$label" "$rc"
    tail -n 8 "$LAST_OUT" | sed 's/^/      | /'
  fi
  return "$rc"
}
