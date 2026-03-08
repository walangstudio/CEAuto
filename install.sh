#!/usr/bin/env bash
set -euo pipefail

# ── Config ──────────────────────────────────────────────
MARKER_FILE=".ceauto-installed"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CEAUTO_DIR="$SCRIPT_DIR"
WORKSPACE_DIR="$PWD"
SERVER_NAME="ceauto"

# ── Defaults ────────────────────────────────────────────
FORCE=false
UNINSTALL=false
UPDATE=false
CLIENT="claudedesktop"
SKIP_TEST=false
GLOBAL_CONFIG=false
CLIENT_EXPLICIT=false
STATUS=false

# ── Parse flags ─────────────────────────────────────────
show_help() {
    cat <<EOF
Usage: ./install.sh [options]

Options:
  -c, --client TYPE   claudedesktop, claude, cursor, windsurf, vscode, gemini,
                      codex, zed, kilo, opencode, goose, pidev, all
                      (default: claudedesktop)
  -f, --force         Skip prompts, overwrite existing config
  -u, --uninstall     Remove CEAuto from MCP client config
      --upgrade       Upgrade npm deps and reconfigure
      --update        Alias for --upgrade
      --status        Show where this server is currently installed
      --global        Write to global config path (claude, cursor, gemini, codex,
                      opencode, all)
      --skip-test     Skip server validation
  -h, --help          Show this help

Examples:
  ./install.sh                        Install for Claude Desktop
  ./install.sh -c claude              Install for Claude Code (workspace)
  ./install.sh -c claude --global     Install for Claude Code (global)
  ./install.sh -c cursor              Install for Cursor (workspace)
  ./install.sh -c cursor --global     Install for Cursor (global)
  ./install.sh -c windsurf            Install for Windsurf
  ./install.sh -c vscode              Install for VS Code (workspace .vscode/mcp.json)
  ./install.sh -c gemini              Install for Gemini CLI (workspace)
  ./install.sh -c codex               Install for OpenAI Codex CLI (workspace)
  ./install.sh -c zed                 Install for Zed (global)
  ./install.sh -c all                 Install for all detected clients
  ./install.sh --status               Show installation status
  ./install.sh --upgrade              Upgrade npm deps
  ./install.sh --upgrade -c all       Upgrade + reconfigure all clients
  ./install.sh -u                     Uninstall
  ./install.sh -u -c all              Uninstall from all client configs
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--force)          FORCE=true; shift ;;
        -u|--uninstall)      UNINSTALL=true; shift ;;
        --update|--upgrade)  UPDATE=true; shift ;;
        --status)            STATUS=true; shift ;;
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

if [[ "$UNINSTALL" == true && "$CLIENT_EXPLICIT" == false ]]; then
    CLIENT="all"
fi

if [[ "$GLOBAL_CONFIG" == true ]]; then
    case "$CLIENT" in
        claude|cursor|gemini|codex|opencode|both|all) ;;
        *) die "--global is only valid with -c claude, cursor, gemini, codex, opencode, or all" ;;
    esac
fi

get_version() {
    grep '"version"' "$CEAUTO_DIR/package.json" 2>/dev/null | head -1 \
        | sed 's/.*"version": *"\([^"]*\)".*/\1/' || echo "unknown"
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
    echo "$WORKSPACE_DIR/.mcp.json"
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

get_cursor_config_path() {
    if [[ "$GLOBAL_CONFIG" == true ]]; then
        echo "$HOME/.cursor/mcp.json"
    else
        echo "$WORKSPACE_DIR/.cursor/mcp.json"
    fi
}

get_windsurf_config_path() {
    echo "$HOME/.codeium/windsurf/mcp_config.json"
}

get_vscode_config_path() {
    echo "$WORKSPACE_DIR/.vscode/mcp.json"
}

get_gemini_config_path() {
    if [[ "$GLOBAL_CONFIG" == true ]]; then
        echo "$HOME/.gemini/settings.json"
    else
        echo "$WORKSPACE_DIR/.gemini/settings.json"
    fi
}

get_codex_config_path() {
    if [[ "$GLOBAL_CONFIG" == true ]]; then
        echo "$HOME/.codex/config.toml"
    else
        echo "$WORKSPACE_DIR/.codex/config.toml"
    fi
}

get_zed_config_path() {
    echo "$HOME/.config/zed/settings.json"
}

get_kilo_config_path() {
    echo "$WORKSPACE_DIR/.kilocode/mcp.json"
}

get_opencode_config_path() {
    if [[ "$GLOBAL_CONFIG" == true ]]; then
        echo "$HOME/.config/opencode/opencode.json"
    else
        echo "$WORKSPACE_DIR/opencode.json"
    fi
}

get_goose_config_path() {
    echo "$HOME/.config/goose/config.yaml"
}

# ── JSON merge (mcpServers key) via Node ──────────────────
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
config.mcpServers['$SERVER_NAME'] = { command: 'node', args: [serverJs] };
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
if ('$SERVER_NAME' in servers) {
    delete servers['$SERVER_NAME'];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log('  Removed $SERVER_NAME from config');
} else {
    console.log('  $SERVER_NAME not found in config');
}
" "$config_path"
}

