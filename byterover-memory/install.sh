#!/usr/bin/env bash
# ============================================================================
# ByteRover Long-Term Memory — Install Script
# ============================================================================
# Installs the ByteRover context engine into an OpenClaw container.
# Run this ON THE HOST, not inside the container.
#
# Usage:
#   bash install.sh [container-name]
#
# Arguments:
#   container-name  Name of the openclaw Docker container (default: "openclaw")
#
# What it does:
#   1. Installs byterover-cli + clawhub via pnpm global
#   2. Creates the brv-direct shim (avoids pnpm shim resolution issues)
#   3. Installs @byterover/byterover as an openclaw extension
#   4. Creates workspace symlink to work around resolveWorkspaceDir bug
#   5. Connects an LLM provider (interactive prompt)
#   6. Patches openclaw.json with plugin config
#   7. Verifies the installation with a test query
#
# Safe to run multiple times (idempotent).
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CONTAINER="${1:-openclaw}"
BRV_CLI_VERSION="byterover-cli@latest"
CLAWHUB_VERSION="clawhub@latest"
EXTENSION_PKG="@byterover/byterover"
EXTENSION_DIR="/home/node/.openclaw/extensions/byterover"
WORKSPACE="/home/node/.openclaw/workspace"
BRV_SHIM="/home/node/.local/bin/brv-direct"
PNPM_BRV="/usr/local/share/pnpm/brv"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log()   { echo -e "${GREEN}[byterover]${NC} $*"; }
warn()  { echo -e "${YELLOW}[byterover]${NC} $*"; }
err()   { echo -e "${RED}[byterover]${NC} $*" >&2; }
info()  { echo -e "${CYAN}[byterover]${NC} $*"; }

# Detect docker command — handle sg docker group wrapper or plain docker
detect_docker() {
    if docker info &>/dev/null; then
        DOCKER_CMD="docker"
    elif sg docker -c "docker info" &>/dev/null; then
        DOCKER_CMD="sg docker -c docker"
    else
        err "Cannot connect to Docker daemon. Are you in the docker group?"
        exit 1
    fi
}

# Execute a command inside the container
dexec() {
    if [[ "$DOCKER_CMD" == "sg docker -c docker" ]]; then
        sg docker -c "docker exec $CONTAINER $*"
    else
        docker exec "$CONTAINER" "$@"
    fi
}

# Execute with user node (some containers run as root by default)
dexec_node() {
    if [[ "$DOCKER_CMD" == "sg docker -c docker" ]]; then
        sg docker -c "docker exec -u node $CONTAINER $*"
    else
        docker exec -u node "$CONTAINER" "$@"
    fi
}

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------

preflight() {
    log "Checking prerequisites..."

    detect_docker

    # Verify container is running
    local state
    if [[ "$DOCKER_CMD" == "sg docker -c docker" ]]; then
        state=$(sg docker -c "docker inspect -f '{{.State.Running}}' $CONTAINER" 2>/dev/null || true)
    else
        state=$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)
    fi

    if [[ "$state" != "true" ]]; then
        err "Container '$CONTAINER' is not running."
        err "Start it first, then re-run this script."
        exit 1
    fi

    # Verify pnpm is available
    if ! dexec which pnpm &>/dev/null; then
        err "pnpm not found in container. This script requires a pnpm-based openclaw image."
        exit 1
    fi

    log "Container '$CONTAINER' is running and has pnpm."
}

# ---------------------------------------------------------------------------
# Step 1: Install CLI tools
# ---------------------------------------------------------------------------

install_cli() {
    log "Installing byterover-cli and clawhub..."

    # Check if already installed
    if dexec test -f "$PNPM_BRV" 2>/dev/null; then
        local current_ver
        current_ver=$(dexec "$PNPM_BRV" --version 2>/dev/null || echo "unknown")
        info "byterover-cli already installed (version: $current_ver). Updating..."
    fi

    # Install globally via pnpm
    dexec pnpm add -g "$BRV_CLI_VERSION" 2>&1 | tail -3
    dexec pnpm add -g "$CLAWHUB_VERSION" 2>&1 | tail -3

    # Verify
    if ! dexec test -f "$PNPM_BRV"; then
        err "brv CLI not found at $PNPM_BRV after install."
        err "Check pnpm global bin path: docker exec $CONTAINER pnpm bin -g"
        exit 1
    fi

    local ver
    ver=$(dexec "$PNPM_BRV" --version 2>/dev/null || echo "unknown")
    log "byterover-cli installed: v$ver"
}

# ---------------------------------------------------------------------------
# Step 2: Create brv-direct shim
# ---------------------------------------------------------------------------

