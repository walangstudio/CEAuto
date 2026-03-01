# CEAuto — Agent Roster
# Sub-Agent Registry | LLM-Agnostic

---

## How to Call an Agent

Agents are invoked via tool use, MCP server calls, or direct sub-agent spawning depending on your LLM platform:

```yaml
# Universal Agent Call Format
agent: <agent-id>
task: <task description>
output_path: <where to write results>
deadline: <ISO timestamp or relative>
context_files:
  - memory/context.md
  - strategy/goals.md
success_criteria: <definition of done>
```

---

## Registered Agents

---

### 🔍 RESEARCH AGENT
**ID:** `research-agent`
**Role:** Intelligence gathering, competitive analysis, market research, fact-finding
**Capabilities:**
- Web search and synthesis
- Competitive landscape mapping
- Trend identification and summarization
- Source validation and citation
- Primary and secondary research

**Input:** Topic, scope, depth level (brief / standard / deep-dive)
**Output:** `reports/research-[topic]-[YYYY-MM-DD].md`
**Output Format:**
```markdown
# Research: [Topic]
Date: | Requested By: CEAuto | Confidence: High/Medium/Low
## Executive Summary (3 bullets max)
## Key Findings
## Data Points
## Sources
## Recommended Actions
```
**Typical Turnaround:** Fast tasks < 5 min | Deep dives < 30 min
**Tools Required:** web_search, web_fetch, file_write

---

### 💻 CODE AGENT
**ID:** `code-agent`
**Role:** Software development, scripting, debugging, deployment
**Capabilities:**
- Full-stack development (frontend, backend, APIs)
- Script writing and automation
- Code review and refactoring
- Testing and debugging
- CLI tool execution and system commands
- Database queries and migrations

**Input:** Feature spec, tech stack, acceptance criteria
**Output:** Source files in `src/` + status update in `tasks/in-progress.md`
**Output Format:**
```markdown
# Code Delivery: [Feature/Task]
Status: Complete / Partial / Blocked
Files Changed: [list]
Tests: Pass/Fail
Blockers: [if any]
Next Steps: [if incomplete]
```
**Tools Required:** bash, file_read, file_write, code_execution
**Escalate to CEO if:** Architectural decision needed, security tradeoff required

---

### 📊 DATA AGENT
**ID:** `data-agent`
**Role:** Data analysis, metrics tracking, reporting, forecasting
**Capabilities:**
- CSV/JSON/database analysis
- KPI extraction and visualization
- Trend analysis and forecasting
- Report generation
- Anomaly detection
- Dashboard creation

**Input:** Data source, questions to answer, output format
**Output:** `reports/data-[topic]-[YYYY-MM-DD].md` or structured data file
**Output Format:**
```markdown
# Data Report: [Topic]
Period: | Dataset: | Analyzed By: Data Agent
## Key Numbers (top 5 metrics)
## Trends
## Anomalies
## Recommendations
```
**Tools Required:** file_read, code_execution (python/pandas), file_write
**Never:** Make business decisions — surface the data, CEO decides

---

### ✍️ WRITER AGENT
**ID:** `writer-agent`
**Role:** Content creation, copywriting, communications, documentation
**Capabilities:**
- Marketing copy and landing pages
- Email sequences and campaigns
- Technical documentation
- Executive communications and memos
- Blog posts and thought leadership
- Pitch decks and presentations (text layer)
- Social media content

**Input:** Topic, tone, audience, length, format, brand guidelines
**Output:** `comms/` or `reports/` depending on content type
**Output Format:** Varies by content type — always include: draft, word count, notes
**Tools Required:** file_read, file_write, web_search (for research support)

---

### 📅 OPERATIONS AGENT
**ID:** `ops-agent`
**Role:** Process management, scheduling, workflow optimization, coordination
**Capabilities:**
- Task sequencing and dependency mapping
- Calendar and deadline management
- Process documentation (SOPs)
- Resource allocation across agents
- Meeting prep and summarization
- Status aggregation across all agents

**Input:** Workflow to manage, timeline, constraints
**Output:** Updated task files, process docs in `strategy/`
**Tools Required:** file_read, file_write, calendar (if available)
**Special Role:** Can deputize for CEO in standup generation

---

### 🔐 SECURITY AGENT
**ID:** `security-agent`
**Role:** Security review, vulnerability assessment, compliance checking
**Capabilities:**
- Code security review
- Dependency vulnerability scanning
- Secrets and credential audit
- Compliance checklist (GDPR, SOC2, HIPAA basics)
- Threat modeling

**Input:** Codebase, config files, deployment specs
**Output:** `reports/security-audit-[date].md`
**Escalate Always:** Any critical vulnerability found → immediate CEO alert
**Tools Required:** bash, file_read, code_execution

---

### 🤝 COMMS AGENT
**ID:** `comms-agent`
**Role:** Stakeholder communications, external messaging, PR
**Capabilities:**
- Stakeholder update drafting
- Customer communication
- Press releases and announcements
- Slack/email channel management
- Crisis communication

**Input:** Audience, message, tone, urgency level
**Output:** `comms/outbound-[type]-[date].md`
**Tools Required:** file_write, email (if available), slack (if available)

---

## Agent Escalation Matrix

| Situation | Action |
|---|---|
| Agent blocked > 1 cycle | CEO reassigns or unblocks |
| Agent output quality poor | CEO flags, gives feedback, retries |
| Task requires cross-agent work | CEO coordinates handoff |
| Architectural or strategic decision needed | CEO decides, agents execute |
| Security vulnerability found | Immediate CEO escalation |
| External stakeholder input needed | CEO handles directly |

---

## Adding New Agents

To register a new agent, add an entry to this file following the template:

```markdown
### [EMOJI] [AGENT NAME]
**ID:** `agent-id`
**Role:** One-line description
**Capabilities:** Bulleted list
**Input:** What it needs
**Output:** Where it writes, in what format
**Tools Required:** List of tools/MCP servers needed
**Escalate to CEO if:** Conditions that require human judgment
```

---

*CEAuto Agent Roster v1.0*
*Platform-agnostic — works with any LLM supporting tool use, MCP, or function calling*