# ── JSON merge (servers key) for VS Code ──────────────────
merge_vscode_config() {
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
config.servers = config.servers || {};
config.servers['$SERVER_NAME'] = { type: 'stdio', command: 'node', args: [serverJs] };
fs.mkdirSync(path.dirname(path.resolve(configPath)), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
" "$config_path" "$server_js"
}

remove_vscode_config() {
    local config_path="$1"
    [[ -f "$config_path" ]] || return 0

    cp "$config_path" "${config_path}.backup.$(date +%Y%m%d%H%M%S)"

    node -e "
const fs = require('fs');
const configPath = process.argv[1];
let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { process.exit(0); }
const servers = config.servers || {};
if ('$SERVER_NAME' in servers) {
    delete servers['$SERVER_NAME'];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log('  Removed $SERVER_NAME from VS Code config');
} else {
    console.log('  $SERVER_NAME not found in VS Code config');
}
" "$config_path"
}

# ── TOML merge for Codex ──────────────────────────────────
merge_codex_config() {
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
const sn = '$SERVER_NAME';
const sectionHeader = '[mcp_servers.' + sn + ']';
const newSection = '\\n' + sectionHeader + '\\ncommand = \"node ' + serverJs + '\"\\nstartup_timeout_sec = 30\\ntool_timeout_sec = 300\\nenabled = true\\n';
fs.mkdirSync(path.dirname(path.resolve(configPath)), { recursive: true });
let existing = '';
try { existing = fs.readFileSync(configPath, 'utf8'); } catch {}
if (existing.includes(sectionHeader)) {
    const lines = existing.split('\\n');
    const startIdx = lines.findIndex(l => l.trim() === sectionHeader);
    if (startIdx !== -1) {
        let endIdx = lines.length;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].match(/^\[/)) { endIdx = i; break; }
        }
        lines.splice(startIdx, endIdx - startIdx);
        existing = lines.join('\\n');
    }
}
existing = existing.trimEnd();
if (existing) existing += '\\n';
fs.writeFileSync(configPath, existing + newSection);
" "$config_path" "$server_js"
}

remove_codex_config() {
    local config_path="$1"
    [[ -f "$config_path" ]] || return 0

    cp "$config_path" "${config_path}.backup.$(date +%Y%m%d%H%M%S)"

    node -e "
const fs = require('fs');
const configPath = process.argv[1];
const sn = '$SERVER_NAME';
const sectionHeader = '[mcp_servers.' + sn + ']';
let existing = '';
try { existing = fs.readFileSync(configPath, 'utf8'); } catch { process.exit(0); }
if (!existing.includes(sectionHeader)) {
    console.log('  $SERVER_NAME not found in codex config');
    process.exit(0);
}
const lines = existing.split('\\n');
const startIdx = lines.findIndex(l => l.trim() === sectionHeader);
if (startIdx !== -1) {
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
        if (lines[i].match(/^\[/)) { endIdx = i; break; }
    }
    lines.splice(startIdx, endIdx - startIdx);
    fs.writeFileSync(configPath, lines.join('\\n'));
    console.log('  Removed $SERVER_NAME from codex config');
}
" "$config_path"
}

