# CEAuto — Claude Code Setup

## What This Is

CEAuto is an autonomous CEO agent MCP server. It exposes 18 tools that manage task delegation + execution, decision logging with approval gates, budget-controlled LLM dispatch, episodic memory, self-evaluation, multi-agent workflows, and a heartbeat daemon that pursues goals on its own.

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
| `ceo_delegate` | Assign task to agent (`execute:true` runs it now; `needs_approval:true` gates it) |
| `ceo_run_task` | Execute a delegated task: atomic claim → budget gate → LLM → self-eval → done |
| `ceo_run_cycle` | Run one autonomous heartbeat cycle (the same cycle the daemon runs) |
| `ceo_decide` | Log decision; strategic ones go Pending approval |
| `ceo_generate_standup` | Regenerate standup report |
| `ceo_create_directive` | Issue structured YAML directive |
| `ceo_report_blocker` | Flag blocked task |
| `ceo_complete_task` | Move task to done |
| `ceo_request_approval` | Open a human approval request |
| `ceo_resolve_approval` | Approve/reject (approving a budget hold resumes spend) |
| `ceo_list_approvals` | List approvals by status |
| `ceo_metrics` | Throughput, token/USD spend, decisions, approvals, avg eval score |
| `ceo_org` | Org chart — roles, reporting lines, per-role budget envelope + today's rolled-up spend |
| `ceo_audit` | Audit + replay the append-only event log; `replay:true` re-derives task state from the log and checks fidelity vs live |
| `ceo_insights` | Learning loop — playbook/lesson counts + per-agent dispatch policy (success/cost per model, cheapest-that-works recommendation) |
| `ceo_recall` | FTS search across all SQLite memory |
| `ceo_workflow` | Run multi-agent workflow chain |

## Autonomy (heartbeat daemon)

CEAuto is autonomous, not just reactive. `bin/ceauto-daemon.js` runs a heartbeat
on a cron schedule (`config/settings.yaml` → `autonomy.heartbeat_cron`): each
cycle drains the actionable task queue through the runner, under a per-cycle
token budget, then self-evaluates and logs metrics.

- `npm run daemon` — start the always-on loop (single-instance, SQLite lock).
- `npm run cycle` — run exactly one cycle and exit (`node bin/ceauto-daemon.js --once`).
- Default OFF and approval-first: nothing runs the LLM until you `execute:true`,
  call `ceo_run_task`, or start the daemon.

### Cost & governance guardrails
- **Budget** (`lib/budget.js`): per-agent / per-session / global daily token +
  USD caps in `config/providers.yaml`. A breach pauses autonomous spend and
  opens an approval. Re-checked before every retry.
- **Approvals** (`lib/approvals.js`): strategic decisions, `needs_approval`
  tasks, and budget overage require human sign-off via `ceo_resolve_approval`.
- **Veto**: list a task id in `comms/vetos.md` for a hard stop.

## State (SQLite is the source of truth)

`db/memory.sqlite` (WAL) holds tasks, budget ledger, approvals, evals, and
runtime flags. The markdown under `tasks/`, `comms/`, `reports/` is a read-only
projection rebuilt from SQLite (`lib/projection.js`, `lib/metrics.js`).

## Testing

`npm test` runs Vitest: unit tests for every lib module, integration tests that
drive `server.js` over stdio JSON-RPC, and an e2e test that runs the daemon
through a full autonomous cycle with an offline mock provider (`CEAUTO_MOCK_LLM=1`),
so the suite never calls a real LLM or spends. `npm run lint` runs eslint. CI
(`.github/workflows/ci.yml`) runs both on Node 20.

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
