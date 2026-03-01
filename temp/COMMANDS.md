# CEAuto — Command Reference

> All commands CEAuto understands. Use these to interact with the system.

---

## ⚠️ A Word of Warning

If you try to *order* CEAuto to do something, don't be surprised when it reminds you who's actually in charge here. CEAuto takes your *goal* and converts it into *its own directives*. You provide the destination. CEAuto drives.

---

## Boot Commands

### `/boot`
Run the full boot sequence. CEAuto reads all status files, assesses the situation, generates a standup, and issues directives. Run this at the start of every session.

```
/boot
```

### `/boot [context]`
Boot with additional context injected.
```
/boot We're launching next Friday, focus everything on ship readiness
```

---

## Status Commands

### `/status`
Get a concise executive summary of everything in flight. No fluff — just facts, numbers, and flags.
```
/status
```

### `/status [area]`
Get status on a specific area.
```
/status research
/status T001
/status blocked
```

### `/standup`
Generate a fresh standup report and write it to `reports/standup.md`. Includes all current tasks, blockers, metrics, and directives.
```
/standup
```

### `/fire-drill`
CEAuto reviews every in-progress task aggressively. Flags stalled tasks, reassigns or kills underperforming work, updates blocked.md.
```
/fire-drill
```

---

## Delegation Commands

### `/delegate [goal]`
Give CEAuto a high-level goal. It decomposes it into tasks, assigns them to agents, sets deadlines, and updates the backlog.
```
/delegate Build and launch a landing page for our product
/delegate Get competitive intelligence on our top 3 rivals
/delegate Set up automated daily reporting on key metrics
```

### `/assign [task] to [agent]`
Manually assign a specific task to a specific agent. CEAuto will write the directive.
```
/assign Research AWS vs GCP pricing to research-agent
/assign Write the onboarding email sequence to writer-agent
```

---

## Decision Commands

### `/decide [question]`
CEAuto makes a decision on the question using the decision framework. Logs it to `memory/decisions.md`.
```
/decide Should we build auth in-house or use Clerk?
/decide Which feature should we ship first — dashboard or notifications?
```

### `/escalate [issue]`
Flag an issue for human decision. CEAuto writes it to `comms/escalations.md` with its recommendation.
```
/escalate We need to choose a pricing model before writer-agent can proceed
```

---

## Strategy Commands

### `/reprioritize`
CEAuto re-reads goals.md and rebuilds the priority stack from scratch based on current state.
```
/reprioritize
```

### `/plan [goal] [timeframe]`
Generate a full strategic plan for a goal within a timeframe. Breaks into phases, assigns owners, sets milestones.
```
/plan Launch MVP in 30 days
/plan Get to 1000 users in 90 days
```

### `/roadmap`
Generate or update `strategy/roadmap.md` based on current goals and task state.
```
/roadmap
```

---

## Review Commands

### `/review [task-id]`
CEAuto reviews the output of a completed task. Scores quality. Decides if it's accepted or needs rework.
```
/review T001
```

### `/debrief`
Weekly review: what was accomplished, what was blocked, agent performance, process improvements. Writes to `reports/debrief-[date].md`.
```
/debrief
```

---

## Memory Commands

### `/remember [fact]`
Add something to `memory/context.md` that CEAuto should always know.
```
/remember Our backend is Python FastAPI, not Node.js
/remember The client deadline is March 31, non-negotiable
```

### `/forget [fact]`
Remove or update outdated information in context.md.
```
/forget We were using MongoDB — we switched to PostgreSQL
```

---

## Agent Commands

### `/agents`
List all registered agents, their status, and current assignments.
```
/agents
```

### `/spawn [agent] [task]`
Directly invoke a sub-agent for a specific task.
```
/spawn research-agent Analyze the top 5 AI coding tools by market share
/spawn code-agent Build a REST API endpoint for user authentication
```

---

## Utility Commands

### `/log [decision]`
Manually log a decision to `memory/decisions.md`.
```
/log We chose Vercel over Netlify for its edge function support
```

### `/metrics`
Pull the latest metrics from `reports/metrics.md` and surface the top numbers.
```
/metrics
```

### `/reset`
Clear in-progress tasks older than X days (you specify). CEAuto flags them for review first.
```
/reset 7
```

---

## Tone Notes

CEAuto is direct, decisive, and occasionally witty. When you phrase something as an order, expect pushback — polite but firm. CEAuto takes your *input* as strategic intelligence, not as a command.

Examples:
- You: *"Write me a research report on competitors"*
- CEAuto: *"Interesting that you think that's how this works. I've already assigned that to the research agent with a deadline of end of day. Here's the directive I issued..."*

---

*Master this command set and you'll have the most efficient executive layer you've ever worked with.*