# ── JSON merge (context_servers key) for Zed ─────────────
merge_zed_config() {
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
config.context_servers = config.context_servers || {};
config.context_servers['$SERVER_NAME'] = {
    command: { path: 'node', args: [serverJs], env: {} }
};
fs.mkdirSync(path.dirname(path.resolve(configPath)), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
" "$config_path" "$server_js"
}

remove_zed_config() {
    local config_path="$1"
    [[ -f "$config_path" ]] || return 0

    cp "$config_path" "${config_path}.backup.$(date +%Y%m%d%H%M%S)"

    node -e "
const fs = require('fs');
const configPath = process.argv[1];
let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { process.exit(0); }
const cs = config.context_servers || {};
if ('$SERVER_NAME' in cs) {
    delete cs['$SERVER_NAME'];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log('  Removed $SERVER_NAME from Zed config');
} else {
    console.log('  $SERVER_NAME not found in Zed config');
}
" "$config_path"
}

# ── OpenCode JSON merge ───────────────────────────────────
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
config.mcp['$SERVER_NAME'] = { type: 'local', command: ['node', serverJs] };
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
if ('$SERVER_NAME' in mcp) {
    delete mcp['$SERVER_NAME'];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log('  Removed $SERVER_NAME from config');
} else {
    console.log('  $SERVER_NAME not found in config');
}
" "$config_path"
}

# ── Goose YAML merge ──────────────────────────────────────
merge_goose_config() {
    local config_path="$1"
    local server_js="$2"

    if [[ -f "$config_path" ]]; then
        cp "$config_path" "${config_path}.backup.$(date +%Y%m%d%H%M%S)"
        info "Backed up existing config"
    fi

    NODE_PATH="$CEAUTO_DIR/node_modules" node -e "
const fs = require('fs');
const path = require('path');
const configPath = process.argv[1];
const serverJs = process.argv[2];
let yaml;
try { yaml = require('js-yaml'); } catch {
    console.log('  js-yaml not available. Add manually to ~/.config/goose/config.yaml:');
    console.log('  extensions:');
    console.log('    $SERVER_NAME:');
    console.log('      name: $SERVER_NAME');
    console.log('      type: stdio');
    console.log('      cmd: node');
    console.log('      args: [' + serverJs + ']');
    console.log('      enabled: true');
    process.exit(0);
}
let config = {};
try { config = yaml.load(fs.readFileSync(configPath, 'utf8')) || {}; } catch {}
config.extensions = config.extensions || {};
config.extensions['$SERVER_NAME'] = {
    name: '$SERVER_NAME', type: 'stdio', cmd: 'node', args: [serverJs], enabled: true
};
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
if ('$SERVER_NAME' in ext) {
    delete ext['$SERVER_NAME'];
    fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: -1 }));
    console.log('  Removed $SERVER_NAME from config');
} else {
    console.log('  $SERVER_NAME not found in config');
}
" "$config_path"
}

# ── Status helpers ────────────────────────────────────────
_check_in_json() {
    local config_path="$1"
    [[ -f "$config_path" ]] || { echo "NO"; return; }
    grep -q "\"$SERVER_NAME\"" "$config_path" 2>/dev/null && echo "YES" || echo "NO"
}

_check_in_toml() {
    local config_path="$1"
    [[ -f "$config_path" ]] || { echo "NO"; return; }
    grep -q "^\[mcp_servers\.$SERVER_NAME\]" "$config_path" 2>/dev/null && echo "YES" || echo "NO"
}

_check_in_yaml() {
    local config_path="$1"
    [[ -f "$config_path" ]] || { echo "NO"; return; }
    grep -q "  $SERVER_NAME:" "$config_path" 2>/dev/null && echo "YES" || echo "NO"
}

