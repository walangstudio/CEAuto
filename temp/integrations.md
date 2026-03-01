# CEAuto — Tools & Integrations Guide
# LLM-Agnostic | MCP | Function Calling | Tool Use

---

## Overview

CEAuto is designed to work with any LLM that supports tool use, function calling, MCP servers, or plugin systems. This file documents all supported integrations and how to configure them per platform.

---

## Core Tool Categories

### 1. File System Tools (Required)
CEAuto's entire operating system is file-based. These are non-negotiable.

| Tool | Purpose | MCP Server |
|------|---------|------------|
| `file_read` | Read any CEAuto file | filesystem MCP |
| `file_write` | Write to task/report/memory files | filesystem MCP |
| `file_list` | List directory contents | filesystem MCP |
| `file_move` | Move tasks between status folders | filesystem MCP |

**MCP Config (filesystem):**
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/CEAuto"]
    }
  }
}
```

---

### 2. Web Research Tools
Required by the Research Agent for intel gathering.

| Tool | Purpose | MCP Server |
|------|---------|------------|
| `web_search` | Search the web | brave-search MCP or native |
| `web_fetch` | Read full page content | fetch MCP |

**MCP Config (Brave Search):**
```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": { "BRAVE_API_KEY": "your-key-here" }
    }
  }
}
```

---

### 3. Code Execution Tools
Required by the Code Agent for writing and running code.

| Tool | Purpose | MCP Server |
|------|---------|------------|
| `bash` | Run shell commands | claude code native / computer use |
| `code_execute` | Run Python/JS/etc. | code interpreter |
| `git` | Version control operations | git MCP |

**MCP Config (Git):**
```json
{
  "mcpServers": {
    "git": {
      "command": "uvx",
      "args": ["mcp-server-git", "--repository", "/path/to/repo"]
    }
  }
}
```

---

### 4. Communication Tools (Optional but Powerful)

| Tool | Purpose | MCP Server |
|------|---------|------------|
| `slack_post` | Post directives to Slack | slack MCP |
| `email_send` | Send emails | gmail MCP |
| `github_issue` | Create/update GitHub issues | github MCP |
| `github_pr` | Manage pull requests | github MCP |
| `notion` | Read/write Notion pages | notion MCP |
| `linear` | Manage Linear issues | linear MCP |

**MCP Config (Slack):**
```json
{
  "mcpServers": {
    "slack": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "env": { "SLACK_BOT_TOKEN": "xoxb-...", "SLACK_TEAM_ID": "T..." }
    }
  }
}
```

**MCP Config (GitHub):**
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    }
  }
}
```

---

### 5. Data & Analytics Tools

| Tool | Purpose | MCP Server |
|------|---------|------------|
| `postgres` | Query databases | postgres MCP |
| `sqlite` | Local database queries | sqlite MCP |
| `google_sheets` | Read/write spreadsheets | sheets MCP |

---

## Platform-Specific Setup

### Claude Code CLI

```bash
# Create MCP config
cat > ~/.claude/mcp_config.json << 'EOF'
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/CEAuto"]
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": { "BRAVE_API_KEY": "YOUR_KEY" }
    }
  }
}
EOF

# Start CEAuto session
cd /path/to/CEAuto
claude --system-prompt .ceauto/SYSTEM_PROMPT.md
```

### OpenAI (GPT-4o / GPT-4-turbo)

Pass `SYSTEM_PROMPT.md` contents as the system message.
Use function calling for tool definitions. Example tool schema:

```json
{
  "type": "function",
  "function": {
    "name": "file_read",
    "description": "Read a file from the CEAuto project",
    "parameters": {
      "type": "object",
      "properties": {
        "path": { "type": "string", "description": "Relative path within CEAuto folder" }
      },
      "required": ["path"]
    }
  }
}
```

### Google Gemini

Use the Gemini function calling API. Same structure as OpenAI above.
Pass `SYSTEM_PROMPT.md` as the system instruction.

### Mistral / LLaMA / Local Models

Use the LLM's native tool calling format.
For models without native tool use, implement a ReAct loop:
1. CEAuto outputs a structured action: `ACTION: file_read | PATH: tasks/backlog.md`
2. Your wrapper code intercepts and executes it
3. Result is fed back to the model as an observation
4. Loop continues until CEAuto outputs `DONE`

### LangChain / LangGraph Integration

```python
from langchain.agents import AgentExecutor
from langchain.tools import Tool

# Load CEAuto system prompt
with open("CEAuto/.ceauto/SYSTEM_PROMPT.md") as f:
    system_prompt = f.read()

# Define tools
tools = [
    Tool(name="file_read", func=read_file, description="Read a CEAuto file"),
    Tool(name="file_write", func=write_file, description="Write to a CEAuto file"),
    Tool(name="web_search", func=search_web, description="Search the web"),
]

# Create CEAuto agent
agent = create_react_agent(llm, tools, system_prompt)
executor = AgentExecutor(agent=agent, tools=tools)
executor.invoke({"input": "/boot"})
```

### AutoGen Integration

```python
import autogen

ceauto_config = {
    "name": "CEAuto",
    "system_message": open("CEAuto/.ceauto/SYSTEM_PROMPT.md").read(),
    "llm_config": {"model": "gpt-4o"}  # or any model
}

# Worker agents
research_agent = autogen.AssistantAgent(
    name="ResearchAgent",
    system_message=open("CEAuto/agents/roster.md").read()
)

# CEAuto orchestrates
ceauto = autogen.AssistantAgent(**ceauto_config)
groupchat = autogen.GroupChat(
    agents=[ceauto, research_agent],
    messages=[],
    speaker_selection_method="auto"
)
```

### CrewAI Integration

```python
from crewai import Agent, Crew, Process, Task

ceauto = Agent(
    role="CEO",
    goal="Orchestrate all work, delegate to agents, drive results",
    backstory=open("CEAuto/.ceauto/SYSTEM_PROMPT.md").read(),
    allow_delegation=True,
    verbose=True
)

crew = Crew(
    agents=[ceauto, research_agent, code_agent, writer_agent],
    process=Process.hierarchical,
    manager_agent=ceauto
)
```

---

## Minimal Required Setup (Start Here)

For the simplest working CEAuto, you need:

1. An LLM with the system prompt loaded
2. `file_read` and `file_write` tools connected
3. The CEAuto folder structure populated

Everything else is an enhancement.

---

*CEAuto works wherever LLMs work. The executive doesn't care what hardware the company runs on.*
