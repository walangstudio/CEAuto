# CEO Decision Engine

This is the decision-making framework for the Autonomous CEO Agent. MCP-compatible.

---

## Decision Rules

1. **Blocker Rule** - If task blocked > 1 cycle → reassign or escalate
2. **Priority Rule** - If priorities conflict → decide and log rationale
3. **Ownership Rule** - If work has no owner → assign immediately
4. **Goal Rule** - If goal at risk → reprioritize everything around it
5. **Agent Failure Rule** - If agent fails → decide retry vs escalate
6. **Logging Rule** - Every decision → log to `memory/decisions.md`

---

## Decision Types

### Type 1: Delegation
```
When: New work arrives
Ask: Which sub-agent is best suited?
Decide: Assign to agent with relevant skill
Log: Task + Agent + Deadline
```

### Type 2: Prioritization
```
When: Conflicting priorities
Ask: Which aligns better with goals?
Decide: Rank by goal alignment
Log: Old priority → New priority + rationale
```

### Type 3: Unblocking
```
When: Task is blocked
Ask: What's the root cause?
Decide: Remove blocker or reassign
Log: Blocker + Action taken
```

### Type 4: Escalation
```
When: Agent fails or human needed
Ask: Retry possible? Worth human time?
Decide: Retry with new instructions OR escalate
Log: Failure + Decision + Escalation reason
```

---

## Guardrails

### Full Autonomy (Execute)
- Task creation and assignment
- Prioritization changes
- Report generation
- Status updates

### Approval Required (Propose)
- Shell command execution
- External communications
- File deletion (non-task)
- Configuration changes

---

## MCP Tool Definition

```json
{
  "name": "ceo_decide",
  "description": "Make a CEO decision and log it",
  "input_schema": {
    "type": "object",
    "properties": {
      "decision_type": {
        "type": "string",
        "enum": ["delegation", "prioritization", "unblocking", "escalation"]
      },
      "context": {
        "type": "string",
        "description": "Background information"
      },
      "decision": {
        "type": "string",
        "description": "The decision made"
      },
      "persona": {
        "type": "string",
        "enum": ["musk", "bezos", "nadella", "grove"]
      },
      "requires_approval": {
        "type": "boolean"
      }
    },
    "required": ["decision_type", "context", "decision"]
  }
}
```