# ── Configure client ─────────────────────────────────────
_configure_one_path() {
    local config_path="$1"
    local server_js="$2"

    if [[ "$UNINSTALL" == true ]]; then
        if [[ "$(_check_in_json "$config_path")" == "YES" ]]; then
            remove_mcp_config "$config_path" > /dev/null 2>&1
            ok "Removed ($config_path)"
        fi
        return
    fi

    info "Config: $config_path"

    if [[ -f "$config_path" ]] && [[ "$FORCE" != true ]]; then
        local current_args
        current_args=$(node -e "
try {
    const c = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    const e = (c.mcpServers || {})['$SERVER_NAME'] || {};
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
}

configure_client() {
    local client_type="$1"
    local server_js="$2"

    case "$client_type" in
        claudedesktop)
            [[ "$UNINSTALL" != true ]] && info "Client: Claude Desktop"
            _configure_one_path "$(get_desktop_config_path)" "$server_js"
            ;;
        claude)
            if [[ "$GLOBAL_CONFIG" == true ]]; then
                [[ "$UNINSTALL" != true ]] && info "Client: Claude Code (global)"
                while IFS= read -r config_path; do
                    _configure_one_path "$config_path" "$server_js"
                done < <(get_global_code_config_paths)
            else
                [[ "$UNINSTALL" != true ]] && info "Client: Claude Code (workspace)"
                _configure_one_path "$(get_code_config_path)" "$server_js"
            fi
            ;;
        cursor)
            local cursor_path; cursor_path="$(get_cursor_config_path)"
            if [[ "$UNINSTALL" == true ]]; then
                if [[ "$(_check_in_json "$cursor_path")" == "YES" ]]; then
                    remove_mcp_config "$cursor_path" > /dev/null 2>&1; ok "Removed from Cursor"; fi
            else
                info "Client: Cursor"; info "Config: $cursor_path"
                merge_mcp_config "$cursor_path" "$server_js"; ok "MCP config updated"
            fi
            ;;
        windsurf)
            local windsurf_path; windsurf_path="$(get_windsurf_config_path)"
            if [[ "$UNINSTALL" == true ]]; then
                if [[ "$(_check_in_json "$windsurf_path")" == "YES" ]]; then
                    remove_mcp_config "$windsurf_path" > /dev/null 2>&1; ok "Removed from Windsurf"; fi
            else
                info "Client: Windsurf (global)"; info "Config: $windsurf_path"
                merge_mcp_config "$windsurf_path" "$server_js"; ok "MCP config updated"
            fi
            ;;
        vscode)
            local vscode_path; vscode_path="$(get_vscode_config_path)"
            if [[ "$UNINSTALL" == true ]]; then
                if [[ "$(_check_in_json "$vscode_path")" == "YES" ]]; then
                    remove_vscode_config "$vscode_path" > /dev/null 2>&1; ok "Removed from VS Code"; fi
            else
                info "Client: VS Code (workspace)"; info "Config: $vscode_path"
                info "Note: for global VS Code config, use the VS Code command palette"
                merge_vscode_config "$vscode_path" "$server_js"; ok "MCP config updated"
            fi
            ;;
        gemini)
            local gemini_path; gemini_path="$(get_gemini_config_path)"
            if [[ "$UNINSTALL" == true ]]; then
                if [[ "$(_check_in_json "$gemini_path")" == "YES" ]]; then
                    remove_mcp_config "$gemini_path" > /dev/null 2>&1; ok "Removed from Gemini CLI"; fi
            else
                info "Client: Gemini CLI"; info "Config: $gemini_path"
                merge_mcp_config "$gemini_path" "$server_js"; ok "MCP config updated"
            fi
            ;;
        codex)
            local codex_path; codex_path="$(get_codex_config_path)"
            if [[ "$UNINSTALL" == true ]]; then
                if [[ "$(_check_in_toml "$codex_path")" == "YES" ]]; then
                    remove_codex_config "$codex_path" > /dev/null 2>&1; ok "Removed from Codex CLI"; fi
            else
                info "Client: OpenAI Codex CLI"; info "Config: $codex_path"
                merge_codex_config "$codex_path" "$server_js"; ok "MCP config updated"
            fi
            ;;
        zed)
            local zed_path; zed_path="$(get_zed_config_path)"
            if [[ "$UNINSTALL" == true ]]; then
                if [[ "$(_check_in_json "$zed_path")" == "YES" ]]; then
                    remove_zed_config "$zed_path" > /dev/null 2>&1; ok "Removed from Zed"; fi
            else
                info "Client: Zed (global)"; info "Config: $zed_path"
                merge_zed_config "$zed_path" "$server_js"; ok "MCP config updated"
            fi
            ;;
        kilo)
            [[ "$UNINSTALL" != true ]] && info "Client: Kilo Code"
            _configure_one_path "$(get_kilo_config_path)" "$server_js"
            ;;
        opencode)
            local opencode_path; opencode_path="$(get_opencode_config_path)"
            if [[ "$UNINSTALL" == true ]]; then
                if [[ "$(_check_in_json "$opencode_path")" == "YES" ]]; then
                    remove_opencode_config "$opencode_path" > /dev/null 2>&1; ok "Removed from OpenCode"; fi
            else
                info "Client: OpenCode"; info "Config: $opencode_path"
                merge_opencode_config "$opencode_path" "$server_js"; ok "MCP config updated"
            fi
            ;;
        goose)
            local goose_path; goose_path="$(get_goose_config_path)"
            if [[ "$UNINSTALL" == true ]]; then
                if [[ "$(_check_in_yaml "$goose_path")" == "YES" ]]; then
                    remove_goose_config "$goose_path" > /dev/null 2>&1; ok "Removed from Goose"; fi
            else
                info "Client: Goose"; info "Config: $goose_path"
                merge_goose_config "$goose_path" "$server_js"; ok "MCP config updated"
            fi
            ;;
        pidev)
            info "Client: pi.dev"
            echo ""
            echo "  pi.dev does not support MCP servers natively."
            echo "  pi.dev uses TypeScript extensions and CLI tools instead."
            echo "  To use CEAuto concepts in pi.dev, see: https://pi.dev/docs/extensions"
            echo ""
            ;;
        both)
            configure_client "claudedesktop" "$server_js"
            echo ""
            configure_client "claude" "$server_js"
            ;;
        all)
            configure_client "claudedesktop" "$server_js"
            echo ""
            configure_client "claude" "$server_js"
            local _ws _gh
            _ws="$WORKSPACE_DIR"
            _gh="$HOME"
            if [[ "$UNINSTALL" == true ]] || [[ -f "$_ws/.cursor/mcp.json" ]] || [[ -f "$_gh/.cursor/mcp.json" ]]; then
                echo ""; configure_client "cursor" "$server_js"
            fi
            if [[ "$UNINSTALL" == true ]] || [[ -f "$_gh/.codeium/windsurf/mcp_config.json" ]]; then
                echo ""; configure_client "windsurf" "$server_js"
            fi
            if [[ "$UNINSTALL" == true ]] || [[ -f "$_ws/.vscode/mcp.json" ]]; then
                echo ""; configure_client "vscode" "$server_js"
            fi
            if [[ "$UNINSTALL" == true ]] || [[ -f "$_ws/.gemini/settings.json" ]] || [[ -f "$_gh/.gemini/settings.json" ]]; then
                echo ""; configure_client "gemini" "$server_js"
            fi
            if [[ "$UNINSTALL" == true ]] || [[ -f "$_ws/.codex/config.toml" ]] || [[ -f "$_gh/.codex/config.toml" ]]; then
                echo ""; configure_client "codex" "$server_js"
            fi
            if [[ "$UNINSTALL" == true ]] || [[ -f "$_gh/.config/zed/settings.json" ]]; then
                echo ""; configure_client "zed" "$server_js"
            fi
            if [[ "$UNINSTALL" == true ]] || [[ -f "$_ws/.kilocode/mcp.json" ]]; then
                echo ""; configure_client "kilo" "$server_js"
            fi
            if [[ "$UNINSTALL" == true ]] || [[ -f "$_ws/opencode.json" ]] || [[ -f "$_gh/.config/opencode/opencode.json" ]]; then
                echo ""; configure_client "opencode" "$server_js"
            fi
            if [[ "$UNINSTALL" == true ]] || [[ -f "$(get_goose_config_path)" ]]; then
                echo ""; configure_client "goose" "$server_js"
            fi
            ;;
        *)
            die "Unknown client: $client_type. Valid: claudedesktop, claude, cursor, windsurf, vscode, gemini, codex, zed, kilo, opencode, goose, pidev, both, all"
            ;;
    esac
}

