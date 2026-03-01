---
name: product-launch
description: Full product launch sequence — market analysis, messaging, ops plan, stakeholder comms
steps:
  - id: market-analysis
    agent: analyst
    task: "Perform a market analysis for the following launch: {{goal}}. Identify target audience segments, competitive positioning, key differentiators, and success metrics."
    context_files:
      - memory/context.md
      - strategy/goals.md
    output_path: reports/market-analysis-{{date}}.md

  - id: messaging
    agent: writer
    task: "Write launch messaging for: {{goal}}. Based on the market analysis, create: headline, value proposition, 3 key benefits, CTA, and a short launch email. Tone: confident, direct."
    depends_on:
      - market-analysis
    context_files:
      - memory/context.md
    output_path: comms/launch-messaging-{{date}}.md

  - id: ops-plan
    agent: ops
    task: "Create a launch operations plan for: {{goal}}. Include task sequencing, owner assignments (using available agent IDs), milestones, risk flags, and go/no-go criteria."
    depends_on:
      - market-analysis
    context_files:
      - strategy/priorities.md
    output_path: strategy/launch-ops-plan-{{date}}.md

  - id: stakeholder-comms
    agent: comms
    task: "Draft stakeholder communications for the launch of: {{goal}}. Create: (1) internal team announcement, (2) investor update, (3) customer announcement. Tone: professional, exciting."
    depends_on:
      - messaging
      - ops-plan
    context_files:
      - memory/context.md
    output_path: comms/launch-communications-{{date}}.md
---

# Product Launch Workflow

Orchestrates market analysis → messaging → ops planning → stakeholder communications.

## Usage

```
ceo_workflow({ name: "product-launch", goal: "Launch v2.0 of the analytics dashboard" })
```

## Steps

1. **Market Analysis** — Analyst maps competitive landscape and target segments
2. **Messaging** — Writer creates launch copy and email from analysis
3. **Ops Plan** — Ops agent builds the execution timeline
4. **Stakeholder Comms** — Comms agent drafts all launch communications
