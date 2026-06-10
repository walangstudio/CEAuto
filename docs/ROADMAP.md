# CEAuto Roadmap — "similar, but better, not a copy"

PR #1 gave CEAuto a real autonomy core: heartbeat daemon, executing runner with
atomic checkout, budget caps, approval gates, self-eval, hooks, metrics, 15
tools, SQLite source of truth, 65 tests. This roadmap closes the remaining gaps
to Paperclip **and deliberately overtakes it** on three axes Paperclip doesn't
pursue: MCP-native execution, event-sourced replay/audit, and a learning loop.

## Where we still trail Paperclip

| Capability | Paperclip | CEAuto today | Gap |
|---|---|---|---|
| Agent runtimes | any: Claude Code, Codex, bash, HTTP, custom | raw LLM API only | **large** |
| Org structure | company / roles / reporting / per-role budgets | 7 flat sub-agents | large |
| Inter-agent delegation | agents delegate + escalate | CEO → agent, one hop | large |
| Task graph | dependencies + hierarchy | flat queue (deps only in workflows) | medium |
| Triggers | heartbeat + @mention + events + continuous | cron heartbeat only | medium |
| Agent memory | persistent state across runs | stateless per dispatch | medium |
| UI | React control plane | markdown + MCP | medium |
| IAM / multi-tenant | API keys, memberships | single local | low (by choice) |
| Plugins | plugin contract | hooks only | low |

## Differentiation thesis (why this isn't a clone)

Don't rebuild a SaaS control plane. CEAuto wins by being **MCP-native,
local-first, provider-agnostic, deterministic/replayable, and self-improving.**
Three original bets Paperclip does not make:

1. **MCP-native executors** — any MCP tool/server in the ecosystem becomes an
   agent runtime for free. Paperclip wires bespoke runtime adapters; we make the
   protocol the adapter.
2. **Event-sourced state → deterministic replay & audit.** The org's entire
   history is an append-only event log you can replay to any point. Paperclip
   mutates a control plane; we can prove what happened and re-derive state.
3. **A learning loop.** Self-eval already scores work; we feed that back into
   reusable playbooks and a cheapest-that-works dispatch policy, so the org gets
   better and cheaper over time. Paperclip orchestrates; it does not learn.

---

## Pillar 1 — Executor abstraction (the headline gap) ✅ (Phase A + G1 + composite, shipped)

One interface, many runtimes; governance/budget/veto wrap all of them uniformly.
Shipped: `llm`, `mcp-tool`, `shell` (Phase A); **`webhook`/`http-webhook` and
`claude-code` (G1)** — both gated (host allowlist / default-off) and sharing a
hardened child-process runner (`lib/executors/spawn-capture.js`); **`composite`**
(`lib/executors/composite.js`) — an ordered chain/map of other executors, bounded
to 10 steps with no nesting; the runner scales the budget gate by step count.
**All runtimes done.**

```
// lib/executors/index.js
async function execute(executorId, { agent, task, context, params })
  -> { text, usage:{input_tokens,output_tokens,model,provider}, artifacts? }
```

Built-in executors (each its own `lib/executors/*.js`):
- `llm` — today's `llm-adapter` (refactored behind the interface).
- `mcp-tool` — call another MCP server/tool over stdio/HTTP. **Our superpower:**
  delegate a task to mememo, ChatGipite, or any MCP server as an "agent."
- `shell` — run a sandboxed command, capture stdout/exit; usage = wall/CPU proxy.
- `http-webhook` — POST the task envelope to a URL, await a structured reply
  (lets an external worker/n8n/Zapier be an agent).
- `claude-code` — spawn a Claude Code subagent for coding tasks.
- `composite` — ordered fan to several executors (map/reduce).

Agent definition (`agents.yaml` / `org.yaml`) picks `executor` + `params`. The
runner stops caring *how* a task runs; budget/approval/veto/eval are unchanged.
**Risk:** shell/webhook are the new attack surface → gate both behind
`require_approval_for` + an allowlist; default-off.

## Pillar 2 — Org as a graph ✅ (Phase C, shipped)

