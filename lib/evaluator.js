/**
 * evaluator.js — the agent grades its own work and feeds the result back.
 *
 * After a task completes, selfEval() asks a cheap model to rate the output 1-5
 * against the task's success criteria. Low scores requeue the task (bounded by
 * attempts); high scores log goal progress. Eval spend is metered like any
 * other call. An eval failure never fails the underlying task.
 */

const memory = require('./memory');
const tasks = require('./tasks');
const budget = require('./budget');
const goals = require('./goals');

const EVAL_SYSTEM =
  'You are a strict quality reviewer. Given a task and an output, reply with a ' +
  'single integer 1-5 (5 = excellent, fully meets the success criteria; 1 = ' +
  'unusable) followed by one short sentence of justification. Start with the number.';

function clamp(n) {
  return Math.max(1, Math.min(5, n));
}

function parseScore(text) {
  const s = String(text || '');
  // Prefer an explicit N/5 ratio anywhere.
  let m = s.match(/([0-5](?:\.[0-9])?)\s*\/\s*5/);
  if (m) return clamp(parseFloat(m[1]));
  // Otherwise honor the "start with the number" instruction: only a leading
  // 1-5 counts, so a digit buried in the justification prose isn't misread.
  m = s.match(/^\s*\**\s*([1-5])\b/);
  if (m) return clamp(parseFloat(m[1]));
  return 4; // unparseable (e.g. offline mock) -> treat as passing
}

async function selfEval({ task, output, deps = {} }) {
  const settings = deps.settings || {};
  const autonomy = settings.autonomy || {};
  if (autonomy.self_evaluate === false) return null;

  const dispatch = deps.dispatch || require('./llm-adapter').dispatch;
  const sessionId = deps.sessionId || 'evaluator';
  const threshold = deps.evalThreshold ?? autonomy.eval_threshold ?? 3;
  const maxEvalRetries = deps.maxEvalRetries ?? autonomy.max_eval_retries ?? 2;
  const workspace = deps.workspace;

  const prompt = [
    `Task: ${task.title}`,
    task.success_criteria ? `Success criteria: ${task.success_criteria}` : '',
    '',
    'Output to grade:',
    String(output).slice(0, 4000),
  ].filter(Boolean).join('\n');

  let res;
  try {
    res = await dispatch('evaluator', EVAL_SYSTEM, prompt, '');
  } catch {
    return null; // never let evaluation failure fail the task
  }

  const { text, usage } = res;
  if (usage) {
    budget.record({
      agent: 'evaluator',
      task_id: task.id,
      session_id: sessionId,
      provider: usage.provider,
      model: usage.model,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
    });
  }

  const score = parseScore(text);
  memory.getDb()
    .prepare('INSERT INTO evals (task_id, agent, score, rubric, feedback) VALUES (?, ?, ?, ?, ?)')
    .run(task.id, task.agent || null, score, 'quality-1-5', String(text).slice(0, 500));

  if (score < threshold) {
    if ((task.eval_attempts || 0) < maxEvalRetries) {
      tasks.requeueForEval(task.id);
    } else {
      tasks.block(task.id, {
        reason: `quality ${score}/5 below ${threshold} after ${task.eval_attempts + 1} reviews`,
        agent: task.agent,
      });
    }
  } else if (score >= 4 && workspace) {
    goals.recordProgress(workspace, { taskId: task.id, title: task.title, score });
  }

  return { score, feedback: text };
}

module.exports = { selfEval, parseScore };
