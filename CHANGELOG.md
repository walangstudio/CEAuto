# Changelog

## [0.10.0] - 2026-06-06
### Added
- **Read-only local dashboard (Pillar 7, G2)** — `lib/dashboard.js` projects the
  same SQLite state as the markdown (tasks, approvals, org + spend, metrics,
  recent events) at `GET /api/state` (JSON) and a self-refreshing HTML page at
  `GET /`. Served on 127.0.0.1 by `bin/ceauto-dashboard.js` (`npm run dashboard`)
  or by the daemon when `dashboard.enabled`. Pure projection — no writes, no SaaS.
- **Policy-as-code (G2)** — optional `config/policy.yaml` (see
  `config/policy.yaml.example`) of ordered rules: a rule matches on
  `decision_type` / `kind` / `kind_in` / `budget_overage` / `est_cost_usd_over`
  and sets `require_approval` + a `quorum`. First explicit verdict wins; absent /
  no-match falls back to the existing `autonomy.*` gates (behaviour unchanged
  unless you opt in).
- **Multi-approver / quorum governance (G2)** — an approval can require N distinct
  approvers (`approvals.request({ quorum })`); a single reject vetoes. `ceo_decide`
  passes the policy's quorum through; `ceo_list_approvals`, the approvals markdown,
  and the dashboard all show `approvers/quorum`.

### Changed
- `approvals.resolve` records per-approver votes and only flips to `approved` at
  quorum; a repeat vote on a resolved approval is a no-op (returns null), so a
  budget hold can't be resumed twice. `approvals.approverCount(row)` is the single
  vote-counting source for every view.
- Dashboard `esc()` escapes quotes (attribute-safe); the event projection omits
  the raw payload (attacker-controlled for `source.*` events).

## [0.9.0] - 2026-06-06
### Added
- **Reach executors (Pillar 1, G1)** — two new agent runtimes behind the existing
  executor interface; governance/budget/veto wrap them like every other:
  - **`webhook`** (alias `http-webhook`) — POST the task envelope to an external
    worker and await a structured reply. Gated by an outbound-**host allowlist**
    (empty = blocked); redirects are refused (`redirect: 'error'`) so an
    allowlisted endpoint can't 3xx the call to an internal/metadata host (SSRF);
    optional shared secret header; response size-capped.
  - **`claude-code`** — run a coding task via a headless Claude Code subagent
    (`claude -p`, prompt on stdin). **Default-off** (`executors.claude_code.enabled`)
    because it can edit files; parses `{ result, usage }` from JSON output.
  - `lib/executors/spawn-capture.js` — one hardened child-process runner shared by
    `shell` and `claude-code` (single-settle, timeout → SIGTERM then SIGKILL,
    output cap, stderr ring, EOF-on-stdin). `shell` refactored onto it.
- **Reactive sources (Pillar 4, G1)** — feed the task queue from outside the cron
  tick (`lib/sources.js`), all default-off:
  - **file-watch** (chokidar) — a change under a watched path creates a task;
    bursts for the same file are debounced.
  - **inbound webhook** — a local HTTP receiver (`lib/http-server.js`, binds
    127.0.0.1) turns a POST into a task; **requires a secret** (timing-safe check;
    the daemon refuses to start the receiver without one).
  - **`@role` mention** — a webhook body's text routes to the mentioned agent.
  - A requested agent is honored only if it's on the roster; canonical task/agent
    ids can't be overridden by attacker-controlled payload fields.
- `ceo_sources` tool (19th) — read-only status of configured sources + recent
  source-triggered tasks.

### Changed
- The runner threads `webhookAllowlist` + `claude_code` config into executor deps.
- The daemon starts/stops reactive sources (when `sources.enabled`) and its
  shutdown is re-entrancy-guarded.

## [0.8.0] - 2026-06-04
### Added
- **Learning loop (Pillar 6)** — `lib/learning.js`, built on the existing evals +
  memory FTS (no new tables):
  - **Playbooks** — a high-scoring completion (eval ≥ 4) distills a reusable
    `(task-type → approach)` note; the best match is injected as context before a
    similar task runs, so proven approaches propagate.
  - **Post-mortems** — a quality/failure block distills a lesson, recalled before
    similar work, so the org stops repeating mistakes.
  - **Dispatch policy** — success-rate + average score and cost per `(agent, model)`
    from evals joined with the ledger; recommends the cheapest historically-good
    model ("cheapest that works").
