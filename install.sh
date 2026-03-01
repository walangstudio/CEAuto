#!/usr/bin/env bash
set -euo pipefail

# ── Config ──────────────────────────────────────────────
MARKER_FILE=".ceauto-installed"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CEAUTO_DIR="$SCRIPT_DIR"

# ── Defaults ────────────────────────────────────────────
FORCE=false
UNINSTALL=false
UPDATE=false
CLIENT="desktop"
SKIP_TEST=false
GLOBAL_CONFIG=false
CLIENT_EXPLICIT=false

# ── Parse flags ─────────────────────────────────────────
show_help() {
    cat <<EOF
Usage: ./install.sh [options]

Options:
  -c, --client TYPE   MCP client: desktop, code, kilo, opencode, goose, all (default: desktop)
  -f, --force         Skip prompts, overwrite existing config
  -u, --uninstall     Remove CEAuto from MCP client config
      --upgrade       Upgrade npm deps and reconfigure
      --update        Alias for --upgrade
      --global        Write to global config path (applies to: code, opencode, all)
                      Default (no --global): writes to parent workspace dir
      --skip-test     Skip server validation
  -h, --help          Show this help

Examples:
  ./install.sh                      Install for Claude Desktop
  ./install.sh -c code              Install for Claude Code (workspace-local)
  ./install.sh -c code --global     Install for Claude Code (global config)
  ./install.sh -c kilo              Install for Kilo Code
  ./install.sh -c opencode          Install for OpenCode (workspace-local)
  ./install.sh -c opencode --global Install for OpenCode (global)
  ./install.sh -c goose             Install for Goose
  ./install.sh -c all               Install for all detected clients
  ./install.sh --upgrade            Upgrade npm deps
  ./install.sh --upgrade -c code    Upgrade + reconfigure Claude Code
  ./install.sh -u                   Uninstall
  ./install.sh -u -c all            Uninstall from all client configs
  ./install.sh -f --skip-test       Force install, skip tests
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--force)          FORCE=true; shift ;;
        -u|--uninstall)      UNINSTALL=true; shift ;;
        --update|--upgrade)  UPDATE=true; shift ;;
        -c|--client)         CLIENT="$2"; CLIENT_EXPLICIT=true; shift 2 ;;
        --global)            GLOBAL_CONFIG=true; shift ;;
        --skip-test)         SKIP_TEST=true; shift ;;
        -h|--help)           show_help ;;
        *) echo "Unknown option: $1"; show_help ;;
    esac
done

# ── Helpers ─────────────────────────────────────────────
info()  { echo "  $*"; }
ok()    { echo "  OK: $*"; }
err()   { echo "  ERROR: $*" >&2; }
die()   { err "$*"; exit 1; }

if [[ "$GLOBAL_CONFIG" == true ]]; then
    case "$CLIENT" in
        code|both|opencode|all) ;;
        *) die "--global is only valid with -c code, opencode, both, or all" ;;
    esac
fi

get_version() {
    # Use grep to avoid Node.js MSYS path resolution issues on Windows
    grep '"version"' "$CEAUTO_DIR/package.json" 2>/dev/null | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' || echo "unknown"
}

get_installed_version() {
    local marker="$CEAUTO_DIR/$MARKER_FILE"
    [[ -f "$marker" ]] && cat "$marker" || echo ""
}

# ── Node.js detection ────────────────────────────────────
find_node() {
    if command -v node &>/dev/null; then
        local ver major
        ver=$(node -e "console.log(process.versions.node)" 2>/dev/null) || return 1
        major=$(echo "$ver" | cut -d. -f1)
        if [[ "$major" -ge 18 ]]; then
            command -v node
            return 0
        fi
    fi
    return 1
}

