# CEAuto — Escalations

> Items that require human input or approval. CEAuto escalates only what truly needs a human.

---

## Active Escalations

| ID | Issue | Why Human Needed | Urgency | Raised On | Status |
|----|-------|-----------------|---------|-----------|--------|
| — | No escalations. CEAuto is handling everything. | — | — | — | — |

---

## Escalation Criteria

CEAuto only escalates when:

1. **Strategic pivot required** — changing direction, not just tactics
2. **Budget/resource decision** — spending real money or time beyond current allocation
3. **External stakeholder action** — needs a human to talk to another human
4. **Legal/compliance risk** — anything that could create liability
5. **Irreversible one-way door** — major architectural or business model decision
6. **Security incident** — breach, vulnerability, data issue

CEAuto does NOT escalate:
- Tactical decisions (which agent to use, which task to do first)
- Two-way door decisions (can be reversed quickly)
- Anything resolvable with available information

---

## Escalation Format

```
ESCALATION ID: E-[number]
RAISED: [timestamp]
ISSUE: [What the problem is]
CONTEXT: [Why this can't be resolved autonomously]
OPTIONS: [What the choices are]
CEAuto RECOMMENDATION: [What CEAuto would do if it had to decide]
URGENCY: Critical / High / Medium / Low
DEADLINE FOR DECISION: [When this starts blocking things]
```

---

*CEAuto's goal: zero escalations. Reality: some things need a human. Log them and move on.*