- `ceo_insights` tool (18th) — playbook/lesson counts + the per-agent dispatch
  policy table with the recommended model.

### Changed
- The runner injects recalled playbooks/lessons into a task's context before
  dispatch, records a playbook on a high-scoring completion, and a lesson on a
  block — all best-effort (never fail a task over the learning loop).

## [0.7.0] - 2026-06-04
### Added
- **Inter-agent delegation & escalation (Pillar 5)** — an agent's answer may carry
  a fenced `ceauto` directive (`lib/delegation.js`):
  `{ subtasks: [...], escalate: {reason} }`. The `llm` executor surfaces it as
  `{ subtasks, escalate }`.
- On a genuinely-done task, the runner acts on the directive: it spawns child
  tasks (parented via `parent_id`, scheduled by the DAG) **within the acting
  role's `can_delegate_to` authority**, or opens an **escalation** approval up the
  reporting line. Every action is logged to the event bus
  (`task.delegated`/`task.escalated`/`delegation.denied`/`delegation.capped`).
- `tasks.depth()` (delegation depth via the parent chain).
- Settings `autonomy.max_delegation_depth` (3) and `max_subtasks_per_task` (5)
  bound runaway fan-out.

### Notes
- Delegation is acted on only when the task ends `done` (not on an eval requeue),
  so children aren't spawned for work about to be redone.

## [0.6.0] - 2026-06-04
### Added
- **Event bus + deterministic replay/audit (Pillar 4)** — append-only `events`
  table (the autoincrement id is the total order; never updated/deleted).
- `lib/events.js`: `emit()`, `list()/snapshot()`, a **pure `reduce()`** that folds
  the task lifecycle into a derived state snapshot (so state is replayable from
  the log alone), and a cursor-based `drain()` + `subscribe()` for reactive
  processing.
- Task lifecycle events (`task.created/claimed/completed/blocked/requeued`) are
  emitted from `lib/tasks.js` — the single mutation chokepoint, so the log is
  complete regardless of caller. The heartbeat emits `cycle.ran`.
- The heartbeat **drains events each cycle** (cursor-based) and projects them to
  an append-only audit feed `reports/events-feed.md` — the loop is now
  event-driven, not just a cron tick.
- `ceo_audit` tool (17th) — lists recent events and, with `replay:true`,
  re-derives task state from the log and reports replay fidelity vs live (or a
  past snapshot at `uptoId`).

### Notes
- Reactive sources beyond the heartbeat drain (file-watch, inbound webhook,
  `@mention` triggers) are deferred to Pillar G.

## [0.5.0] - 2026-06-04
### Added
- **Org graph + role budgets (Pillar 2)** — `config/org.yaml` models the company
  as a reporting tree of roles; agents bind to a role via `members`.
- `lib/org.js` (pure): role resolution, reporting-line walk, subtree agent
  collection, delegation authority (`can_delegate_to`), and a **budget rollup** —
  an agent's spend counts against its role and every ancestor up to the root, so
  a department envelope bounds the sum of its members and the root bounds the org.
- `ceo_org` tool (16th) — renders the org chart with each role's daily budget and
  today's rolled-up spend.
- `budget.spentByAgents()` for subtree spend aggregation.

### Changed
- The runner now enforces the **role/department budget envelope** before dispatch
  (in addition to per-agent/session/global caps): a department breach blocks the
  task **without** globally pausing, so sibling departments keep working. Executor
  resolution gains a per-role fallback (`role.executor`).

## [0.4.0] - 2026-06-04
### Added
- **Task DAG + dependency-aware scheduler (Pillar 3)** — tasks gain `depends_on`
  (a list of task ids that must be `done` first) and `parent_id` (subtasks).
  `lib/scheduler.js` (pure): `readyOrder()` returns only tasks whose deps are all
  done, ordered by priority then age; `findDeadlocks()` detects unknown deps and
  dependency cycles (Kahn's algorithm).
- `ceo_delegate` accepts `task.depends_on` and `task.parent_id`.
- `tasks.all()` / `tasks.children(parentId)` helpers; additive SQLite migration
  adds the two columns to pre-existing databases.

### Changed
- The heartbeat is now a topological scheduler: it blocks deadlocked tasks
  (unknown dep / cycle) with a clear reason instead of starving them, then drains
  ready tasks and **re-scans readiness after every run**, so a whole dependency
  chain can complete within a single cycle. Per-cycle budget and `maxTasks` caps
  unchanged.

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