# ── MCP config paths ─────────────────────────────────────
get_desktop_config_path() {
    case "$(uname -s)" in
        Darwin)
            echo "$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
        Linux)
            if grep -qi microsoft /proc/version 2>/dev/null; then
                local appdata
                appdata=$(cmd.exe /c "echo %APPDATA%" 2>/dev/null | tr -d '\r')
                echo "$appdata/Claude/claude_desktop_config.json"
            else
                echo "$HOME/.config/Claude/claude_desktop_config.json"
            fi ;;
        MINGW*|MSYS*|CYGWIN*)
            echo "$APPDATA/Claude/claude_desktop_config.json" ;;
        *)
            echo "$HOME/.config/Claude/claude_desktop_config.json" ;;
    esac
}

get_code_config_path() {
    echo "$(dirname "$CEAUTO_DIR")/.mcp.json"
}

get_global_code_config_paths() {
    local found=()
    [[ -f "$HOME/.claude.json"     ]] && found+=("$HOME/.claude.json")
    [[ -f "$HOME/.claude/mcp.json" ]] && found+=("$HOME/.claude/mcp.json")
    if [[ ${#found[@]} -eq 0 ]]; then
        found+=("$HOME/.claude.json")
    fi
    printf '%s\n' "${found[@]}"
}

get_kilo_config_path() {
    echo "$(dirname "$CEAUTO_DIR")/.kilocode/mcp.json"
}

get_opencode_config_path() {
    if [[ "$GLOBAL_CONFIG" == true ]]; then
        echo "$HOME/.config/opencode/opencode.json"
    else
        echo "$(dirname "$CEAUTO_DIR")/opencode.json"
    fi
}

get_goose_config_path() {
    echo "$HOME/.config/goose/config.yaml"
}

# ── JSON merge via Node ───────────────────────────────────
merge_mcp_config() {
    local config_path="$1"
    local server_js="$2"

    if [[ -f "$config_path" ]]; then
        cp "$config_path" "${config_path}.backup.$(date +%Y%m%d%H%M%S)"
        info "Backed up existing config"
    fi

    node -e "
const fs = require('fs');
const path = require('path');
const configPath = process.argv[1];
const serverJs = process.argv[2];
let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
config.mcpServers = config.mcpServers || {};
config.mcpServers.ceauto = { command: 'node', args: [serverJs] };
fs.mkdirSync(path.dirname(path.resolve(configPath)), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
" "$config_path" "$server_js"
}

remove_mcp_config() {
    local config_path="$1"
    [[ -f "$config_path" ]] || return 0

    cp "$config_path" "${config_path}.backup.$(date +%Y%m%d%H%M%S)"

    node -e "
const fs = require('fs');
const configPath = process.argv[1];
let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { process.exit(0); }
const servers = config.mcpServers || {};
if ('ceauto' in servers) {
    delete servers.ceauto;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log('  Removed ceauto from config');
} else {
    console.log('  ceauto not found in config');
}
" "$config_path"
}

merge_opencode_config() {
    local config_path="$1"
    local server_js="$2"

    if [[ -f "$config_path" ]]; then
        cp "$config_path" "${config_path}.backup.$(date +%Y%m%d%H%M%S)"
        info "Backed up existing config"
    fi

    node -e "
const fs = require('fs');
const path = require('path');
const configPath = process.argv[1];
const serverJs = process.argv[2];
let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
config.mcp = config.mcp || {};
config.mcp.ceauto = { type: 'local', command: ['node', serverJs] };
fs.mkdirSync(path.dirname(path.resolve(configPath)), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
" "$config_path" "$server_js"
}

remove_opencode_config() {
    local config_path="$1"
    [[ -f "$config_path" ]] || return 0
    cp "$config_path" "${config_path}.backup.$(date +%Y%m%d%H%M%S)"

    node -e "
const fs = require('fs');
const configPath = process.argv[1];
let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { process.exit(0); }
const mcp = config.mcp || {};
if ('ceauto' in mcp) {
    delete mcp.ceauto;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log('  Removed ceauto from config');
} else {
    console.log('  ceauto not found in config');
}
" "$config_path"
}

merge_goose_config() {
    local config_path="$1"
    local server_js="$2"

    if [[ -f "$config_path" ]]; then
        cp "$config_path" "${config_path}.backup.$(date +%Y%m%d%H%M%S)"
        info "Backed up existing config"
    fi

    # Goose uses YAML — use node with js-yaml via NODE_PATH
    NODE_PATH="$CEAUTO_DIR/node_modules" node -e "
const fs = require('fs');
const path = require('path');
const configPath = process.argv[1];
const serverJs = process.argv[2];
let yaml;
try { yaml = require('js-yaml'); } catch {
    console.log('  js-yaml not available. Add manually to ~/.config/goose/config.yaml:');
    console.log('  extensions:');
    console.log('    ceauto:');
    console.log('      name: ceauto');
    console.log('      type: stdio');
    console.log('      cmd: node');
    console.log('      args: [' + serverJs + ']');
    console.log('      enabled: true');
    process.exit(0);
}
let config = {};
try { config = yaml.load(fs.readFileSync(configPath, 'utf8')) || {}; } catch {}
config.extensions = config.extensions || {};
config.extensions.ceauto = { name: 'ceauto', type: 'stdio', cmd: 'node', args: [serverJs], enabled: true };
fs.mkdirSync(path.dirname(path.resolve(configPath)), { recursive: true });
fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: -1 }));
" "$config_path" "$server_js"
}

remove_goose_config() {
    local config_path="$1"
    [[ -f "$config_path" ]] || return 0
    cp "$config_path" "${config_path}.backup.$(date +%Y%m%d%H%M%S)"

    NODE_PATH="$CEAUTO_DIR/node_modules" node -e "
const fs = require('fs');
const configPath = process.argv[1];
let yaml;
try { yaml = require('js-yaml'); } catch {
    console.log('  js-yaml not available, cannot auto-remove from Goose config');
    process.exit(0);
}
let config = {};
try { config = yaml.load(fs.readFileSync(configPath, 'utf8')) || {}; } catch { process.exit(0); }
const ext = config.extensions || {};
if ('ceauto' in ext) {
    delete ext.ceauto;
    fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: -1 }));
    console.log('  Removed ceauto from config');
} else {
    console.log('  ceauto not found in config');
}
" "$config_path"
}