`config/org.yaml` → roles in a `reports_to` tree; agents bind via `members`
(`lib/org.js`). Each role carries an optional executor and a **budget envelope
that rolls up**: an agent's spend counts against its role and every ancestor, so
a department cap bounds the sum of its members and the root bounds the org. The
runner enforces it before dispatch (department breach blocks the task, no global
pause). `can_delegate_to` encodes delegation authority (consumed by Pillar 5).
`ceo_org` renders the chart + live spend. **Done.** Single-tenant, file-defined —
no SaaS/IAM. Still open: per-role model tier in dispatch policy (folds into
Pillar 6's cost-aware routing).

## Pillar 3 — Task DAG + dependency-aware scheduler ✅ (Phase B, shipped)

Tasks gain `depends_on` (task-level) and `parent_id` (subtasks). The heartbeat
became a topological scheduler (`lib/scheduler.js`): only run tasks whose deps are
`done`, ordered by priority then age; re-scan readiness after every run so a chain
drains in one cycle; block unknown-dep / cyclic tasks with a reason instead of
starving them. **Done.** The LLM **planner step** that decomposes a big task into
a subtask DAG also shipped (`lib/planner.js`): a `task.plan` task is decomposed
via the agent's `ceauto` directive, and its subtasks — with sibling-title→id
dependency mapping — are scheduled by this DAG. Runtime subtask emission already
works via Pillar 5.

## Pillar 4 — Reactive event bus (beyond cron) ✅ (Phase D, core shipped)

Append-only `events` table + subscriptions (`lib/events.js`). Task lifecycle +
`cycle.ran` events are emitted from the mutation chokepoint, so the log is
complete; the heartbeat drains them each cycle (cursor-based) into an audit feed.
**The payoff is real: state is event-sourced, so a pure `reduce()` rebuilds task
state from the log alone — replay + audit for free** (rebuild any past snapshot
via `ceo_audit replay uptoId`, check fidelity vs live). The "apply twice →
identical" determinism is tested. **Done** for the core. **Reactive sources
shipped in G1** (`lib/sources.js`): file-watch (chokidar, debounced), an inbound
webhook receiver (`lib/http-server.js`, binds 127.0.0.1, secret-required), and
`@role` mention → assign. All default-off and opt-in; they run inside the daemon
and create backlog tasks the scheduler drains.

## Pillar 5 — Inter-agent delegation & escalation ✅ (Phase E, shipped)

Executors return structured `{ text, usage, subtasks?[], escalate? }` (the `llm`
executor parses a fenced `ceauto` directive; `lib/delegation.js`). On a done task
the runner, **within the acting role's `can_delegate_to` authority** (Pillar 2),
creates child tasks parented for the DAG scheduler (Pillar 3) or opens an
escalation approval up the reporting line — all recorded on the event bus
(Pillar 4). **Done.** Runaway fan-out is bounded by `max_delegation_depth` +
`max_subtasks_per_task`. Turns CEO-only fan-out into an org that decomposes and
escalates on its own. The higher-altitude LLM **planner** that pre-decomposes a
big task into a DAG before execution shipped on top of this directive path
(`lib/planner.js`, `task.plan`) — see Pillar 3.

## Pillar 6 — Learning loop (beyond Paperclip) ✅ (Phase F, shipped)

`lib/learning.js`, on the existing evals + memory FTS (no new tables):
- **Playbooks** — a high-scoring completion distills a `(task-type → approach)`
  note; the best match is injected as context before a similar task runs. **Done.**
- **Post-mortems** — a quality/failure block distills a lesson, recalled before
  similar work. **Done.**
- **Dispatch policy** — success-rate + avg score and cost per `(agent, model)`
  from evals ⋈ ledger; recommends the cheapest historically-good `(model,
  provider)`, surfaced via `ceo_insights`. **Done + wired.** With
  `dispatch.auto_route: true` (default-off) the runner routes each task to the
  recommendation (`learning.recommendDispatch`), falling back to the configured
  model when off or under-sampled. A partial route is ignored to avoid a
  cross-provider mismatch. **Epsilon-exploration shipped**
  (`dispatch.explore_epsilon`, default 0): with probability ε the policy
  re-samples an abandoned/under-sampled model (least-sampled routable candidate,
  logged as `dispatch.explored`) so a recovered or newly-cheaper model can be
  rediscovered — the policy no longer only self-corrects downward.

## Pillar 7 — Local dashboard + richer governance ✅ (G2, shipped)

- **Read-only local HTTP status page** (`lib/dashboard.js` + `bin/ceauto-dashboard.js`,
  binds 127.0.0.1) rendering tasks/approvals/org+spend/metrics/events from SQLite.
  Pure projection, like the markdown; served standalone (`npm run dashboard`) or by
  the daemon when `dashboard.enabled`. **Done.**
- **Policy-as-code** (`config/policy.yaml`, optional) — ordered rules → require
  approval + quorum; falls back to the legacy `autonomy.*` gates. **Done.**
- **Multi-approver / quorum** (`approvals.js`) — N distinct approvers; one reject
  vetoes; surfaced everywhere as `approvers/quorum`. **Done.**

---

## Sequencing

| Phase | Pillar | Why first | Risk |
|---|---|---|---|
| A | 1 Executors (llm + mcp-tool + shell) | unlocks everything; mcp-tool is the differentiator | shell sandbox |
| B | 3 Task DAG + scheduler | makes multi-step autonomy real | scheduler correctness |
| C | 2 Org graph + role budgets | structure + departmental spend | budget rollup math |
| D | 4 Event bus + replay | reactive + audit payoff | event-sourcing migration |
| E | 5 Inter-agent delegation | real org behavior | runaway delegation → depth/budget caps |
| F | 6 Learning loop | compounding advantage | eval-signal quality |
| G1 ✅ | 1 (webhook/claude-code) + 4 (reactive sources) | reach | new attack surface — gated, default-off |
| G2 ✅ | 7 dashboard + policy-as-code / quorum governance | polish | read-only projection + governance |

Run A–C as the next milestone (the "real org that runs anything"); D–F as the
"self-improving, replayable org" milestone; G as reach.

## Testing posture (unchanged discipline)

Every executor gets a mock (the `CEAUTO_MOCK_LLM` seam generalizes to
`mockExecute`); the scheduler, budget rollup, event replay, and delegation depth
caps are all unit-testable offline. Keep the stdio JSON-RPC integration tests and
the daemon e2e; add a replay test (apply event log twice → identical state) and a
delegation-depth test (no infinite fan-out). CI stays lint + coverage on Node 20.

## Guardrails carried forward

Executor allowlist + approval gates on shell/webhook; per-role + global budget
with auto-pause; delegation depth + fan-out caps; veto hard-stop; everything
default-off and approval-first. Cost and blast radius are bounded before any new
runtime is enabled.
