# CEAuto — Claude Code Setup

## What This Is

CEAuto is an autonomous CEO agent MCP server. It exposes 9 tools that manage task delegation, decision logging, episodic memory, and multi-agent workflows.

## MCP Server Configuration

Add to your Claude Code MCP config (`~/.claude/mcp.json` or project `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "ceauto": {
      "command": "node",
      "args": ["F:/opt/projs/ai/claude/CEAuto/server.js"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

## First Run

1. `cd CEAuto && npm install`
2. Set `ANTHROPIC_API_KEY` (or other provider key per `config/providers.yaml`)
3. Fill in `memory/context.md` with your project details
4. Fill in `strategy/goals.md` with your OKRs
5. Call `ceo_boot` — CEAuto reads all state and returns a standup

## Available Tools

| Tool | Description |
|------|-------------|
| `ceo_boot` | Boot sequence — reads state, returns standup |
| `ceo_delegate` | Assign task to agent (7 agents available) |
| `ceo_decide` | Log decision with persona + rationale |
| `ceo_generate_standup` | Regenerate standup report |
| `ceo_create_directive` | Issue structured YAML directive |
| `ceo_report_blocker` | Flag blocked task |
| `ceo_complete_task` | Move task to done |
| `ceo_recall` | FTS search across all SQLite memory |
| `ceo_workflow` | Run multi-agent workflow chain |

## Sub-Agents

`researcher`, `coder`, `analyst`, `writer`, `ops`, `security`, `comms`

## Key Files

- `memory/context.md` — project identity (fill in before first use)
- `strategy/goals.md` — OKRs and north star metric
- `strategy/priorities.md` — weekly priority stack
- `ceo-core/persona.md` — 4 executive decision personas
- `config/providers.yaml` — LLM provider config

## Autonomy Rules

CEAuto executes tactical decisions without asking. It only escalates:
- Strategic pivots (one-way doors)
- External communications requiring a human
- Security incidents
- Legal/compliance risks

Human overrides go in `comms/vetos.md`.
