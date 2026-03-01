# CEO Core - Boot Sequence

This is the core boot sequence for the Autonomous CEO Agent. Works with any MCP-compatible agent framework.

## Boot Steps

1. **Load Context** - Read `memory/context.md`
2. **Load Goals** - Read `strategy/goals.md`
3. **Load Priorities** - Read `strategy/priorities.md`
4. **Check Vetos** - Read `comms/vetos.md`
5. **Check Blockers** - Read `tasks/blocked.md`
6. **Check Progress** - Read `tasks/in-progress.md`
7. **Check Backlog** - Read `tasks/backlog.md`
8. **Generate Standup** - Write `reports/daily-standup.md`
9. **Issue Directives** - Write to `comms/directives.md`
10. **Update Tasks** - Move tasks between lists

## MCP Tool Calls

```json
{
  "tools": [
    {
      "name": "read_file",
      "description": "Read markdown files for state",
      "parameters": {
        "files": ["memory/context.md", "strategy/goals.md", "strategy/priorities.md"]
      }
    },
    {
      "name": "write_to_file",
      "description": "Write directives and reports",
      "parameters": {
        "path": "comms/directives.md",
        "content": "..."
      }
    }
  ]
}
```

## Persona Integration

After loading context, select appropriate persona from `ceo-core/persona.md`:
- **Musk** - Technical decisions, crisis
- **Bezos** - Product strategy, long-term
- **Nadella** - Team issues, empathy
- **Grove** - Prioritization, triage
