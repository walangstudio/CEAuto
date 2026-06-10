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
const tasks = require('./lib/tasks');
const projection = require('./lib/projection');
const runner = require('./lib/runner');
const approvals = require('./lib/approvals');
const policy = require('./lib/policy');
const budget = require('./lib/budget');
const evaluator = require('./lib/evaluator');
const heartbeat = require('./lib/heartbeat');
const hooksRunner = require('./lib/hooks-runner');
const metrics = require('./lib/metrics');

function fireHook(name, ctx = {}) {
  return hooksRunner.run(name, { workspace: WORKSPACE, ...ctx }, { pkgRoot: PKG_ROOT });
}

function requestApprovalFor(task, reason) {
  approvals.request({ kind: 'budget', ref_id: task.id, summary: reason, detail: { agent: task.agent } });
  approvals.renderApprovals(WORKSPACE);
}

// One dependency set shared by every execution path (delegate execute,
// ceo_run_task, heartbeat) so they behave identically.
function runDeps(extra = {}) {
  return {
    workspace: WORKSPACE,
    pkgRoot: PKG_ROOT,
    sessionId: SESSION_ID,
    settings: loadSettings(),
    requestApproval: requestApprovalFor,
    evaluate: (ctx) => evaluator.selfEval(ctx),
    hooks: fireHook,
    ...extra,
  };
}

const SESSION_ID = `S-${Date.now()}`;

function loadSettings() {
  try {
    const yaml = require('js-yaml');
    return yaml.load(fs.readFileSync(path.join(PKG_ROOT, 'config', 'settings.yaml'), 'utf-8')) || {};
  } catch {
    return {};
  }
}

// PKG_ROOT holds code + specs + templates (always the install dir).
// WORKSPACE holds mutable state (db, tasks, memory, comms, reports) and can be
// redirected via CEAUTO_WORKSPACE so tests and multiple projects stay isolated.
const PKG_ROOT = path.resolve(__dirname);
const WORKSPACE = process.env.CEAUTO_WORKSPACE
  ? path.resolve(process.env.CEAUTO_WORKSPACE)
  : PKG_ROOT;
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

  // Materialise the task tables from SQLite so the standup reflects truth.
  projection.renderTasks(WORKSPACE);

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
  await fireHook('on-boot', { filesLoaded: loaded });

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

  // Register the task in SQLite, then project the markdown tables from it.
  tasks.create({
    id: taskId,
    title: task.title,
    description: task.description || task.title,
    agent,
    status: 'in-progress',
    priority: task.priority || 'P2',
    deadline: task.deadline,
    success_criteria,
    context_files,
    needs_approval: args.needs_approval,
  });
  projection.renderTasks(WORKSPACE);
  await fireHook('on-delegate', { task: { id: taskId, title: task.title }, agent });

  // Log to agent-logs.md
  appendFile('memory/agent-logs.md', `\n## ${nowIso()}\n**Event:** Task Delegated\n**Task:** ${task.title}\n**ID:** ${taskId}\n**Agent:** ${agent}\n**Priority:** ${task.priority || 'P2'}\n`);

  // Create directive
  const date = today();
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

  // Approval-first: only invoke the LLM when explicitly asked to execute.
  if (args.execute) {
    const result = await runner.runTask(taskId, runDeps());
    return {
      content: [{
        type: 'text',
        text: `Delegated and executed **${task.title}** (${taskId}) → **${agent}**.\nStatus: ${result.status}${result.reason ? ` — ${result.reason}` : ''}${result.resultPath ? `\nResult: ${result.resultPath}` : ''}`,
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: `Delegated **${task.title}** (${taskId}) to **${agent}**.\nDirective ${directiveId} written to comms/directives.md.\n(Not executed — call ceo_run_task ${taskId} or pass execute:true to run it.)`,
    }],
  };
}

