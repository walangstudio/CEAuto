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

function estTokens(s) {
  return Math.max(1, Math.ceil(String(s || '').length / 4));
}

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

  if (!tasks.claim(taskId, sessionId)) {
    return { status: 'skipped', taskId, reason: 'claimed by another worker' };
  }

  const agent = task.agent || 'researcher';
  const agentSpec = orchestrator.loadAgentSpec(agent, pkgRoot);
  let contextFiles = [];
  try {
    contextFiles = JSON.parse(task.context_files || '[]');
  } catch {
    contextFiles = [];
  }
  const context = orchestrator.readContextFiles(contextFiles, workspace);
  const taskText = [task.description || task.title, task.success_criteria ? `\n\nSuccess criteria: ${task.success_criteria}` : '']
    .filter(Boolean)
    .join('');

  // Budget gate (pre-call estimate).
  const est = estTokens(`${agentSpec}${context}${taskText}`);
  const affordable = budget.canSpend(agent, est, { sessionId });
  if (!affordable.ok) {
    budget.pause(affordable.reason);
    tasks.block(taskId, { reason: `budget: ${affordable.reason}`, agent });
    projection.renderTasks(workspace);
    if (deps.requestApproval) await deps.requestApproval(task, affordable.reason);
    return { status: 'blocked', taskId, reason: affordable.reason };
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { text, usage } = await withTimeout(
        dispatch(agent, agentSpec, taskText, context),
        timeoutMs,
        `dispatch(${agent})`
      );

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

      tasks.complete(taskId, { outcome: 'Completed', agent, result_path: resultPath });

      let evaluation = null;
      if (deps.evaluate) {
        evaluation = await deps.evaluate({ task: tasks.get(taskId), output: text, deps });
      }
      projection.renderTasks(workspace);

      if (deps.hooks) {
        await deps.hooks('on-complete', { workspace, task: { id: taskId, title: task.title }, outcome: 'Completed', agent });
      }

      return { status: 'done', taskId, agent, result: text, resultPath, usage, evaluation };
    } catch (err) {
      lastErr = err;
      tasks.incrementAttempts(taskId);
      if (attempt < maxRetries && backoffMs > 0) await sleep(backoffMs);
    }
  }

  // Exhausted retries -> block for human attention.
  const reason = lastErr ? lastErr.message : 'unknown failure';
  tasks.block(taskId, { reason, agent });
  projection.renderTasks(workspace);
  if (deps.hooks) {
    await deps.hooks('on-blocked', { workspace, task: { id: taskId, title: task.title }, reason, agent });
  }
  return { status: 'blocked', taskId, reason };
}

module.exports = { runTask };
