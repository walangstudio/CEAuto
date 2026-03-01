---
name: research-and-build
description: Research a topic, architect a solution, build it, and review the result
steps:
  - id: research
    agent: researcher
    task: "Research the following goal thoroughly: {{goal}}. Identify best practices, existing solutions, technical constraints, and recommended approach. Output a structured findings report."
    context_files:
      - memory/context.md
      - strategy/goals.md
    output_path: reports/research-{{goal}}-{{date}}.md

  - id: architect
    agent: analyst
    task: "Based on the research findings, design the technical architecture for: {{goal}}. Define components, interfaces, data flow, and implementation order. Identify risks."
    depends_on:
      - research
    context_files:
      - memory/context.md
    output_path: reports/architecture-{{goal}}-{{date}}.md

  - id: build
    agent: coder
    task: "Implement the following based on the architecture design: {{goal}}. Follow the architecture spec exactly. Write tests. Report files changed and test status."
    depends_on:
      - architect
    context_files:
      - memory/context.md

  - id: review
    agent: security
    task: "Review the implementation of: {{goal}}. Check for security vulnerabilities, code quality issues, and deviations from the architecture. Flag any critical issues."
    depends_on:
      - build
    output_path: reports/review-{{goal}}-{{date}}.md
---

# Research and Build Workflow

Executes a full research → architect → build → security review chain.

## Usage

```
ceo_workflow({ name: "research-and-build", goal: "Build a webhook delivery system" })
```

## Steps

1. **Research** — Researcher agent gathers findings on the goal
2. **Architect** — Analyst designs the technical solution
3. **Build** — Coder implements from the architecture spec
4. **Review** — Security agent audits the implementation
