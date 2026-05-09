#!/bin/bash
# hermes-manage.sh — Manage all Hermes gateway instances via launchctl
#
# Usage:
#   ./hermes-manage.sh start    — load all agents (auto-start on boot)
#   ./hermes-manage.sh stop     — unload all agents
#   ./hermes-manage.sh restart  — unload then load all agents
#   ./hermes-manage.sh update   — stop, update hermes, restart
#   ./hermes-manage.sh status   — show running/stopped agents
#
set -euo pipefail

HERMES_BIN="${HERMES_BIN:-$HOME/.local/bin/hermes}"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PROFILES_DIR="$HOME/.hermes/profiles"

# Default gateway + 6 named profiles
# Format: label:profile_name:display_name  (profile_name empty = default gateway)
AGENTS=(
  "ai.hermes.gateway::Default"
  "ai.hermes.gateway-scout:scout:Scout"
  "ai.hermes.gateway-outreach:outreach:Outreach"
  "ai.hermes.gateway-steward:steward:Steward"
  "ai.hermes.gateway-marketing:marketing:Marketing"
  "ai.hermes.gateway-sales-engineering:sales-engineering:Sales Engineering"
  "ai.hermes.gateway-chief-of-staff:chief-of-staff:Chief of Staff"
)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[hermes-manage]${NC} $*"; }
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*"; }

get_label()   { echo "${1%%:*}"; }
get_profile() { echo "${1#*:}" | cut -d: -f1; }
get_display() { echo "${1##*:}"; }

plist_path() {
  local label="$1"
  echo "$LAUNCH_AGENTS/${label}.plist"
}

is_loaded() {
  local label="$1"
  launchctl list "$label" &>/dev/null
}

get_pid() {
  local label="$1"
  launchctl list "$label" 2>/dev/null | awk '/PID/{print $3}' || true
  # launchctl list <label> outputs lines like: "PID = 1234;" or JSON on newer macOS
  # Simpler: parse the JSON output
  launchctl list "$label" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('PID',''))" 2>/dev/null || true
}

get_port() {
  local profile="$1"
  [[ -z "$profile" ]] && echo "—" && return
  grep 'port:' "$PROFILES_DIR/$profile/config.yaml" 2>/dev/null | awk '{print $2}' || echo "?"
}

# ---------------------------------------------------------------------------

cmd_status() {
  echo ""
  echo "Hermes Agents Status"
  echo "────────────────────────────────────────────────────"
  printf "%-22s %-6s %s\n" "AGENT" "PORT" "STATUS"
  echo "────────────────────────────────────────────────────"

  local running=0 stopped=0

  for entry in "${AGENTS[@]}"; do
    local label profile display port
    label=$(get_label "$entry")
    profile=$(get_profile "$entry")
    display=$(get_display "$entry")
    port=$(get_port "$profile")

    local plist
    plist=$(plist_path "$label")

    if [[ ! -f "$plist" ]]; then
      printf "%-22s %-6s ${RED}no plist${NC}\n" "$display" "$port"
      ((stopped++))
      continue
    fi

    if is_loaded "$label"; then
      local pid
      pid=$(launchctl list 2>/dev/null | awk -v l="$label" '$3==l{print $1}')
      if [[ -n "$pid" && "$pid" != "-" ]]; then
        printf "%-22s %-6s ${GREEN}running${NC} (pid %s)\n" "$display" "$port" "$pid"
        running=$((running + 1))
      else
        printf "%-22s %-6s ${YELLOW}loaded/idle${NC}\n" "$display" "$port"
        stopped=$((stopped + 1))
      fi
    else
      printf "%-22s %-6s ${RED}stopped${NC}\n" "$display" "$port"
      stopped=$((stopped + 1))
    fi
  done

  echo "────────────────────────────────────────────────────"
  echo -e "  ${GREEN}$running running${NC}, ${RED}$stopped stopped${NC}"
  echo ""
  echo "Hermes: $($HERMES_BIN --version 2>&1 | head -1)"
  echo ""
}

cmd_stop() {
  log "Stopping all Hermes agents..."

  for entry in "${AGENTS[@]}"; do
    local label display plist
    label=$(get_label "$entry")
    display=$(get_display "$entry")
    plist=$(plist_path "$label")

    if [[ ! -f "$plist" ]]; then
      warn "$display — plist not found ($plist)"
      continue
    fi

    if is_loaded "$label"; then
      launchctl unload "$plist" 2>/dev/null && ok "$display stopped" || warn "$display — unload failed"
    else
      ok "$display — already stopped"
    fi
  done

  log "All agents stopped"
}

cmd_start() {
  log "Starting all Hermes agents..."

  for entry in "${AGENTS[@]}"; do
    local label display plist
    label=$(get_label "$entry")
    display=$(get_display "$entry")
    plist=$(plist_path "$label")

    if [[ ! -f "$plist" ]]; then
      warn "$display — plist not found ($plist)"
      continue
    fi

    if is_loaded "$label"; then
      ok "$display — already running"
    else
      launchctl load "$plist" 2>/dev/null && ok "$display started" || warn "$display — load failed"
    fi
  done

  log "All agents started"
}

cmd_restart() {
  cmd_stop
  sleep 2
  cmd_start
}

cmd_update() {
  log "Checking for Hermes update..."

  if $HERMES_BIN update --check 2>/dev/null; then
    echo ""
    log "Stopping all agents before update..."
    cmd_stop
    sleep 2

    log "Running hermes update..."
    if $HERMES_BIN update; then
      ok "Update complete: $($HERMES_BIN --version 2>&1 | head -1)"
    else
      fail "Update failed"
      return 1
    fi

    log "Restarting all agents..."
    sleep 2
    cmd_start
  else
    ok "Already up to date: $($HERMES_BIN --version 2>&1 | head -1)"
  fi
}

# ---------------------------------------------------------------------------

cd "$(dirname "$0")"

case "${1:-status}" in
  status)  cmd_status ;;
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  update)  cmd_update ;;
  *)
    echo "Usage: $0 {start|stop|restart|update|status}"
    exit 1
    ;;
esac