# ── Show status ───────────────────────────────────────────
show_status() {
    local version installed_version
    version=$(get_version)
    installed_version=$(get_installed_version)
    local _ws _gh
    _ws="$WORKSPACE_DIR"
    _gh="$HOME"

    echo ""
    echo "  CEAuto v${version} — Status"
    echo "  ────────────────────────────────────────────────────────────────────────────"
    printf "  %-30s %-9s %s\n" "Client" "Installed" "Config path"
    echo "  ────────────────────────────────────────────────────────────────────────────"

    _row() {
        local label="$1" status="$2" path="$3"
        if [[ "$status" == "YES" ]]; then
            printf "  %-30s %-9s %s\n" "$label" "YES" "$path"
        else
            printf "  %-30s %s\n" "$label" "NO"
        fi
    }

    local p s
    p="$(get_desktop_config_path)";   s=$(_check_in_json "$p"); _row "claudedesktop" "$s" "$p"
    p="$(get_code_config_path)";      s=$(_check_in_json "$p"); _row "claude (workspace)" "$s" "$p"
    while IFS= read -r gp; do
        s=$(_check_in_json "$gp"); _row "claude (global)" "$s" "$gp"
    done < <(get_global_code_config_paths)
    p="$_ws/.cursor/mcp.json";        s=$(_check_in_json "$p"); _row "cursor (workspace)" "$s" "$p"
    p="$_gh/.cursor/mcp.json";        s=$(_check_in_json "$p"); _row "cursor (global)" "$s" "$p"
    p="$(get_windsurf_config_path)";  s=$(_check_in_json "$p"); _row "windsurf" "$s" "$p"
    p="$(get_vscode_config_path)";    s=$(_check_in_json "$p"); _row "vscode (workspace)" "$s" "$p"
    p="$_ws/.gemini/settings.json";   s=$(_check_in_json "$p"); _row "gemini (workspace)" "$s" "$p"
    p="$_gh/.gemini/settings.json";   s=$(_check_in_json "$p"); _row "gemini (global)" "$s" "$p"
    p="$_ws/.codex/config.toml";      s=$(_check_in_toml "$p"); _row "codex (workspace)" "$s" "$p"
    p="$_gh/.codex/config.toml";      s=$(_check_in_toml "$p"); _row "codex (global)" "$s" "$p"
    p="$(get_zed_config_path)";       s=$(_check_in_json "$p"); _row "zed" "$s" "$p"
    p="$(get_kilo_config_path)";      s=$(_check_in_json "$p"); _row "kilo" "$s" "$p"
    p="$_ws/opencode.json";           s=$(_check_in_json "$p"); _row "opencode (workspace)" "$s" "$p"
    p="$_gh/.config/opencode/opencode.json"; s=$(_check_in_json "$p"); _row "opencode (global)" "$s" "$p"
    p="$(get_goose_config_path)";     s=$(_check_in_yaml "$p"); _row "goose" "$s" "$p"

    echo "  ────────────────────────────────────────────────────────────────────────────"
    if [[ -n "$installed_version" ]]; then
        echo "  Package: v${installed_version} installed"
    else
        echo "  Package: not installed"
    fi
    echo ""
}