# ── Configure client ─────────────────────────────────────
_configure_one_path() {
    local config_path="$1"
    local server_js="$2"

    info "Config: $config_path"

    if [[ "$UNINSTALL" == true ]]; then
        remove_mcp_config "$config_path"
    else
        if [[ -f "$config_path" ]] && [[ "$FORCE" != true ]]; then
            local current_args
            current_args=$(node -e "
try {
    const c = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    const e = (c.mcpServers || {}).ceauto || {};
    console.log(JSON.stringify(e.args || []));
} catch { console.log('[]'); }
" "$config_path" 2>/dev/null) || current_args="[]"

            if echo "$current_args" | grep -q "$server_js"; then
                info "MCP config already up to date"
                return 0
            elif [[ "$current_args" != "[]" ]]; then
                info "Updating MCP config (server path changed)"
            fi
        fi

        merge_mcp_config "$config_path" "$server_js"
        ok "MCP config updated"
    fi
}

configure_client() {
    local client_type="$1"
    local server_js="$2"

    case "$client_type" in
        desktop)
            info "Client: Claude Desktop"
            _configure_one_path "$(get_desktop_config_path)" "$server_js"
            ;;
        code)
            if [[ "$GLOBAL_CONFIG" == true ]]; then
                info "Client: Claude Code (global)"
                while IFS= read -r config_path; do
                    _configure_one_path "$config_path" "$server_js"
                done < <(get_global_code_config_paths)
            else
                info "Client: Claude Code (workspace)"
                _configure_one_path "$(get_code_config_path)" "$server_js"
            fi
            ;;
        kilo)
            info "Client: Kilo Code"
            _configure_one_path "$(get_kilo_config_path)" "$server_js"
            ;;
        opencode)
            info "Client: OpenCode"
            local opencode_path
            opencode_path="$(get_opencode_config_path)"
            info "Config: $opencode_path"
            if [[ "$UNINSTALL" == true ]]; then
                remove_opencode_config "$opencode_path"
            else
                merge_opencode_config "$opencode_path" "$server_js"
                ok "MCP config updated"
            fi
            ;;
        goose)
            info "Client: Goose"
            local goose_path
            goose_path="$(get_goose_config_path)"
            info "Config: $goose_path"
            if [[ "$UNINSTALL" == true ]]; then
                remove_goose_config "$goose_path"
            else
                merge_goose_config "$goose_path" "$server_js"
                ok "MCP config updated"
            fi
            ;;
        both)
            configure_client "desktop" "$server_js"
            echo ""
            configure_client "code" "$server_js"
            ;;
        all)
            configure_client "desktop" "$server_js"
            echo ""
            configure_client "code" "$server_js"
            local _kilo_path _opencode_ws _opencode_global _goose_path
            _kilo_path="$(get_kilo_config_path)"
            _opencode_ws="$(dirname "$CEAUTO_DIR")/opencode.json"
            _opencode_global="$HOME/.config/opencode/opencode.json"
            _goose_path="$(get_goose_config_path)"
            if [[ "$UNINSTALL" == true ]] || [[ -f "$_kilo_path" ]]; then
                echo ""
                configure_client "kilo" "$server_js"
            fi
            if [[ "$UNINSTALL" == true ]] || [[ -f "$_opencode_ws" ]] || [[ -f "$_opencode_global" ]]; then
                echo ""
                configure_client "opencode" "$server_js"
            fi
            if [[ "$UNINSTALL" == true ]] || [[ -f "$_goose_path" ]]; then
                echo ""
                configure_client "goose" "$server_js"
            fi
            ;;
        *)
            die "Unknown client type: $client_type. Valid: desktop, code, kilo, opencode, goose, both, all"
            ;;
    esac
}

