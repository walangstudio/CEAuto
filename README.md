# CEAuto

![version](https://img.shields.io/badge/version-0.1.0-blue)
![node](https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-compatible-blueviolet)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![license](https://img.shields.io/badge/license-MIT-green)

Autonomous CEO agent for Claude via MCP. Delegates tasks to 7 specialist sub-agents, runs YAML-defined workflows, tracks decisions and blockers, and maintains persistent memory across sessions.

## Quick Start

Run the installer:

**Linux / macOS / Git Bash (Windows):**
```bash
cd CEAuto
./install.sh                              # Claude Desktop
./install.sh -c claude                    # Claude Code (workspace-local)
./install.sh -c claude --global           # Claude Code (global user config)
./install.sh -c cursor                    # Cursor (workspace-local)
./install.sh -c cursor --global           # Cursor (global)
./install.sh -c windsurf                  # Windsurf (global only)
./install.sh -c vscode                    # VS Code (.vscode/mcp.json)
./install.sh -c gemini                    # Gemini CLI (workspace-local)
./install.sh -c gemini --global           # Gemini CLI (global)
./install.sh -c codex                     # OpenAI Codex CLI (workspace-local)
./install.sh -c codex --global            # OpenAI Codex CLI (global)
./install.sh -c zed                       # Zed (global)
./install.sh -c kilo                      # Kilo Code
./install.sh -c opencode                  # OpenCode (workspace-local)
./install.sh -c opencode --global         # OpenCode (global)
./install.sh -c goose                     # Goose
./install.sh -c all                       # all detected clients
```

**Windows (Command Prompt / PowerShell):**
```bat
cd CEAuto
install.bat                               REM Claude Desktop
install.bat -c claude                     REM Claude Code (workspace-local)
install.bat -c claude --global            REM Claude Code (global user config)
install.bat -c cursor                     REM Cursor (workspace-local)
install.bat -c cursor --global            REM Cursor (global)
install.bat -c windsurf                   REM Windsurf (global only)
install.bat -c vscode                     REM VS Code (.vscode/mcp.json)
install.bat -c gemini                     REM Gemini CLI (workspace-local)
install.bat -c gemini --global            REM Gemini CLI (global)
install.bat -c codex                      REM OpenAI Codex CLI (workspace-local)
install.bat -c codex --global             REM OpenAI Codex CLI (global)
install.bat -c zed                        REM Zed (global)
install.bat -c kilo                       REM Kilo Code
install.bat -c opencode                   REM OpenCode (workspace-local)
install.bat -c opencode --global          REM OpenCode (global)
install.bat -c goose                      REM Goose
install.bat -c all                        REM all detected clients
```

The installer runs `npm install`, configures your MCP client, and validates the server.

Then restart your client and call:
```
ceo_boot
```

## Supported MCP Clients

| Client | `-c TYPE` | Config written | Notes |
|--------|-----------|----------------|-------|
| Claude Desktop | `claudedesktop` | OS-specific `claude_desktop_config.json` | Restart required |
| Claude Code | `claude` | `.mcp.json` (workspace) or `~/.claude.json` (global) | Use `--global` for user scope |
| Cursor | `cursor` | `.cursor/mcp.json` or `~/.cursor/mcp.json` (global) | Use `--global` for global |
| Windsurf | `windsurf` | `~/.codeium/windsurf/mcp_config.json` | Global only |
| VS Code | `vscode` | `.vscode/mcp.json` | Workspace-local; global via VS Code settings UI |
| Gemini CLI | `gemini` | `.gemini/settings.json` or `~/.gemini/settings.json` (global) | Use `--global` for global |
| Codex CLI | `codex` | `.codex/config.toml` or `~/.codex/config.toml` (global) | TOML; use `--global` for global |
| Zed | `zed` | `~/.config/zed/settings.json` | Global only |
| Kilo Code | `kilo` | `.kilocode/mcp.json` | Workspace-local only |
| OpenCode | `opencode` | `opencode.json` / `~/.config/opencode/opencode.json` | Use `--global` for global |
| Goose | `goose` | `~/.config/goose/config.yaml` | Global only |
| pi.dev | `pidev` | n/a | Prints manual instructions; no auto-config |
| All above | `all` | All detected existing configs | Skips clients not yet installed |

## Installer Flags

```
  -c, --client TYPE   claudedesktop, claude, cursor, windsurf, vscode, gemini, codex,
                      zed, kilo, opencode, goose, pidev, all  (default: claudedesktop)
  -f, --force         Skip prompts, overwrite existing config
  -u, --uninstall     Remove from MCP client config
      --upgrade       Upgrade deps and reconfigure (alias: --update)
      --status        Show where this server is currently installed
      --global        Write to global config (claude, cursor, gemini, codex, opencode)
      --skip-test     Skip server validation
  -h, --help          Show this help
```

### Check install status

```bash
./install.sh --status
```

Scans all known config paths and prints a table showing which clients have CEAuto registered.

### Upgrade

Pull the latest source first (or re-download and extract), then:

```bash
./install.sh --upgrade                    # reinstall deps, rewrite marker
./install.sh --upgrade -c all             # also reconfigure all clients
```

`--update` is an alias for `--upgrade`.

## Manual Setup

```bash
cd CEAuto
npm install
node server.js   # verify it starts, then Ctrl+C
```

Add CEAuto to your MCP client config (use absolute paths):

### Claude Desktop

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ceauto": {
      "command": "node",
      "args": ["/absolute/path/to/CEAuto/server.js"]
    }
  }
}
```

### Claude Code

Workspace-local (`.mcp.json` in your project root):
```json
{
  "mcpServers": {
    "ceauto": {
      "command": "node",
      "args": ["/absolute/path/to/CEAuto/server.js"]
    }
  }
}
```

Global user scope:
```bash
claude mcp add --scope user ceauto -- node /absolute/path/to/CEAuto/server.js
```

### Cursor

`.cursor/mcp.json` (workspace) or `~/.cursor/mcp.json` (global):
```json
{
  "mcpServers": {
    "ceauto": {
      "command": "node",
      "args": ["/absolute/path/to/CEAuto/server.js"]
    }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "ceauto": {
      "command": "node",
      "args": ["/absolute/path/to/CEAuto/server.js"]
    }
  }
}
```

### VS Code

`.vscode/mcp.json` in your workspace root (note: VS Code uses `servers`, not `mcpServers`):
```json
{
  "servers": {
    "ceauto": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/CEAuto/server.js"]
    }
  }
}
```

For user-level config, add via VS Code Settings UI under `mcp.servers`.

### Gemini CLI

`.gemini/settings.json` (workspace) or `~/.gemini/settings.json` (global):
```json
{
  "mcpServers": {
    "ceauto": {
      "command": "node",
      "args": ["/absolute/path/to/CEAuto/server.js"]
    }
  }
}
```

### OpenAI Codex CLI

`.codex/config.toml` (workspace) or `~/.codex/config.toml` (global):
```toml
[mcp_servers.ceauto]
command = "node /absolute/path/to/CEAuto/server.js"
startup_timeout_sec = 30
tool_timeout_sec = 300
enabled = true
```

### Zed

`~/.config/zed/settings.json`:
```json
{
  "context_servers": {
    "ceauto": {
      "command": {
        "path": "node",
        "args": ["/absolute/path/to/CEAuto/server.js"],
        "env": {}
      }
    }
  }
}
```

### Kilo Code

`.kilocode/mcp.json` in your workspace root:
```json
{
  "mcpServers": {
    "ceauto": {
      "command": "node",
      "args": ["/absolute/path/to/CEAuto/server.js"]
    }
  }
}
```

### OpenCode

`opencode.json` (workspace) or `~/.config/opencode/opencode.json` (global):
```json
{
  "mcp": {
    "ceauto": {
      "command": "node",
      "args": ["/absolute/path/to/CEAuto/server.js"]
    }
  }
}
```

### Goose

`~/.config/goose/config.yaml`:
```yaml
extensions:
  ceauto:
    type: stdio
    cmd: node
    args:
      - /absolute/path/to/CEAuto/server.js
    enabled: true