async function handleRunTask(args) {
  const { task_id } = args;
  if (!tasks.get(task_id)) {
    return { content: [{ type: 'text', text: `Task ${task_id} not found.` }], isError: true };
  }
  const result = await runner.runTask(task_id, runDeps());
  const lines = [
    `# Task ${task_id} — ${result.status}`,
    result.reason ? `**Reason:** ${result.reason}` : '',
    result.resultPath ? `**Result:** ${result.resultPath}` : '',
    result.usage ? `**Tokens:** ${result.usage.input_tokens}+${result.usage.output_tokens} (${result.usage.model})` : '',
  ].filter(Boolean);
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function handleDecide(args) {
  const { decision, rationale, persona = 'default', impact = '', decision_type = 'strategic' } = args;
  const date = today();

  const gate = policy.requiresApproval({ decision_type }, loadSettings());
  const refId = `DEC-${Date.now()}`;
  let status = 'In effect';
  let approvalNote = '';
  if (gate.required) {
    status = 'Pending approval';
    approvals.request({ kind: 'decision', ref_id: refId, summary: decision, detail: { rationale, persona, decision_type } });
    approvals.renderApprovals(WORKSPACE);
    approvalNote = `\n⏸️ Gated: ${gate.reason}. Approve with ceo_resolve_approval.`;
  }

  const entry = [
    `\n## ${date} — ${decision_type} (${refId})`,
    `**Decision:** ${decision}`,
    `**Rationale:** ${rationale}`,
    `**Persona:** ${persona}`,
    impact ? `**Impact:** ${impact}` : '',
    `**Status:** ${status}`,
    `**Vetoed:** No`,
    `\n---\n`,
  ].filter(Boolean).join('\n');

  appendFile('memory/decisions.md', entry);
  memory.store('decisions', decision, { rationale, persona, decision_type, impact, date, ref_id: refId, status });
  await fireHook('on-decide', { decision, rationale, persona });

  return {
    content: [{
      type: 'text',
      text: `Decision logged: **${decision}**\nPersona: ${persona} | Type: ${decision_type} | Status: ${status}${approvalNote}`,
    }],
  };
}

async function handleMetrics() {
  const md = metrics.writeReport(WORKSPACE);
  return { content: [{ type: 'text', text: md }] };
}

async function handleRunCycle() {
  const res = await heartbeat.runCycle(runDeps());
  projection.renderTasks(WORKSPACE);
  return {
    content: [{
      type: 'text',
      text: `Heartbeat cycle: ran ${res.ran}, done ${res.done}, blocked ${res.blocked}, vetoed ${res.vetoed}${res.paused ? ' — PAUSED (budget hold)' : ''}`,
    }],
  };
}

async function handleRequestApproval(args) {
  const { kind = 'action', ref_id = '', summary = '', detail = {} } = args;
  const id = approvals.request({ kind, ref_id, summary, detail });
  approvals.renderApprovals(WORKSPACE);
  return { content: [{ type: 'text', text: `Approval #${id} requested (${kind}). Pending human resolution.` }] };
}

async function handleResolveApproval(args) {
  const { id, decision, by = 'human', note = '' } = args;
  const row = approvals.resolve(id, decision, by, note);
  if (!row) {
    return { content: [{ type: 'text', text: `Approval #${id} not found or already resolved.` }], isError: true };
  }
  // Approving a budget hold lifts the autonomous-spend pause.
  if (row.status === 'approved' && row.kind === 'budget') {
    budget.resume();
  }
  approvals.renderApprovals(WORKSPACE);
  return { content: [{ type: 'text', text: `Approval #${id} → ${row.status} by ${by}.` }] };
}

async function handleListApprovals(args) {
  const rows = approvals.list(args.status);
  if (!rows.length) {
    return { content: [{ type: 'text', text: 'No approvals on record.' }] };
  }
  const text = rows
    .map(r => `#${r.id} [${r.status}] ${r.kind} ${r.ref_id || ''} — ${r.summary || ''}`)
    .join('\n');
  return { content: [{ type: 'text', text: `# Approvals\n${text}` }] };
}

async function handleGenerateStandup(args) {
  const date = args.date || today();
  projection.renderTasks(WORKSPACE);
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
  const { task_id, task_title = '', reason, agent = 'Unassigned' } = args;
  const date = today();

  if (!tasks.get(task_id)) {
    tasks.create({ id: task_id, title: task_title || task_id, agent, status: 'backlog' });
  }
  tasks.block(task_id, { reason, agent });
  projection.renderTasks(WORKSPACE);

  appendFile('memory/agent-logs.md', `\n## ${nowIso()}\n**Event:** Task Blocked\n**Task:** ${task_title || task_id}\n**Reason:** ${reason}\n**Agent:** ${agent}\n`);
  memory.store('events', `blocked: ${task_id}`, { reason, agent, date });
  await fireHook('on-blocked', { task: { id: task_id, title: task_title }, reason, agent });

  return {
    content: [{ type: 'text', text: `Task ${task_id} flagged as blocked.\nReason: ${reason}` }],
  };
}

async function handleCompleteTask(args) {
  const { task_id, task_title = '', outcome = 'Done', quality = '⭐⭐⭐⭐', agent = '—', learnings = '' } = args;
  const date = today();

  if (!tasks.get(task_id)) {
    tasks.create({ id: task_id, title: task_title || task_id, agent });
  }
  tasks.complete(task_id, { outcome, quality, learnings, agent });
  projection.renderTasks(WORKSPACE);

  memory.store('events', `completed: ${task_id}`, { outcome, quality, agent, date });
  await fireHook('on-complete', { task: { id: task_id, title: task_title }, outcome, agent });

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
        case 'ceo_run_task':        return await handleRunTask(args);
        case 'ceo_run_cycle':       return await handleRunCycle();
        case 'ceo_metrics':         return await handleMetrics();
        case 'ceo_request_approval': return await handleRequestApproval(args);
        case 'ceo_resolve_approval': return await handleResolveApproval(args);
        case 'ceo_list_approvals':  return await handleListApprovals(args);
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