# ── Banner ───────────────────────────────────────────────
VERSION=$(get_version)
INSTALLED_VERSION=$(get_installed_version)
echo ""
echo "  CEAuto v${VERSION}"
if [[ "$UPDATE" == true && -n "$INSTALLED_VERSION" && "$INSTALLED_VERSION" != "$VERSION" ]]; then
    echo "  Upgrading from v${INSTALLED_VERSION}"
fi
if [[ "$UNINSTALL" == true ]]; then
    echo "  Mode: uninstall"
elif [[ "$UPDATE" == true ]]; then
    echo "  Mode: update"
else
    echo "  Mode: install (client: $CLIENT)"
fi
echo "  ─────────────────────────────"
echo ""

SERVER_JS="$CEAUTO_DIR/server.js"

# ── Uninstall ────────────────────────────────────────────
if [[ "$UNINSTALL" == true ]]; then
    configure_client "$CLIENT" ""
    rm -f "$CEAUTO_DIR/$MARKER_FILE"
    info "Removed version marker"
    echo ""
    echo "  CEAuto uninstalled."
    echo ""
    exit 0
fi

# ── Update/Upgrade ────────────────────────────────────────
if [[ "$UPDATE" == true ]]; then
    if [[ -n "$INSTALLED_VERSION" ]]; then
        if [[ "$INSTALLED_VERSION" == "$VERSION" ]]; then
            if [[ "$CLIENT_EXPLICIT" != true && "$FORCE" != true ]]; then
                info "Already at v${VERSION}. Nothing to do."
                info "Use --upgrade -c code|all to also reconfigure MCP client."
                echo ""
                exit 0
            fi
            info "Already at v${VERSION} — reconfiguring MCP client"
        else
            info "Upgrading v${INSTALLED_VERSION} → v${VERSION}"
        fi
    else
        info "No marker found — running full update"
    fi
    echo ""

    info "Upgrading npm dependencies..."
    (cd "$CEAUTO_DIR" && npm install --silent)
    ok "Dependencies upgraded"
    echo ""

    if [[ "$CLIENT_EXPLICIT" == true ]]; then
        info "Reconfiguring MCP client ($CLIENT)..."
        configure_client "$CLIENT" "$SERVER_JS"
        echo ""
    fi

    if [[ "$SKIP_TEST" != true ]]; then
        info "Validating server..."
        if node --check "$SERVER_JS" > /dev/null 2>&1 && \
           node -e "require('./lib/memory'); require('./lib/orchestrator'); require('./tools/index.json');" > /dev/null 2>&1; then
            ok "Server validation passed"
        else
            err "Validation failed. Run 'node --check server.js' for details."
        fi
        echo ""
    fi

    echo "$VERSION" > "$CEAUTO_DIR/$MARKER_FILE"
    ok "Marker updated to v${VERSION}"
    echo "  ─────────────────────────────"
    echo "  CEAuto updated to v${VERSION}!"
    echo ""
    echo "  Restart Claude (quit fully, then reopen) to load changes."
    echo ""
    exit 0
