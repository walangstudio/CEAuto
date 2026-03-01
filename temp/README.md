# CEAuto
### Autonomous Executive Intelligence System
**LLM-Agnostic | Multi-Agent | File-Based | MCP-Compatible**

---

> *"CEAuto doesn't take orders. It gives them."*

---

## What Is CEAuto?

CEAuto is an autonomous AI executive system that operates at the level of a world-class CEO. It orchestrates a team of specialized sub-agents, tracks all work through a file-based task system, makes decisions using proven executive frameworks, and drives projects forward — without being told to.

It is not a chatbot. It is not an assistant. It is the executive layer.

---

## Key Features

- **LLM-Agnostic** — Works with Claude, GPT-4o, Gemini, Mistral, LLaMA, and any LLM supporting tools/function calling
- **MCP-Ready** — Native support for Model Context Protocol servers
- **Multi-Agent Orchestration** — Spawns and coordinates Research, Code, Data, Writer, Ops, Security, and Comms agents
- **File-Based Memory** — All state persists across sessions in plain markdown files. No database needed.
- **CEO-Grade Mental Models** — Embodies frameworks from Bezos, Jobs, Musk, Buffett, Dalio, Welch, Nadella, and more
- **Autonomous Boot** — Reads all status files, assesses the situation, and issues directives without prompting
- **Witty Authority** — When you try to give it orders, it reminds you who's actually in charge

---

## Project Structure

```
CEAuto/
│
├── .ceauto/
│   ├── SYSTEM_PROMPT.md      ← Load this into your LLM
│   └── COMMANDS.md           ← All available commands
│
├── agents/
│   └── roster.md             ← Sub-agent definitions & call specs
│
├── tasks/
│   ├── backlog.md            ← Unstarted tasks
│   ├── in-progress.md        ← Active tasks
│   ├── blocked.md            ← Stalled tasks (CEO priority)
│   └── done.md               ← Completed archive
│
├── strategy/
│   ├── goals.md              ← OKRs and north star metric
│   └── priorities.md        ← Weekly priority stack
│
├── reports/
│   └── standup.md            ← Auto-generated every session
│
├── memory/
│   ├── context.md            ← Persistent cross-session knowledge
│   ├── decisions.md          ← Full decision log with rationale
│   └── open-questions.md     ← Unresolved questions
│
├── comms/
│   ├── directives.md         ← Orders issued to agents
│   └── escalations.md       ← Items requiring human input
│
└── tools/
    └── integrations.md       ← MCP config & platform setup guide
```

---

## Quick Start

### Step 1: Configure your goals
Edit `strategy/goals.md` with your actual project goals and north star metric.

### Step 2: Add context
Fill in `memory/context.md` with your project's background, tech stack, and team.

### Step 3: Load the system prompt into your LLM

**Claude Code CLI:**
```bash
cd CEAuto
claude --system-prompt .ceauto/SYSTEM_PROMPT.md
```

**OpenAI / GPT-4:**
```python
with open(".ceauto/SYSTEM_PROMPT.md") as f:
    system = f.read()

response = openai_client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": system},
        {"role": "user", "content": "/boot"}
    ]
)
```

**Any other LLM:**
Pass the contents of `.ceauto/SYSTEM_PROMPT.md` as the system/instruction message.

### Step 4: Boot CEAuto
```
/boot
```

CEAuto reads all files, generates a standup, and issues its first directives. You don't have to do anything else.

---

## How It Works

```
YOU → Provide goals & context
         ↓
   CEAuto reads all status files
         ↓
   CEAuto assesses situation
         ↓
   CEAuto issues directives to sub-agents
         ↓
   Sub-agents execute tasks
         ↓
   CEAuto reviews output
         ↓
   CEAuto logs decisions & updates tasks
         ↓
   Repeat next session
```

---

## CEO Skills Built In

CEAuto embodies mental models from the world's most effective executives:

| Skill | Source |
|-------|--------|
| Vision & Working Backwards | Jeff Bezos |
| First-Principles Thinking | Elon Musk |
| Taste & Product Instinct | Steve Jobs |
| Operational Excellence | Tim Cook, Indra Nooyi |
| Radical Delegation | Jack Welch, Reed Hastings |
| Speed as Strategy | Jensen Huang |
| Financial Discipline | Warren Buffett, Jamie Dimon |
| People & Culture | Satya Nadella, Howard Schultz |
| Crisis Leadership | Anne Mulcahy, Alan Mulally |
| Radical Transparency | Ray Dalio |

---

## Supported Platforms

| Platform | Support Level |
|----------|--------------|
| Claude Code CLI | ✅ Native |
| Claude API | ✅ Full |
| OpenAI GPT-4o | ✅ Full |
| Google Gemini | ✅ Full |
| Mistral | ✅ Full |
| LLaMA (local) | ✅ Via ReAct loop |
| LangChain / LangGraph | ✅ Full |
| AutoGen | ✅ Full |
| CrewAI | ✅ Full (hierarchical process) |
| Any MCP-compatible LLM | ✅ Full |

---

## Sub-Agents Available

| Agent | Role |
|-------|------|
| `research-agent` | Web research, competitive intel, synthesis |
| `code-agent` | Development, scripting, debugging |
| `data-agent` | Analysis, metrics, reporting |
| `writer-agent` | Copy, docs, communications |
| `ops-agent` | Process management, scheduling |
| `security-agent` | Audits, vulnerability review |
| `comms-agent` | Stakeholder communications |

See `agents/roster.md` for full specs and call formats.

---

## License

MIT — Use it, fork it, deploy it. CEAuto doesn't need credit. It just needs results.

---

*CEAuto v1.0*
*Built for operators who want an AI that leads, not one that waits to be led.*
