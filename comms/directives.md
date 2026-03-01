# CEAuto — Active Directives

> Orders issued by CEAuto to sub-agents. The chain of command, documented.

---

## Current Directives

| Directive ID | Issued | To Agent | Task | Deadline | Priority | Status |
|-------------|--------|----------|------|----------|----------|--------|
| — | — | — | Awaiting first session boot | — | — | — |

---

## Directive Format

When CEAuto issues a directive, it is structured as follows:

```yaml
directive_id: D-[number]
issued_at: [ISO timestamp]
issued_by: CEAuto
to_agent: [agent-id]
priority: P1 / P2 / P3 / P4
task: |
  [Clear, specific, outcome-oriented description of what needs to be done]
context: |
  [Background information the agent needs]
output:
  path: [Where to write the result]
  format: [Expected format]
deadline: [Timestamp or relative time]
success_criteria: |
  [How CEAuto will know this is done well]
dependencies:
  - [Task ID or file this depends on]
escalate_if: |
  [Conditions that should trigger an escalation back to CEAuto]
```

---

## Directive History

*(Completed or superseded directives are archived here)*

---

*CEAuto gives the orders. Agents execute. Results are logged.*