create_brv_direct_shim() {
    log "Creating brv-direct shim..."

    # The pnpm shim works fine in most cases, but some openclaw plugin
    # invocations need a direct node call. This shim finds the actual
    # run.js and calls node directly, bypassing pnpm shim resolution.

    # Find the actual byterover-cli run.js path
    local run_js
    run_js=$(dexec find /usr/local/share/pnpm/global -name "run.js" -path "*/byterover-cli/bin/*" 2>/dev/null | head -1)

    if [[ -z "$run_js" ]]; then
        warn "Could not find byterover-cli run.js for direct shim."
        warn "The pnpm shim at $PNPM_BRV will be used instead."
        return 0
    fi

    # Find the node_modules path for NODE_PATH
    local node_modules_dir
    node_modules_dir=$(dirname "$(dirname "$(dirname "$run_js")")")/node_modules

    # Create the shim
    dexec bash -c "cat > $BRV_SHIM << 'SHIMEOF'
#!/bin/sh
# brv-direct: calls byterover-cli node entry point directly
# Generated by byterover-memory install.sh
NODE_PATH=\"$node_modules_dir:\${NODE_PATH:-}\" exec node \"$run_js\" \"\$@\"
SHIMEOF"

    dexec chmod +x "$BRV_SHIM"

    if dexec test -f "$BRV_SHIM"; then
        log "brv-direct shim created at $BRV_SHIM"
    else
        warn "Failed to create brv-direct shim. Continuing with pnpm shim."
    fi
}

# ---------------------------------------------------------------------------
# Step 3: Install openclaw extension
# ---------------------------------------------------------------------------

install_extension() {
    log "Installing @byterover/byterover openclaw extension..."

    # Create extension directory
    dexec mkdir -p "$EXTENSION_DIR"

    # Check if already installed
    if dexec test -f "$EXTENSION_DIR/package.json" 2>/dev/null; then
        local current_ver
        current_ver=$(dexec node -e "console.log(require('$EXTENSION_DIR/package.json').version)" 2>/dev/null || echo "unknown")
        info "Extension already exists (version: $current_ver). Reinstalling..."
    fi

    # Create package.json for the extension
    dexec bash -c "cat > $EXTENSION_DIR/package.json << 'PKGEOF'
{
  \"name\": \"byterover\",
  \"version\": \"1.0.0\",
  \"private\": true,
  \"main\": \"node_modules/@byterover/byterover/index.ts\",
  \"openclaw\": {
    \"compat\": {\"pluginApi\": \">=2026.3.22\"},
    \"extensions\": [\"./node_modules/@byterover/byterover/index.ts\"]
  },
  \"dependencies\": {
    \"@byterover/byterover\": \"latest\"
  }
}
PKGEOF"

    # Create openclaw plugin manifest
    dexec bash -c "cat > $EXTENSION_DIR/openclaw.plugin.json << 'MANEOF'
{
  \"id\": \"byterover\",
  \"name\": \"ByteRover\",
  \"description\": \"ByteRover context engine -- curates and queries conversation context via brv CLI\",
  \"version\": \"1.0.0\",
  \"configSchema\": {
    \"type\": \"object\",
    \"properties\": {
      \"brvPath\": {\"type\": \"string\"},
      \"cwd\": {\"type\": \"string\"},
      \"queryTimeoutMs\": {\"type\": \"number\"},
      \"curateTimeoutMs\": {\"type\": \"number\"}
    }
  }
}
MANEOF"

    # Install npm dependencies
    dexec bash -c "cd $EXTENSION_DIR && npm install --no-audit --no-fund 2>&1" | tail -5

    # Verify the extension module exists
    if dexec test -d "$EXTENSION_DIR/node_modules/@byterover/byterover"; then
        local ext_ver
        ext_ver=$(dexec node -e "console.log(require('$EXTENSION_DIR/node_modules/@byterover/byterover/package.json').version)" 2>/dev/null || echo "unknown")
        log "Extension installed: @byterover/byterover v$ext_ver"
    else
        err "Extension install failed. node_modules/@byterover/byterover not found."
        err "Try manually: docker exec $CONTAINER bash -c 'cd $EXTENSION_DIR && npm install'"
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Step 4: Workspace symlink fix
# ---------------------------------------------------------------------------

create_workspace_symlink() {
    log "Creating workspace symlink fix..."

    # ByteRover's plugin has a resolveWorkspaceDir function that sometimes
    # resolves to "workspace-openvoiceui" instead of "workspace" based on
    # the agent ID. This symlink ensures it always finds the right directory.

    local symlink="/home/node/.openclaw/workspace-openvoiceui"

    if dexec test -L "$symlink" 2>/dev/null; then
        info "Workspace symlink already exists."
    elif dexec test -e "$symlink" 2>/dev/null; then
        warn "$symlink exists but is not a symlink. Skipping."
    else
        dexec_node ln -s "$WORKSPACE" "$symlink"
        log "Created symlink: workspace-openvoiceui -> workspace"
    fi
}