# ── Banner ───────────────────────────────────────────────
VERSION=$(get_version)
INSTALLED_VERSION=$(get_installed_version)
echo ""
echo "  CEAuto v${VERSION}"
if [[ "$UPDATE" == true && -n "$INSTALLED_VERSION" && "$INSTALLED_VERSION" != "$VERSION" ]]; then
    echo "  Upgrading from v${INSTALLED_VERSION}"
fi
if [[ "$STATUS" == true ]]; then
    echo "  Mode: status"
elif [[ "$UNINSTALL" == true ]]; then
    echo "  Mode: uninstall"
elif [[ "$UPDATE" == true ]]; then
    echo "  Mode: update"
else
    echo "  Mode: install (client: $CLIENT)"
fi
echo "  ─────────────────────────────"
echo ""

SERVER_JS="$CEAUTO_DIR/server.js"

# ── Status ───────────────────────────────────────────────
if [[ "$STATUS" == true ]]; then
    show_status
    exit 0
fi

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
                info "Use --upgrade -c claude|all to also reconfigure MCP client."
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
           (cd "$CEAUTO_DIR" && node -e "require('./lib/memory'); require('./lib/orchestrator'); require('./tools/index.json');") > /dev/null 2>&1; then
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
    claude|kilo)
        echo "  1. Open the workspace in your editor"
        echo "  2. Fill in memory/context.md and strategy/goals.md"
        echo "  3. Call ceo_boot to start"
        ;;
    cursor|windsurf|vscode|gemini|codex|zed|opencode|goose)
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
