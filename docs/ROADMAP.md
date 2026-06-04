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

## Pillar 1 — Executor abstraction (the headline gap)

One interface, many runtimes; governance/budget/veto wrap all of them uniformly.

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

## Pillar 2 — Org as a graph

`org.yaml` → `roles` + `org_edges(reports_to)` tables. Agents bind to roles;
each role carries an executor, a model tier, and a **budget envelope** that rolls
up to the global cap (departmental spend, not just per-agent). Delegation
authority = which roles a role may assign work to. Keeps single-tenant and
file-defined — no SaaS/IAM/membership machinery.

## Pillar 3 — Task DAG + dependency-aware scheduler

Tasks gain `depends_on` (task-level) and `parent_id` (subtasks). The heartbeat
becomes a topological scheduler: only run tasks whose deps are `done`; a task may
emit subtasks; a completion unblocks dependents. A new optional **planner step**
can decompose a big task into a subtask DAG before execution. Deterministic
order; no flat-queue starvation.

## Pillar 4 — Reactive event bus (beyond cron)

Append-only `events` table + subscriptions. Sources: `task.completed` →
enqueue dependents; `@role` mention in a directive → assign; file-watch
(chokidar) on a watched dir; inbound webhook (tiny optional HTTP listener) →
create task. The heartbeat drains events, not just a cron tick; "continuous
agents" = subscriptions. **Because state is event-sourced, we get replay + audit
for free** (Pillar's payoff): rebuild any snapshot, diff two points in time.

## Pillar 5 — Inter-agent delegation & escalation

Executors may return structured `{ result, subtasks?[], escalate? }`. The runner,
within the acting role's delegation authority, creates the child tasks (Pillar 3)
or opens an escalation/approval up the reporting line (Pillar 2). Turns CEO-only
fan-out into a real org that decomposes and escalates on its own.

## Pillar 6 — Learning loop (beyond Paperclip)

- **Playbooks**: distill high-scoring `(task-type → approach)` pairs into reusable
  playbooks (SQLite + FTS); inject the best match as context for similar future
  tasks. Reuses existing `evals` + memory FTS.
- **Dispatch policy**: track success-rate and cost per `(role, task-type, model)`;
  the scheduler prefers the cheapest historically-successful option.
- **Post-mortems**: blocked/failed tasks generate a lesson, recalled before
  retrying a similar task. Closes the eval → improvement loop.

## Pillar 7 — Local dashboard + richer governance (optional)

- Read-only local HTTP status page (no SaaS) rendering org/tasks/approvals/metrics
  from SQLite. Pure projection, like the markdown.
- Policy-as-code (a rules file) + multi-approver / quorum for high-stakes gates.

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
| G | 1 (webhook/claude-code) + 7 dashboard/governance | polish + reach | new attack surface |

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
