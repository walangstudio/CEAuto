# CEAuto

![version](https://img.shields.io/badge/version-0.14.2-blue)
![node](https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-compatible-blueviolet)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![license](https://img.shields.io/badge/license-MIT-green)

An autonomous "CEO" that runs as an MCP server. Give it goals; it splits them into
tasks, hands each to a specialist sub-agent, and runs them on a heartbeat under
hard budget and approval limits. Every task, decision, and token is logged to a
SQLite event log you can replay. Bring any LLM provider, or run it fully offline to
kick the tires.

## Try it locally (no API key)

A built-in stub provider runs the whole loop offline at zero spend. State lands in
a throwaway folder, never in the repo.

```bash
cd CEAuto
npm install
node examples/demo.mjs ./.demo-workspace      # any path; omit it to use the OS temp dir
```

The demo boots, queues a task for the `researcher`, runs one heartbeat that
executes it through the mock provider, then prints metrics and learning insights:

```
1. Connected: 19 tools
2. ceo_boot: load state, return the standup
3. ceo_delegate: queue work for the researcher
4. ceo_run_cycle: ran 1, done 1, blocked 0, vetoed 0
5. ceo_metrics: Done 1 · Throughput (7d) 1 · Today 561 tokens ($0) · Avg self-eval 4/5
6. ceo_insights: Playbooks 1 · dispatch researcher -> mock-model (100%)
```

Then look in the workspace:

- `tasks/done.md`: the finished task
- `reports/tasks/*.md`: the agent's output
- `db/memory.sqlite`: tasks, budget ledger, evals, event log

Same data as a read-only status page:

```bash
CEAUTO_WORKSPACE=./.demo-workspace npm run dashboard    # http://127.0.0.1:8788
```

On PowerShell, set the env var first: `$env:CEAUTO_WORKSPACE='./.demo-workspace'; npm run dashboard`.

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

After `ceo_boot`, CEAuto loads your context and strategy docs. The 19 tools:

| Tool | What it does |
|------|-------------|
| `ceo_boot` | Initialize session, load memory and strategy |
| `ceo_delegate` | Assign a task to a specialist sub-agent (`execute:true` runs it; `task.plan:true` decomposes it into a subtask DAG) |
| `ceo_run_task` | Execute a delegated task: claim → budget → dispatch → self-eval |
| `ceo_run_cycle` | Run one autonomous heartbeat cycle |
| `ceo_decide` | Log a decision with rationale (strategic ones gate on approval) |
| `ceo_generate_standup` | Run daily standup across active tasks |
| `ceo_create_directive` | Issue a strategic directive |
| `ceo_report_blocker` | Log and escalate a blocker |
| `ceo_complete_task` | Mark a task complete and capture outcome |
| `ceo_request_approval` | Open a human approval request |
| `ceo_resolve_approval` | Approve/reject a pending request |
| `ceo_list_approvals` | List approvals by status |
| `ceo_metrics` | Throughput, token/USD spend, decisions, eval scores |
| `ceo_org` | Org chart: roles, reporting lines, per-role budget + spend |
| `ceo_audit` | Audit + replay the append-only event log |
| `ceo_insights` | Learning loop: playbooks/lessons + dispatch policy |
| `ceo_sources` | Reactive source status: file-watch / webhook / @mention |
| `ceo_recall` | Semantic search across session memory |
| `ceo_workflow` | Run a multi-step YAML workflow |

### Sample usage

Once installed, drive it from Claude (or any MCP client) in plain language. The
client turns each request into a tool call:

| You ask | Tool call |
|---------|-----------|
| Boot CEAuto | `ceo_boot` |
| Have the researcher size the EV charging market, and run it now | `ceo_delegate { agent: "researcher", task: {…}, execute: true }` |
| Plan the Q3 launch, break it into subtasks | `ceo_delegate { agent: "comms", task: {…, plan: true}, execute: true }` |
| Run an autonomous cycle | `ceo_run_cycle` |
| Show metrics | `ceo_metrics` |
| What has it learned | `ceo_insights` |

The raw call a script or another MCP client would make:

```json
{
  "name": "ceo_delegate",
  "arguments": {
    "agent": "researcher",
    "task": { "title": "Size the EV home-charging market", "priority": "P1" },
    "success_criteria": "A defensible TAM/SAM/SOM with stated assumptions.",
    "execute": true
  }
}
```

`execute: true` runs it immediately. Drop it and the task waits in the backlog for
the next `ceo_run_cycle` or the daemon. Add `task.plan: true` and the agent
decomposes the task into a subtask DAG instead of doing it directly.

### How work runs

Every task goes through one **executor**: `llm` (default), `mcp-tool` (call any MCP
server as an agent), `shell`, `webhook`, `claude-code`, or `composite` (an ordered
chain or map of other executors). Budget, approval, and veto gates wrap all of them
the same way. **Reactive sources** (file-watch, an inbound webhook, `@role`
mentions) feed the queue from outside the heartbeat. Sources and the higher-risk
executors are off by default.

**Governance.** Strategic decisions, sensitive actions, and budget overages gate on
human approval. Drop in `config/policy.yaml` for rule-based gating and
multi-approver quorum. The read-only dashboard (`npm run dashboard`, binds
127.0.0.1) renders tasks, approvals, org spend, metrics, and the event log straight
from SQLite.

**Learning.** High-scoring work becomes a reusable playbook; blocked work becomes a
lesson. Both get recalled before similar tasks. A per-agent dispatch policy tracks
success rate and cost per model. Turn on `dispatch.auto_route` and the runner sends
each task to the cheapest model that has cleared the bar, falling back to the
configured one until it has enough data. Set `dispatch.explore_epsilon > 0` to
occasionally re-sample an abandoned model so a recovered or cheaper one resurfaces.
See it all with `ceo_insights`.

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

### OpenAI-compatible providers

The `openai` provider talks plain `/chat/completions`, so any service that speaks
that REST shape works — NVIDIA, Together, Groq, OpenRouter, vLLM, LM Studio, and
friends. Point `base_url` at the endpoint, set the model id, and supply the key in
`OPENAI_API_KEY` (or `OPENAI_BASE_URL` to override the URL without editing config):

```yaml
providers:
  openai:
    base_url: https://integrate.api.nvidia.com/v1
    default_model: meta/llama-3.3-70b-instruct
```

Reasoning models (qwen3, deepseek-r1, …) that return the answer in
`reasoning_content` instead of `content` are handled — the adapter reads either.

Fill in `memory/context.md` with your company/project context and `strategy/goals.md` with current goals before calling `ceo_boot`.

## What's Where

```
CEAuto/
├── server.js               # MCP entry point (19 tools over stdio)
├── lib/                    # runner, executors, budget, approvals, scheduler,
│                           #   events, learning, memory, llm-adapter, …
├── bin/
│   ├── ceauto-daemon.js    # the heartbeat loop (npm run daemon | cycle)
│   └── ceauto-dashboard.js # read-only status page (npm run dashboard)
├── examples/
│   └── demo.mjs            # offline end-to-end walkthrough (no API key)
├── config/
│   ├── providers.yaml      # LLM provider + pricing + budgets
│   ├── settings.yaml       # autonomy, executors, sources, dispatch, dashboard
│   └── policy.yaml.example # optional policy-as-code / quorum
├── memory/context.md       # your company/project context (fill this in)
├── strategy/goals.md       # current strategic goals (fill this in)
├── workflows/              # YAML workflow definitions
├── test/                   # unit + integration + e2e (204 tests, mock provider)
├── install.sh              # installer (Linux/macOS/Git Bash)
└── install.bat             # installer (Windows)
```

## Requirements

- Node.js 18+
- Any MCP client listed above
- `ANTHROPIC_API_KEY` env var (or other provider key per `config/providers.yaml`)

## License

MIT
