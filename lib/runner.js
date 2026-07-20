/**
 * runner.js — execute a single delegated task end-to-end.
 *
 * runTask(): claim (atomic) -> budget gate -> dispatch (timeout + bounded
 * retries) -> record spend -> persist result -> complete -> hooks -> self-eval.
 * The real LLM is only ever reached here, via ceo_run_task / execute:true /
 * the heartbeat — never from a plain delegate. dispatch is injectable so tests
 * run with a mock and never spend.
 */

const fs = require('fs');
const path = require('path');
const memory = require('./memory');
const tasks = require('./tasks');
const budget = require('./budget');
const projection = require('./projection');
const orchestrator = require('./orchestrator');
const approvals = require('./approvals');
const executors = require('./executors');
const scheduler = require('./scheduler');
const org = require('./org');
const events = require('./events');
const learning = require('./learning');
const planner = require('./planner');
const { isHalted } = require('./killswitch');
const { estimateTokens } = require('./llm-adapter');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isVetoed(workspace, taskId) {
  try {
    const raw = fs.readFileSync(path.join(workspace, 'comms', 'vetos.md'), 'utf-8');
    // Match the id as a delimited token so T-100 never matches T-1000.
    const re = new RegExp(`(?:^|[^\\w-])${escapeRe(taskId)}(?![\\w-])`, 'm');
    return re.test(raw);
  } catch {
    return false;
  }
}

/**
 * Act on a completed task's delegation directive (Pillar 5): spawn child tasks
 * within the acting role's delegation authority + depth/fan-out caps, and/or
 * escalate up the reporting line. Bounded so an agent can't fan out forever.
 */
function processDelegation(out, { taskId, agent, workspace, autonomy }) {
  const maxDepth = autonomy.max_delegation_depth ?? 3;
  const maxFanout = autonomy.max_subtasks_per_task ?? 5;
  const actingRole = org.roleOf(agent);
  const created = [];

  const subtasks = Array.isArray(out.subtasks) ? out.subtasks : [];
  if (subtasks.length) {
    if (tasks.depth(taskId) >= maxDepth) {
      events.emit('delegation.capped', { parent: taskId, reason: 'max delegation depth', depth: tasks.depth(taskId) });
    } else {
      // Map a subtask's sibling references (by title) to the child ids created in
      // THIS batch, so a planner/agent can express a real DAG. Forward-order only:
      // a dep resolves only if its sibling was created earlier in the list. Any
      // unmapped entry passes through (it may be an existing task id). LLM output
      // is untrusted, so: a self-reference is dropped, and on a duplicate title
      // the FIRST child keeps the mapping (a later same-titled sibling can't
      // silently repoint earlier dependents).
      const titleToChildId = {};
      for (const st of subtasks.slice(0, maxFanout)) {
        const targetAgent = st.agent || agent;
        // Enforce the org chart: a role may only delegate to roles it's allowed to.
        if (!org.canDelegate(actingRole, targetAgent)) {
          events.emit('delegation.denied', { parent: taskId, agent: targetAgent, reason: 'not in can_delegate_to' });
          continue;
        }
        const deps = Array.isArray(st.depends_on)
          ? st.depends_on.filter(d => d !== st.title).map(d => titleToChildId[d] || d)
          : st.depends_on;
        const child = tasks.create({
          title: st.title,
          description: st.description || st.title,
          agent: targetAgent,
          status: 'backlog',
          parent_id: taskId,
          depends_on: deps,
        });
        if (!(st.title in titleToChildId)) titleToChildId[st.title] = child.id;
        events.emit('task.delegated', { parent: taskId, child: child.id, agent: targetAgent });
        created.push(child.id);
      }
      if (subtasks.length > maxFanout) {
        events.emit('delegation.capped', { parent: taskId, reason: 'max fan-out', dropped: subtasks.length - maxFanout });
      }
    }
  }

  if (out.escalate) {
    const parentRole = actingRole ? (org.roles()[actingRole] || {}).reports_to || null : null;
    approvals.request({
      kind: 'escalation',
      ref_id: taskId,
      summary: out.escalate.reason,
      detail: { from_agent: agent, from_role: actingRole, to_role: parentRole },
    });
    approvals.renderApprovals(workspace);
    events.emit('task.escalated', { task: taskId, from: actingRole, to: parentRole, reason: out.escalate.reason });
  }

  return created;
}