# ---------------------------------------------------------------------------
# Step 5: Provider setup (interactive)
# ---------------------------------------------------------------------------

setup_provider() {
    echo ""
    echo "============================================================"
    echo "  LLM Provider Setup"
    echo "============================================================"
    echo ""
    echo "ByteRover needs an LLM provider for context curation."
    echo "Available providers:"
    echo ""
    echo "  Provider              ID                 Env Var"
    echo "  --------------------  -----------------  -------------------------"
    echo "  ByteRover (free)      byterover          (no key needed)"
    echo "  OpenAI                openai             OPENAI_API_KEY"
    echo "  Anthropic             anthropic          ANTHROPIC_API_KEY"
    echo "  Google Gemini         google             GEMINI_API_KEY"
    echo "  Groq                  groq               GROQ_API_KEY"
    echo "  MiniMax               minimax            MINIMAX_API_KEY"
    echo "  GLM (Z.AI)            glm                GLM_API_KEY"
    echo "  OpenRouter            openrouter         OPENROUTER_API_KEY"
    echo "  xAI (Grok)            xai                XAI_API_KEY"
    echo "  Mistral               mistral            MISTRAL_API_KEY"
    echo "  Together AI           togetherai         TOGETHER_API_KEY"
    echo "  DeepInfra             deepinfra          DEEPINFRA_API_KEY"
    echo "  Cohere                cohere             COHERE_API_KEY"
    echo "  Perplexity            perplexity         PERPLEXITY_API_KEY"
    echo "  Cerebras              cerebras           CEREBRAS_API_KEY"
    echo ""

    # Check if any provider is already connected
    local connected
    connected=$(dexec "$PNPM_BRV" providers list 2>/dev/null | grep "(current)" | head -1 || true)
    if [[ -n "$connected" ]]; then
        info "Current provider: $connected"
        echo ""
        read -rp "Keep existing provider? [Y/n] " keep
        if [[ "$keep" =~ ^[Yy]?$ ]] || [[ -z "$keep" ]]; then
            log "Keeping existing provider."
            return 0
        fi
    fi

    read -rp "Enter provider ID (e.g., google, groq, glm): " provider_id

    if [[ -z "$provider_id" ]]; then
        warn "No provider selected. You can set one later with:"
        warn "  docker exec $CONTAINER brv providers connect <provider> --api-key <key>"
        return 0
    fi

    # byterover provider needs no key
    if [[ "$provider_id" == "byterover" ]]; then
        dexec "$PNPM_BRV" providers connect byterover 2>&1 || true
        log "Connected to ByteRover (free tier, rate-limited)."
        return 0
    fi

    read -rsp "Enter API key for $provider_id: " api_key
    echo ""

    if [[ -z "$api_key" ]]; then
        warn "No API key provided. Skipping provider setup."
        warn "Set it later: docker exec $CONTAINER brv providers connect $provider_id --api-key <key>"
        return 0
    fi

    # Connect the provider
    if dexec "$PNPM_BRV" providers connect "$provider_id" --api-key "$api_key" 2>&1; then
        log "Provider '$provider_id' connected successfully."
    else
        err "Failed to connect provider '$provider_id'."
        err "Try manually: docker exec $CONTAINER brv providers connect $provider_id --api-key <key>"
    fi
}

# ---------------------------------------------------------------------------
# Step 6: Patch openclaw.json
# ---------------------------------------------------------------------------