```

### pi.dev

pi.dev does not support MCP servers natively. It uses TypeScript extensions instead. Add a minimal bridge:

```typescript
// ~/.pi/extensions/ceauto-bridge.ts
import { Extension } from "@pi-dev/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export default class CEAutoBridge extends Extension {
  name = "ceauto";

  async activate() {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["/absolute/path/to/CEAuto/server.js"],
    });
    const client = new Client({ name: "ceauto-bridge", version: "1.0.0" }, {});
    await client.connect(transport);
    this.registerMcpClient(client);
  }
}
```

Register in `~/.pi/agent/settings.json`:
```json
{
  "extensions": ["~/.pi/extensions/ceauto-bridge.ts"]
}
```

On Windows, use `C:\absolute\path\to\CEAuto\server.js` with backslashes or forward slashes. Restart the client after editing any config.

## How to Use

After `ceo_boot`, CEAuto loads your context and strategy docs. Use the 9 tools:

| Tool | What it does |
|------|-------------|
| `ceo_boot` | Initialize session, load memory and strategy |
| `ceo_delegate` | Assign a task to a specialist sub-agent |
| `ceo_decide` | Log a decision with rationale |
| `ceo_generate_standup` | Run daily standup across active tasks |
| `ceo_create_directive` | Issue a strategic directive |
| `ceo_report_blocker` | Log and escalate a blocker |
| `ceo_complete_task` | Mark a task complete and capture outcome |
| `ceo_recall` | Semantic search across session memory |
| `ceo_workflow` | Run a multi-step YAML workflow |

## Sub-Agents

7 specialists available via `ceo_delegate`:

| Agent | Handles |
|-------|---------|
| `researcher` | Market research, competitive analysis |
| `coder` | Implementation, debugging, code review |
| `analyst` | Data analysis, metrics, reporting |
| `writer` | Documentation, copy, communications |
| `ops` | Infrastructure, deployment, operations |
| `security` | Security review, threat modeling |
| `comms` | Stakeholder communications, presentations |

## Configuration

Edit `config/providers.yaml` to set your LLM provider:

```yaml
default_provider: anthropic
providers:
  anthropic:
    model: claude-sonnet-4-6
    api_key_env: ANTHROPIC_API_KEY
  openai:
    model: gpt-4o
    api_key_env: OPENAI_API_KEY
```

Fill in `memory/context.md` with your company/project context and `strategy/goals.md` with current goals before calling `ceo_boot`.

## What's Where

```
CEAuto/
├── server.js               # MCP entry point
├── lib/
│   ├── llm-adapter.js      # Anthropic/OpenAI/Google/Ollama abstraction
│   ├── memory.js           # SQLite FTS5 memory store
│   └── orchestrator.js     # YAML workflow engine
├── config/
│   └── providers.yaml      # LLM provider config
├── memory/
│   └── context.md          # Your company/project context (fill this in)
├── strategy/
│   └── goals.md            # Current strategic goals (fill this in)
├── workflows/              # YAML workflow definitions
├── ceo-core/
│   └── system-prompt.md
├── install.sh              # Installer (Linux/macOS/Git Bash)
└── install.bat             # Installer (Windows)
```

## Requirements

- Node.js 18+
- Any MCP client listed above
- `ANTHROPIC_API_KEY` env var (or other provider key per `config/providers.yaml`)

## License

MIT
