#!/usr/bin/env bash
# ============================================================================
# ByteRover Long-Term Memory — Uninstall Script
# ============================================================================
# Removes the ByteRover context engine plugin from an OpenClaw container.
# Run this ON THE HOST, not inside the container.
#
# Usage:
#   bash uninstall.sh [container-name]
#
# Arguments:
#   container-name  Name of the openclaw Docker container (default: "openclaw")
#
# What it removes:
#   - Plugin config from openclaw.json (contextEngine + entries)
#   - Extension directory (/home/node/.openclaw/extensions/byterover)
#   - Workspace symlink (workspace-openvoiceui)
#   - brv-direct shim
#
# What it keeps:
#   - brv CLI (may be used by other tools)
#   - clawhub CLI
#   - Provider credentials
#   - Context tree data (.brv/context-tree/) — your accumulated knowledge
# ============================================================================

set -euo pipefail

CONTAINER="${1:-openclaw}"
EXTENSION_DIR="/home/node/.openclaw/extensions/byterover"
WORKSPACE_SYMLINK="/home/node/.openclaw/workspace-openvoiceui"
BRV_SHIM="/home/node/.local/bin/brv-direct"
CONFIG_PATH="/home/node/.openclaw/openclaw.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[byterover]${NC} $*"; }
warn() { echo -e "${YELLOW}[byterover]${NC} $*"; }
err()  { echo -e "${RED}[byterover]${NC} $*" >&2; }

# Detect docker command
detect_docker() {
    if docker info &>/dev/null; then
        DOCKER_CMD="docker"
    elif sg docker -c "docker info" &>/dev/null; then
        DOCKER_CMD="sg docker -c docker"
    else
        err "Cannot connect to Docker daemon."
        exit 1
    fi
}

dexec() {
    if [[ "$DOCKER_CMD" == "sg docker -c docker" ]]; then
        sg docker -c "docker exec $CONTAINER $*"
    else
        docker exec "$CONTAINER" "$@"
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo ""
echo "============================================================"
echo "  ByteRover Long-Term Memory — Uninstaller"
echo "  Container: $CONTAINER"
echo "============================================================"
echo ""

detect_docker

# Verify container is running
state=""
if [[ "$DOCKER_CMD" == "sg docker -c docker" ]]; then
    state=$(sg docker -c "docker inspect -f '{{.State.Running}}' $CONTAINER" 2>/dev/null || true)
else
    state=$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)
fi

if [[ "$state" != "true" ]]; then
    err "Container '$CONTAINER' is not running."
    exit 1
fi

removed=0

# 1. Remove plugin config from openclaw.json
if dexec test -f "$CONFIG_PATH" 2>/dev/null; then
    if dexec grep -q 'contextEngine' "$CONFIG_PATH" 2>/dev/null; then
        log "Removing plugin config from openclaw.json..."

        dexec node -e "
const fs = require('fs');
let raw = fs.readFileSync('$CONFIG_PATH', 'utf8');

// Remove the plugins block entirely
// Match: plugins: { ... }, (with nested braces)
let depth = 0;
let start = -1;
let end = -1;
const pluginsMatch = raw.match(/\\n\\s*plugins:\\s*\\{/);
if (pluginsMatch) {
    start = raw.indexOf(pluginsMatch[0]);
    let i = raw.indexOf('{', start);
    depth = 1;
    i++;
    while (i < raw.length && depth > 0) {
        if (raw[i] === '{') depth++;
        if (raw[i] === '}') depth--;
        i++;
    }
    // Skip trailing comma and whitespace
    while (i < raw.length && (raw[i] === ',' || raw[i] === ' ' || raw[i] === '\\n')) {
        i++;
        // Stop at next non-whitespace that is not comma
        if (raw[i] && raw[i] !== ',' && raw[i] !== ' ' && raw[i] !== '\\n' && raw[i] !== '\\r') break;
    }
    end = i;
    raw = raw.substring(0, start) + raw.substring(end);
    fs.writeFileSync('$CONFIG_PATH', raw);
    console.log('Removed plugins section from openclaw.json');
} else {
    console.log('No plugins section found in openclaw.json');
}
" 2>&1
        ((removed++))
    else
        log "No plugin config found in openclaw.json."
    fi
fi

# 2. Remove extension directory
if dexec test -d "$EXTENSION_DIR" 2>/dev/null; then
    log "Removing extension directory: $EXTENSION_DIR"
    dexec rm -rf "$EXTENSION_DIR"
    ((removed++))
else
    log "Extension directory not found (already removed)."
fi

# 3. Remove workspace symlink
if dexec test -L "$WORKSPACE_SYMLINK" 2>/dev/null; then
    log "Removing workspace symlink: $WORKSPACE_SYMLINK"
    dexec rm -f "$WORKSPACE_SYMLINK"
    ((removed++))
else
    log "Workspace symlink not found (already removed)."
fi

# 4. Remove brv-direct shim
if dexec test -f "$BRV_SHIM" 2>/dev/null; then
    log "Removing brv-direct shim: $BRV_SHIM"
    dexec rm -f "$BRV_SHIM"
    ((removed++))
else
    log "brv-direct shim not found (already removed)."
fi

# Summary
echo ""
echo "============================================================"
if [[ $removed -gt 0 ]]; then
    log "Removed $removed component(s)."
else
    log "Nothing to remove (already clean)."
fi
echo "============================================================"
echo ""
echo "Kept (not removed):"
echo "  - brv CLI (may be used by other tools)"
echo "  - clawhub CLI"
echo "  - Provider credentials (~/.config/byterover/)"
echo "  - Context tree data (.brv/context-tree/)"
echo ""
echo "To fully clean up CLI tools:"
echo "  docker exec $CONTAINER pnpm remove -g byterover-cli clawhub"
echo ""
echo "To remove accumulated knowledge:"
echo "  docker exec $CONTAINER rm -rf /home/node/.openclaw/workspace/.brv"
echo ""
echo "Restart the container to apply changes:"
echo "  docker restart $CONTAINER"
echo ""
