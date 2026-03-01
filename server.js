#!/usr/bin/env node
/**
 * CEAuto MCP Server
 * Autonomous CEO Agent — LLM-agnostic, MCP-compatible
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const fs = require('fs');
const path = require('path');
const memory = require('./lib/memory');
const orchestrator = require('./lib/orchestrator');

const WORKSPACE = path.resolve(__dirname);
const TOOLS = require('./tools/index.json');

// ── Utility ──────────────────────────────────────────────────────────────────

function readFile(rel) {
  try {
    return fs.readFileSync(path.join(WORKSPACE, rel), 'utf-8');
  } catch {
    return null;
  }
}

function writeFile(rel, content) {
  const abs = path.join(WORKSPACE, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function appendFile(rel, content) {
  const abs = path.join(WORKSPACE, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  try {
    fs.appendFileSync(abs, content);
  } catch {
    fs.writeFileSync(abs, content);
  }
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function nowIso() {
  return new Date().toISOString();
}

function nextDirectiveId() {
  const directives = readFile('comms/directives.md') || '';
  const matches = directives.match(/D-(\d+)/g) || [];
  const nums = matches.map(m => parseInt(m.replace('D-', ''), 10));
  return `D-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
}

// ── Tool Handlers ─────────────────────────────────────────────────────────────

async function handleBoot() {
  const stateFiles = {
    context: 'memory/context.md',
    goals: 'strategy/goals.md',
    priorities: 'strategy/priorities.md',
    vetos: 'comms/vetos.md',
    blocked: 'tasks/blocked.md',
    inProgress: 'tasks/in-progress.md',
    backlog: 'tasks/backlog.md',
  };

  const state = {};
  for (const [key, rel] of Object.entries(stateFiles)) {
    state[key] = readFile(rel);
  }

  const loaded = Object.values(state).filter(Boolean).length;

  // Pull 7-day SQLite summary
  const recentDecisions = memory.summary(7);

  // Build standup
  const standup = generateStandupContent(state, recentDecisions, today());
  writeFile('reports/standup.md', standup);

  memory.store('events', 'boot', { date: today(), files_loaded: loaded });

  return {
    content: [{
      type: 'text',
      text: [
        `# CEAuto Boot Complete`,
        `**Files loaded:** ${loaded}/${Object.keys(stateFiles).length}`,
        `**Date:** ${today()}`,
        '',
        standup,
      ].join('\n'),
    }],
  };
}

async function handleDelegate(args) {
  const { task, agent, context_files = [], success_criteria = '' } = args;
  const taskId = task.id || `T-${Date.now()}`;
  const date = today();

  // Append to in-progress.md
  const row = `| ${taskId} | ${task.title} | ${agent} | ${date} | ${date} | 🟢 On Track | — | ${task.deadline || 'TBD'} |\n`;
  const existing = readFile('tasks/in-progress.md');
  if (existing) {
    writeFile('tasks/in-progress.md', existing + row);
  } else {
    writeFile('tasks/in-progress.md',
      `# In Progress\n\n| ID | Task | Agent | Started | Last Update | Status | Blocker | Next Checkpoint |\n|----|------|-------|---------|-------------|--------|---------|------------------|\n${row}`
    );
  }

  // Log to agent-logs.md
  appendFile('memory/agent-logs.md', `\n## ${nowIso()}\n**Event:** Task Delegated\n**Task:** ${task.title}\n**ID:** ${taskId}\n**Agent:** ${agent}\n**Priority:** ${task.priority || 'P2'}\n`);

  // Create directive
  const directiveId = nextDirectiveId();
  const directive = [
    `\n## Directive ${directiveId} — ${date}`,
    `\`\`\`yaml`,
    `directive_id: ${directiveId}`,
    `issued_at: ${nowIso()}`,
    `issued_by: CEAuto`,
    `to_agent: ${agent}`,
    `priority: ${task.priority || 'P2'}`,
    `task: |`,
    `  ${task.description || task.title}`,
    context_files.length ? `context_files:\n${context_files.map(f => `  - ${f}`).join('\n')}` : '',
    `deadline: ${task.deadline || 'TBD'}`,
    success_criteria ? `success_criteria: |\n  ${success_criteria}` : '',
    `\`\`\`\n`,
    `---\n`,
  ].filter(Boolean).join('\n');
  appendFile('comms/directives.md', directive);

  // Store in SQLite
  memory.store('directives', `${directiveId}: ${task.title}`, {
    agent, task_id: taskId, priority: task.priority || 'P2', deadline: task.deadline || 'TBD',
  });

  return {
    content: [{
      type: 'text',
      text: `Delegated **${task.title}** (${taskId}) to **${agent}**.\nDirective ${directiveId} written to comms/directives.md.`,
    }],
  };
}

async function handleDecide(args) {
  const { decision, rationale, persona = 'default', impact = '', decision_type = 'strategic' } = args;
  const date = today();

  const entry = [
    `\n## ${date} — ${decision_type}`,
    `**Decision:** ${decision}`,
    `**Rationale:** ${rationale}`,
    `**Persona:** ${persona}`,
    impact ? `**Impact:** ${impact}` : '',
    `**Status:** In effect`,
    `**Vetoed:** No`,
    `\n---\n`,
  ].filter(Boolean).join('\n');

  appendFile('memory/decisions.md', entry);
  memory.store('decisions', decision, { rationale, persona, decision_type, impact, date });

  return {
    content: [{
      type: 'text',
      text: `Decision logged: **${decision}**\nPersona: ${persona} | Type: ${decision_type}`,
    }],
  };
}

async function handleGenerateStandup(args) {
  const date = args.date || today();
  const state = {
    blocked: readFile('tasks/blocked.md'),
    inProgress: readFile('tasks/in-progress.md'),
    backlog: readFile('tasks/backlog.md'),
  };
  const recentDecisions = memory.summary(7);
  const standup = generateStandupContent(state, recentDecisions, date);
  writeFile('reports/standup.md', standup);

  return {
    content: [{ type: 'text', text: standup }],
  };
}

async function handleCreateDirective(args) {
  const {
    agent, task, context = '', output_path = '',
    deadline = 'TBD', priority = 'P2',
    success_criteria = '', escalate_if = '',
  } = args;

  const directiveId = nextDirectiveId();
  const directive = [
    `\n## Directive ${directiveId} — ${today()}`,
    `\`\`\`yaml`,
    `directive_id: ${directiveId}`,
    `issued_at: ${nowIso()}`,
    `issued_by: CEAuto`,
    `to_agent: ${agent}`,
    `priority: ${priority}`,
    `task: |`,
    `  ${task}`,
    context ? `context: |\n  ${context}` : '',
    output_path ? `output:\n  path: ${output_path}` : '',
    `deadline: ${deadline}`,
    success_criteria ? `success_criteria: |\n  ${success_criteria}` : '',
    escalate_if ? `escalate_if: |\n  ${escalate_if}` : '',
    `\`\`\`\n`,
    `---\n`,
  ].filter(Boolean).join('\n');

  appendFile('comms/directives.md', directive);
  memory.store('directives', `${directiveId}: ${task}`, { agent, priority, deadline });

  return {
    content: [{ type: 'text', text: `Directive ${directiveId} created for ${agent}.` }],
  };
}

async function handleReportBlocker(args) {
  const { task_id, task_title = '', reason, agent = 'Unassigned', action_needed = 'CEO to resolve' } = args;
  const date = today();

  const row = `| ${task_id} | ${task_title} | ${agent} | ${date} | ${reason} | ${action_needed} | No |\n`;
  const existing = readFile('tasks/blocked.md');
  if (existing) {
    writeFile('tasks/blocked.md', existing + row);
  } else {
    writeFile('tasks/blocked.md',
      `# Blocked Tasks\n\n| ID | Task | Agent | Blocked Since | Reason | Action Needed | Escalated |\n|----|------|-------|---------------|--------|---------------|-----------|\n${row}`
    );
  }

  appendFile('memory/agent-logs.md', `\n## ${nowIso()}\n**Event:** Task Blocked\n**Task:** ${task_title || task_id}\n**Reason:** ${reason}\n**Agent:** ${agent}\n`);
  memory.store('events', `blocked: ${task_id}`, { reason, agent, date });

  return {
    content: [{ type: 'text', text: `Task ${task_id} flagged as blocked.\nReason: ${reason}` }],
  };
}

async function handleCompleteTask(args) {
  const { task_id, task_title = '', outcome = 'Done', quality = '⭐⭐⭐⭐', agent = '—', learnings = '' } = args;
  const date = today();

  const row = `| ${task_id} | ${task_title} | ${agent} | ${date} | ${outcome} | ${quality} | ${learnings} |\n`;
  const existing = readFile('tasks/done.md');
  if (existing) {
    writeFile('tasks/done.md', existing + row);
  } else {
    writeFile('tasks/done.md',
      `# Completed\n\n| ID | Task | Agent | Completed | Outcome | Quality | Learnings |\n|----|------|-------|-----------|---------|---------|-----------|\n${row}`
    );
  }

  // Remove from in-progress
  const inProgress = readFile('tasks/in-progress.md');
  if (inProgress) {
    const lines = inProgress.split('\n').filter(line => !line.includes(`| ${task_id} |`));
    writeFile('tasks/in-progress.md', lines.join('\n'));
  }

  memory.store('events', `completed: ${task_id}`, { outcome, quality, agent, date });

  return {
    content: [{ type: 'text', text: `Task ${task_id} completed. Quality: ${quality}\nOutcome: ${outcome}` }],
  };
}

async function handleRecall(args) {
  const { query, limit = 10, type = 'all' } = args;
  const results = memory.recall(query, limit, type === 'all' ? null : type);

  if (!results.length) {
    return { content: [{ type: 'text', text: `No results found for: "${query}"` }] };
  }

  const formatted = results.map((r, i) =>
    `### ${i + 1}. [${r.type}] ${r.content.substring(0, 120)}...\n*${r.created_at}*`
  ).join('\n\n');

  return {
    content: [{
      type: 'text',
      text: `# Recall: "${query}"\n**${results.length} result(s)**\n\n${formatted}`,
    }],
  };
}

async function handleWorkflow(args) {
  const { name, goal, params = {} } = args;
  const result = await orchestrator.run(name, goal, params, WORKSPACE, memory);
  return {
    content: [{
      type: 'text',
      text: result,
    }],
  };
}

// ── Standup Generator ─────────────────────────────────────────────────────────

function generateStandupContent(state, recentDecisions, date) {
  const blocked = state.blocked || 'No blocked tasks.';
  const inProgress = state.inProgress || 'No tasks in progress.';
  const backlog = state.backlog || 'No backlog.';

  const blockedCount = (blocked.match(/\| T/g) || []).length;
  const inProgressCount = (inProgress.match(/\| T/g) || []).length;
  const backlogCount = (backlog.match(/\| T/g) || []).length;

  return [
    `# CEAuto — Daily Standup`,
    `**Date:** ${date} | **Generated:** ${nowIso()}`,
    '',
    `## Situation Assessment`,
    `${inProgressCount} task(s) in flight, ${blockedCount} blocked, ${backlogCount} in backlog.`,
    '',
    `## Momentum Report`,
    '',
    `### 🟢 In Progress`,
    inProgress,
    '',
    `### 🔴 Blockers`,
    blocked,
    '',
    `### 📋 Backlog`,
    backlog,
    '',
    recentDecisions ? `## Recent Decisions (7 days)\n${recentDecisions}` : '',
    '',
    `---`,
    `*CEAuto standup complete. Agents have their orders.*`,
  ].filter(s => s !== undefined).join('\n');
}

// ── MCP Server ─────────────────────────────────────────────────────────────────

async function main() {
  // Init SQLite memory
  memory.init(path.join(WORKSPACE, 'db', 'memory.sqlite'));

  const server = new Server(
    { name: 'ceauto', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case 'ceo_boot':            return await handleBoot();
        case 'ceo_delegate':        return await handleDelegate(args);
        case 'ceo_decide':          return await handleDecide(args);
        case 'ceo_generate_standup': return await handleGenerateStandup(args);
        case 'ceo_create_directive': return await handleCreateDirective(args);
        case 'ceo_report_blocker':  return await handleReportBlocker(args);
        case 'ceo_complete_task':   return await handleCompleteTask(args);
        case 'ceo_recall':          return await handleRecall(args);
        case 'ceo_workflow':        return await handleWorkflow(args);
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error in ${name}: ${err.message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('CEAuto MCP server running\n');
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