function writeResult(workspace, taskId, text) {
  const rel = path.join('reports', 'tasks', `${taskId}.md`);
  const abs = path.join(workspace, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return rel;
}

/**
 * @param {string} taskId
 * @param {Object} deps
 * @param {string} deps.workspace  - mutable state dir (state + results)
 * @param {string} [deps.pkgRoot]  - where subagents/ live (defaults to workspace)
 * @param {Function} [deps.dispatch] - (agentId, spec, task, context) => {text, usage}
 * @param {string} [deps.sessionId]
 * @param {Object} [deps.settings] - parsed settings.yaml (autonomy.*)
 * @param {number} [deps.timeoutMs]
 * @param {Function} [deps.hooks]   - async (name, ctx) => void  (Phase 7)
 * @param {Function} [deps.evaluate]- async ({task, output, deps}) => evalResult (Phase 5)
 * @param {Function} [deps.requestApproval] - async (task, reason) => void (Phase 4)
 * @param {Function} [deps.rng] - injectable RNG for dispatch exploration (default Math.random)
 */
async function runTask(taskId, deps = {}) {
  const workspace = deps.workspace || process.cwd();
  const pkgRoot = deps.pkgRoot || workspace;
  const dispatch = deps.dispatch || require('./llm-adapter').dispatch;
  const sessionId = deps.sessionId || 'runner';
  const autonomy = (deps.settings && deps.settings.autonomy) || {};
  const maxRetries = autonomy.max_retries_per_agent ?? 3;
  const backoffMs = deps.backoffMs ?? (autonomy.retry_backoff_seconds ?? 0) * 1000;
  const timeoutMs = deps.timeoutMs ?? 120000;

  const task = tasks.get(taskId);
  if (!task) return { status: 'error', taskId, reason: 'task not found' };
  if (task.status === 'done') return { status: 'skipped', taskId, reason: 'already done' };

  // Dependency gate (Pillar 3). Enforced HERE, not only in the heartbeat, so
  // ceo_run_task / execute:true can't bypass the DAG: a task whose deps aren't
  // all done never claims or dispatches.
  const unmet = scheduler.parseDeps(task).filter(d => {
    const dep = tasks.get(d);
    return !dep || dep.status !== 'done';
  });
  if (unmet.length) {
    return { status: 'waiting', taskId, reason: `waiting on dependencies: ${unmet.join(', ')}` };
  }

  // Global kill switch — comms/STOP halts every dispatch path, not just the
  // heartbeat (ceo_run_task / execute:true reach here too).
  if (isHalted(workspace)) {
    return { status: 'halted', taskId, reason: 'comms/STOP present — dispatch halted' };
  }

  // Human veto is a hard stop — never claim or dispatch a vetoed task.
  if (isVetoed(workspace, taskId)) {
    tasks.block(taskId, { reason: 'vetoed by human', agent: task.agent });
    projection.renderTasks(workspace);
    return { status: 'vetoed', taskId, reason: 'vetoed by human' };
  }

  // Resolve the executor early (same precedence as below) so the approval gate
  // can see how this task will actually run. A high-blast runtime listed in
  // executors.require_approval must clear a human ack first, even for a task the
  // caller didn't flag — this is what makes the documented shell/webhook approval
  // gate real (default list is empty → opt-in, behaviour unchanged).
  const preExecCfg = (deps.settings && deps.settings.executors) || {};
  const preAgent = task.agent || 'researcher';
  const resolvedExecutorId = task.plan
    ? 'llm'
    : (deps.executorId || preExecCfg.by_agent?.[preAgent] || org.executorFor(preAgent) || preExecCfg.default || 'llm');
  const execApprovalList = Array.isArray(preExecCfg.require_approval) ? preExecCfg.require_approval : [];
  const needsExecApproval = execApprovalList.includes(resolvedExecutorId);

  // Governance gate: a task flagged needs_approval — or routed to an executor the
  // operator requires approval for — may not run until approved.
  if ((task.needs_approval || needsExecApproval) && !approvals.isApproved('task', taskId)) {
    // A rejection is terminal: block the task instead of reopening a fresh
    // approval every cycle (otherwise dry-run rejection never sticks).
    if (approvals.isRejected('task', taskId)) {
      if (task.status !== 'blocked') {
        tasks.block(taskId, { reason: 'rejected by human', agent: task.agent });
        projection.renderTasks(workspace);
      }
      return { status: 'rejected', taskId, reason: 'rejected by human' };
    }
    if (!approvals.hasPending('task', taskId)) {
      const why = needsExecApproval && !task.needs_approval
        ? `Approval required to run "${task.title}" via the ${resolvedExecutorId} executor`
        : `Approval required to run: ${task.title}`;
      approvals.request({ kind: 'task', ref_id: taskId, summary: why, detail: { agent: task.agent, executor: resolvedExecutorId } });
      approvals.renderApprovals(workspace);
    }
    return { status: 'awaiting-approval', taskId, reason: 'awaiting human approval' };
  }

  if (!tasks.claim(taskId, sessionId)) {
    return { status: 'skipped', taskId, reason: 'claimed by another worker' };
  }

  // Re-check the veto after winning the claim, in case it landed during the race.
  if (isVetoed(workspace, taskId)) {
    tasks.block(taskId, { reason: 'vetoed by human', agent: task.agent });
    projection.renderTasks(workspace);
    return { status: 'vetoed', taskId, reason: 'vetoed by human' };
  }

  const agent = task.agent || 'researcher';
  const agentSpec = orchestrator.loadAgentSpec(agent, pkgRoot);
  let contextFiles = [];
  try {
    contextFiles = JSON.parse(task.context_files || '[]');
  } catch {
    contextFiles = [];
  }
  const fileContext = orchestrator.readContextFiles(contextFiles, workspace);
  // Learning loop (Pillar 6): prepend proven approaches + past lessons for
  // similar work, so the org improves instead of relearning each time.
  let context = fileContext;
  try {
    const learned = learning.recallContext(task, agent);
    if (learned) context = `${learned}\n\n---\n\n${fileContext}`;
  } catch {
    // recall is best-effort; never block a task on it
  }
  let taskText = [task.description || task.title, task.success_criteria ? `\n\nSuccess criteria: ${task.success_criteria}` : '']
    .filter(Boolean)
    .join('');

  // LLM planner step (Pillars 3+5): a `plan` task is decomposed, not executed.
  // Append the planning instruction and force the llm executor (only it parses
  // the resulting ```ceauto directive); processDelegation then spawns the
  // returned subtasks as a DAG. No new execution machinery — just the prompt.
  const isPlanning = !!task.plan;
  if (isPlanning) {
    const roster = Object.keys((deps.settings && deps.settings.agents) || {});
    taskText = `${taskText}\n\n${planner.buildPlanInstruction({ agents: roster, maxSubtasks: autonomy.max_subtasks_per_task })}`;
  }

  let est = estimateTokens(`${agentSpec}${context}${taskText}`);

  // Resolve how this agent runs. Precedence: planning → llm; else explicit dep →
  // settings by_agent → the agent's org role executor → settings default → llm.
  const execCfg = preExecCfg;
  const executorId = resolvedExecutorId; // resolved above (identical precedence)
  const execParams = (execCfg.agent_params && execCfg.agent_params[agent]) || {};
  // A composite runs N sub-steps under one task, so its real cost is ~N× a single
  // dispatch. Scale the budget estimate so the pre-dispatch gate reflects the
  // multi-step spend (and a retry re-runs the whole chain) instead of one step.
  if (executorId === 'composite' && Array.isArray(execParams.steps) && execParams.steps.length) {
    est *= execParams.steps.length;
  }
  const shellAllowlist = (execCfg.shell && execCfg.shell.allowlist) || [];
  const webhookAllowlist = (execCfg.webhook && execCfg.webhook.allowlist) || [];
  const mcpAllowlist = (execCfg['mcp-tool'] && execCfg['mcp-tool'].allowlist) || [];
  const claudeCode = execCfg.claude_code || {};
  const codex = execCfg.codex || {};
  const execDeps = { dispatch, shellAllowlist, webhookAllowlist, mcpAllowlist, claudeCode, codex };

  // Learned dispatch policy (Pillar 6), opt-in: route this agent to the cheapest
  // model that has historically cleared the bar. null (off / not enough signal)
  // → the configured provider/model is used. Only the llm executor reads it.
  const dispatchCfg = (deps.settings && deps.settings.dispatch) || {};
  let route = null;
  if (dispatchCfg.auto_route) {
    try {
      route = learning.recommendDispatch(agent, {
        minSamples: dispatchCfg.min_samples,
        minSuccess: dispatchCfg.min_success,
        epsilon: dispatchCfg.explore_epsilon,
        rng: deps.rng,
      });
      // Exploration deliberately routes off the cheapest-good pick to re-sample an
      // abandoned model; record it so the audit log explains the off-policy route.
      if (route && route.explore) {
        events.emit('dispatch.explored', { task: taskId, agent, model: route.model, provider: route.provider });
      }
    } catch {
      route = null; // routing is best-effort; never block a task on it
    }
  }

  // ONLY the dispatch is retried. Everything after a successful dispatch (record
  // spend, complete, self-eval, delegation) runs exactly once below — a throw
  // there must never re-run the LLM and double-charge a task that already
  // completed. The budget gate is still re-checked before every dispatch attempt.
  let lastErr = null;
  let out = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const affordable = budget.canSpend(agent, est, { sessionId });
    if (!affordable.ok) {
      budget.pause(affordable.reason);
      tasks.block(taskId, { reason: `budget: ${affordable.reason}`, agent });
      projection.renderTasks(workspace);
      if (deps.requestApproval) await deps.requestApproval(task, affordable.reason);
      return { status: 'blocked', taskId, reason: affordable.reason };
    }

    // Role/department envelope (Pillar C). A department breach blocks this task
    // but does NOT globally pause — sibling departments keep working.
    const roleOk = org.checkBudgets(agent, est, { spentByAgents: budget.spentByAgents });
    if (!roleOk.ok) {
      tasks.block(taskId, { reason: `budget: ${roleOk.reason}`, agent });
      projection.renderTasks(workspace);
      if (deps.requestApproval) await deps.requestApproval(task, roleOk.reason);
      return { status: 'blocked', taskId, reason: roleOk.reason };
    }

    try {
      out = await withTimeout(
        executors.execute(executorId, { agent, agentSpec, task: taskText, context, params: execParams, route }, execDeps),
        timeoutMs,
        `executor ${executorId}(${agent})`
      );
      break; // dispatched — leave the retry loop; do NOT retry post-processing
    } catch (err) {
      lastErr = err;
      out = null;
      tasks.incrementAttempts(taskId);
      if (attempt < maxRetries && backoffMs > 0) await sleep(backoffMs);
    }
  }

  if (!out) {
    // Exhausted retries -> block for human attention.
    const reason = lastErr ? lastErr.message : 'unknown failure';
    tasks.block(taskId, { reason, agent });
    projection.renderTasks(workspace);
    try { learning.recordLesson({ task: { id: taskId, title: task.title, agent }, agent, reason }); } catch { /* best-effort */ }
    if (deps.hooks) {
      await deps.hooks('on-blocked', { workspace, task: { id: taskId, title: task.title }, reason, agent });
    }
    return { status: 'blocked', taskId, reason };
  }

  const { text, usage } = out;

  budget.record({
    agent,
    task_id: taskId,
    session_id: sessionId,
    provider: usage?.provider,
    model: usage?.model,
    input_tokens: usage?.input_tokens || 0,
    output_tokens: usage?.output_tokens || 0,
  });

  const resultPath = writeResult(workspace, taskId, text);
  memory.store('agent_outputs', `${taskId}: ${String(task.title).slice(0, 100)}`, {
    agent, task_id: taskId, result_path: resultPath,
  });

  tasks.complete(taskId, { outcome: isPlanning ? 'Planned' : 'Completed', agent, result_path: resultPath });

  let evaluation = null;
  if (deps.evaluate) {
    evaluation = await deps.evaluate({ task: tasks.get(taskId), output: text, deps });
  }
  projection.renderTasks(workspace);

  // Self-eval may have requeued or blocked the task; report the real status.
  const after = tasks.get(taskId);
  if (after.status === 'done') {
    // Inter-agent delegation (Pillar 5): only act on the directive once the task
    // is genuinely done (not on an eval requeue). Isolated try/catch — a
    // child-spawn failure is a best-effort side effect and must not propagate.
    let delegated = [];
    try {
      delegated = processDelegation(out, { taskId, agent, workspace, autonomy });
    } catch (delErr) {
      events.emit('delegation.error', { task: taskId, reason: delErr.message });
    }
    if (delegated.length) projection.renderTasks(workspace);
    // Learning loop: a high-scoring result becomes a reusable playbook.
    try {
      learning.recordPlaybook({ task: after, agent, score: evaluation && evaluation.score, result: text });
    } catch { /* best-effort */ }
    if (deps.hooks) {
      await deps.hooks('on-complete', { workspace, task: { id: taskId, title: task.title }, outcome: isPlanning ? 'Planned' : 'Completed', agent });
    }
    return { status: 'done', taskId, agent, result: text, resultPath, usage, evaluation, delegated };
  }
  if (after.status === 'blocked') {
    // Learning loop: a quality/eval block becomes a lesson recalled before
    // similar work, so the org stops repeating the mistake.
    try { learning.recordLesson({ task: after, agent, reason: after.blocker }); } catch { /* best-effort */ }
    if (deps.hooks) {
      await deps.hooks('on-blocked', { workspace, task: { id: taskId, title: task.title }, reason: after.blocker, agent });
    }
  }
  return { status: after.status, taskId, agent, result: text, resultPath, usage, evaluation };
}

module.exports = { runTask };
