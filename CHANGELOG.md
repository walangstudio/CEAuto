# Changelog

## [0.3.0] - 2026-06-04
### Added
- **Executor abstraction (Pillar 1)** — `lib/executors/` with one `execute()` interface and three runtimes:
  - `llm` (default — wraps the provider adapter; behaviour unchanged),
  - `mcp-tool` — run a task by calling a tool on **another MCP server**, so any MCP server becomes an agent runtime,
  - `shell` — run an allowlist-gated command as an agent (task/context on stdin, stdout = result).
- Agent → executor mapping via `config/settings.yaml` `executors:` (default `llm`, `by_agent`, `agent_params`, `shell.allowlist`).
- `docs/ROADMAP.md` — the "similar, but better, not a copy" plan.

### Changed
- The runner resolves an executor per agent instead of calling the LLM adapter directly; budget, approval, veto and self-eval wrap every runtime uniformly.
- Synced version strings (package.json, MCP server, README badge) to 0.3.0.

## [0.2.0] - 2026-06-03
### Added
- Heartbeat autonomy daemon (`bin/ceauto-daemon.js`) + `ceo_run_cycle`.
- Executing runner with atomic task checkout, timeout + bounded retries.
- Budget/cost control with per-agent/session/global caps and auto-pause.
- Governance: approval gates, `comms/vetos.md` hard stop; `ceo_request/resolve/list_approvals`.
- Self-evaluation feedback loop; lifecycle hooks wired; `ceo_metrics`.
- SQLite as source of truth; `tasks/*.md` rendered as a projection.
- Vitest suite (unit + stdio integration + daemon e2e) and Node 20 CI.
- Tools expanded 9 → 15.
