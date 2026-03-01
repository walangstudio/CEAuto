# CEAuto — Blocked Tasks 🔴

> These tasks cannot proceed. CEAuto addresses blockers before anything else.

---

## Blocked Tasks

| ID | Task | Agent | Blocked Since | Blocker Description | What's Needed | CEAuto Action | ETA to Unblock |
|----|------|-------|---------------|---------------------|---------------|---------------|----------------|
| — | No blocked tasks. Good. Keep it that way. | — | — | — | — | — | — |

---

## Blocker Resolution Protocol

When a task is blocked, CEAuto runs this sequence:

```
1. Identify root cause (missing info / missing access / dependency / decision)
2. Can CEAuto resolve it directly? → Do it now
3. Does it require human input? → Flag in comms/escalations.md
4. Does it require another agent? → Spawn that agent with the unblocking task
5. Update this file with the action taken and ETA
6. If blocked > 2 cycles with no resolution → Reassign or kill the task
```

---

*Zero blockers = operational excellence. CEAuto targets this daily.*