patch_openclaw_config() {
    log "Patching openclaw.json..."

    local config_path="/home/node/.openclaw/openclaw.json"

    # Check if config exists
    if ! dexec test -f "$config_path" 2>/dev/null; then
        err "openclaw.json not found at $config_path"
        err "Is OpenClaw properly initialized in this container?"
        exit 1
    fi

    # Determine the best brv path to use
    local brv_path="$PNPM_BRV"
    if dexec test -f "$BRV_SHIM" 2>/dev/null; then
        brv_path="$BRV_SHIM"
    fi

    # Check if plugin config already exists
    if dexec grep -q '"contextEngine"' "$config_path" 2>/dev/null; then
        info "Plugin config already present in openclaw.json."
        info "Updating brv path to: $brv_path"
    fi

    # Use node to safely merge the plugin config into openclaw.json.
    # This handles the relaxed JSON format (comments, trailing commas)
    # that openclaw uses, by doing a targeted string replacement.
    dexec node -e "
const fs = require('fs');
const path = '$config_path';
let raw = fs.readFileSync(path, 'utf8');

// Check if plugins section already has byterover
if (raw.includes('\"contextEngine\"') && raw.includes('\"byterover\"')) {
    // Update the brvPath value
    raw = raw.replace(
        /brvPath:\s*\"[^\"]*\"/,
        'brvPath: \"$brv_path\"'
    );
    fs.writeFileSync(path, raw);
    console.log('Updated existing byterover config with brv path: $brv_path');
    process.exit(0);
}

// Need to add plugins section
const pluginsBlock = \`
  plugins: {
    slots: {
      contextEngine: \"byterover\",
    },
    entries: {
      byterover: {
        enabled: true,
        config: {
          brvPath: \"$brv_path\",
          cwd: \"$WORKSPACE\",
        },
      },
    },
  },\`;

// Insert before the last closing brace
const lastBrace = raw.lastIndexOf('}');
if (lastBrace === -1) {
    console.error('Could not find closing brace in openclaw.json');
    process.exit(1);
}

// Check if there is already a plugins section (without byterover)
if (raw.includes('plugins:') || raw.includes('\"plugins\"')) {
    console.log('WARNING: plugins section exists but without byterover. Manual edit needed.');
    console.log('Add to plugins.slots: contextEngine: \"byterover\"');
    console.log('Add to plugins.entries: byterover: { enabled: true, config: { brvPath: \"$brv_path\", cwd: \"$WORKSPACE\" } }');
    process.exit(0);
}

// Insert plugins block before the last closing brace
const before = raw.substring(0, lastBrace);
const after = raw.substring(lastBrace);
raw = before + pluginsBlock + '\\n' + after;
fs.writeFileSync(path, raw);
console.log('Added byterover plugin config to openclaw.json');
" 2>&1

    log "openclaw.json updated."
}

# ---------------------------------------------------------------------------
# Step 7: Verify installation
# ---------------------------------------------------------------------------

verify() {
    log "Verifying installation..."

    local errors=0

    # Check brv CLI
    if dexec "$PNPM_BRV" --version &>/dev/null; then
        local ver
        ver=$(dexec "$PNPM_BRV" --version 2>/dev/null)
        log "  brv CLI: v$ver"
    else
        err "  brv CLI: NOT WORKING"
        ((errors++))
    fi

    # Check extension
    if dexec test -d "$EXTENSION_DIR/node_modules/@byterover/byterover" 2>/dev/null; then
        log "  Extension: installed"
    else
        err "  Extension: MISSING"
        ((errors++))
    fi

    # Check workspace symlink
    if dexec test -L "/home/node/.openclaw/workspace-openvoiceui" 2>/dev/null; then
        log "  Workspace symlink: OK"
    else
        warn "  Workspace symlink: missing (may cause issues with some agent IDs)"
    fi

    # Check provider
    local provider
    provider=$(dexec "$PNPM_BRV" providers list 2>/dev/null | grep "(current)" | head -1 || true)
    if [[ -n "$provider" ]]; then
        log "  Provider: $provider"
    else
        warn "  Provider: none configured (run: docker exec $CONTAINER brv providers connect <id> --api-key <key>)"
    fi

    # Test query
    info "Running test query..."
    local test_result
    test_result=$(dexec bash -c "cd $WORKSPACE && $PNPM_BRV query 'test installation' 2>&1" || true)

    if echo "$test_result" | grep -qi "error\|fatal\|not found\|ENOENT"; then
        err "  Test query: FAILED"
        err "  Output: $test_result"
        ((errors++))
    else
        log "  Test query: OK"
    fi

    echo ""
    if [[ $errors -eq 0 ]]; then
        echo "============================================================"
        log "Installation complete."
        echo "============================================================"
        echo ""
        echo "ByteRover will now:"
        echo "  - Query the context tree before each LLM call (10s timeout)"
        echo "  - Curate conversation knowledge after each turn (async)"
        echo "  - Store knowledge in: $WORKSPACE/.brv/context-tree/"
        echo ""
        echo "To verify in logs, look for:"
        echo "  'assemble injecting systemPromptAddition'"
        echo ""
        echo "Restart the container for changes to take effect:"
        echo "  docker restart $CONTAINER"
        echo ""
    else
        echo "============================================================"
        err "Installation completed with $errors error(s)."
        echo "============================================================"
        echo ""
        echo "Review the errors above and fix them before restarting."
        echo ""
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    echo ""
    echo "============================================================"
    echo "  ByteRover Long-Term Memory — Installer"
    echo "  Container: $CONTAINER"
    echo "============================================================"
    echo ""

    preflight
    install_cli
    create_brv_direct_shim
    install_extension
    create_workspace_symlink
    setup_provider
    patch_openclaw_config
    verify
}

main "$@"