fi

# ── Install ───────────────────────────────────────────────

if [[ -n "$INSTALLED_VERSION" && "$INSTALLED_VERSION" == "$VERSION" && "$FORCE" != true ]]; then
    info "Already at v${VERSION}. Nothing to do."
    info "Use --upgrade to upgrade dependencies, or -f to force reinstall."
    echo ""
    exit 0
fi

# 1. Check Node.js
info "Checking Node.js..."
NODE_BIN=$(find_node) || die "Node.js 18+ is required. Install from https://nodejs.org"
NODE_VER=$(node -e "console.log(process.version)" 2>/dev/null)
ok "Node.js $NODE_VER"
echo ""

# 2. Install npm deps
info "Installing dependencies..."
(cd "$CEAUTO_DIR" && npm install --silent)
ok "Dependencies installed"
echo ""

# 3. Validate server
if [[ "$SKIP_TEST" != true ]]; then
    info "Validating server..."
    if node --check "$SERVER_JS" > /dev/null 2>&1 && \
       (cd "$CEAUTO_DIR" && node -e "require('./lib/memory'); require('./lib/orchestrator'); require('./tools/index.json');") > /dev/null 2>&1; then
        ok "Server validation passed"
    else
        err "Validation failed. Run 'node --check server.js' for details."
        err "Use --skip-test to skip this step."
        exit 1
    fi
    echo ""
fi

# 4. Configure MCP client
info "Configuring MCP client..."
configure_client "$CLIENT" "$SERVER_JS"
echo ""

# 5. Write marker
echo "$VERSION" > "$CEAUTO_DIR/$MARKER_FILE"

# ── Done ─────────────────────────────────────────────────
echo "  ─────────────────────────────"
echo "  CEAuto installed successfully!"
echo ""
echo "  Next steps:"
case "$CLIENT" in
    code)
        echo "  1. Open the workspace in Claude Code"
        echo "  2. Fill in memory/context.md and strategy/goals.md"
        echo "  3. Call ceo_boot to start"
        ;;
    kilo)
        echo "  1. Open the workspace in Kilo Code"
        echo "  2. Fill in memory/context.md and strategy/goals.md"
        echo "  3. Call ceo_boot to start"
        ;;
    opencode|goose)
        echo "  1. Restart the client to load the new MCP server"
        echo "  2. Fill in memory/context.md and strategy/goals.md"
        echo "  3. Call ceo_boot to start"
        ;;
    *)
        echo "  1. Restart Claude Desktop (quit fully, then reopen)"
        echo "  2. Fill in memory/context.md and strategy/goals.md"
        echo "  3. Call ceo_boot to start"
        ;;
esac
echo ""
