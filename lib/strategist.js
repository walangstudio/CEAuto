/**
 * strategist.js — the generative half of autonomy.
 *
 * The heartbeat DRAINS a task queue; nothing filled it from strategy/goals.md, so
 * an idle backlog meant an idle daemon. This closes that gap: when nothing is
 * ready to run, read strategy/goals.md + strategy/priorities.md, ask an LLM for
 * the next concrete tasks, and enqueue them as ordinary backlog tasks — which then
 * flow through the SAME budget / approval / veto gates as any task. It ORIGINATES
 * work; it never executes it.
 *
 * Guardrails (config/settings.yaml → autonomy.*):
 *   - pursue_goals: false            master switch (default OFF)
 *   - auto_run_generated: false      false = generated tasks are needs_approval (dry-run)
 *   - max_generated_tasks_per_day    hard cap on how many tasks it may originate / 24h
 *   - strategy_min_interval_minutes  cooldown so it can't re-plan (and re-spend) every cycle
 *   - max_tasks_per_plan             fan-out cap per planning call
 *   - strategy_agent                 which agent's persona/budget the planning call uses
 */

const fs = require('fs');
const path = require('path');
const memory = require('./memory');
const tasks = require('./tasks');
const budget = require('./budget');
const events = require('./events');
const { parseDirective } = require('./delegation');
const { estimateTokens } = require('./llm-adapter');

const DEFAULT_AGENTS = ['researcher', 'coder', 'analyst', 'writer', 'ops', 'security', 'comms'];

function readStrategy(workspace) {
  const read = (rel) => {
    try { return fs.readFileSync(path.join(workspace, rel), 'utf-8'); } catch { return ''; }
  };
  return { goals: read('strategy/goals.md'), priorities: read('strategy/priorities.md') };
}

// recentOutcomes titles can include externally-created work (webhook/file-watch/
// @mention sources), so this text is untrusted and could try to steer the plan.
// It is contained by the roster check + dry-run needs_approval + the daily caps.
function recentOutcomes(limit = 8) {
  try {
    return memory.getDb()
      .prepare("SELECT title, status FROM tasks WHERE status IN ('done','blocked') ORDER BY updated_at DESC LIMIT ?")
      .all(limit)
      .map(r => `- [${r.status}] ${r.title}`)
      .join('\n');
  } catch { return ''; }
}

// The guard counters below FAIL CLOSED: if the events table can't be read, treat
// the caps/cooldown as reached so a broken DB stops the strategist rather than
// disabling every limit and letting it spend freely.
function countEventsSince(type, sql) {
  try {
    return memory.getDb()
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE type = ? AND created_at >= datetime('now', ?)`)
      .get(type, sql).n;
  } catch { return Infinity; }
}

function countGeneratedSince(hours = 24) {
  return countEventsSince('strategy.generated', `-${hours} hours`);
}

function countPlannedSince(hours = 24) {
  return countEventsSince('strategy.planned', `-${hours} hours`);
}

function plannedWithin(minutes) {
  try {
    return Boolean(memory.getDb()
      .prepare("SELECT 1 FROM events WHERE type = 'strategy.planned' AND created_at >= datetime('now', ?) LIMIT 1")
      .get(`-${minutes} minutes`));
  } catch { return true; }
}

function buildInstruction({ goals, priorities, recent, roster, maxTasks }) {
  return [
    'You are the autonomous CEO. Decide the next concrete tasks that move the GOALS forward, guided by the PRIORITIES.',
    '',
    '## GOALS',
    goals || '(none set)',
    '',
    '## PRIORITIES',
    priorities || '(none set)',
    recent ? `\n## RECENT OUTCOMES (do not repeat done work)\n${recent}` : '',
    '',
    `Choose 1–${maxTasks} concrete, independently-actionable tasks. Assign each to an agent from: ${roster.join(', ')}.`,
    'If the goals are already met, return an empty subtasks array.',
    'Respond with ONLY a fenced ```ceauto block — no prose before or after:',
    '```ceauto',
    '{ "subtasks": [ { "title": "short title", "description": "what to do and why", "agent": "<agent>" } ] }',
    '```',
  ].filter(Boolean).join('\n');
}

/**
 * Originate the next tasks from the strategy files. Returns
 * { generated: string[], skipped?: string }. Best-effort and self-bounded — the
 * caller (heartbeat) only invokes it when the ready queue is empty.
 */
async function generateTasks(deps = {}) {
  const workspace = deps.workspace || process.cwd();
  const settings = deps.settings || {};
  const autonomy = settings.autonomy || {};
  const dispatch = deps.dispatch || require('./llm-adapter').dispatch;
  const sessionId = deps.sessionId || 'strategist';
  const roster = Object.keys(settings.agents || {}).length ? Object.keys(settings.agents) : DEFAULT_AGENTS;

  const perPlan = Math.max(1, autonomy.max_tasks_per_plan ?? 5);
  const dailyCap = autonomy.max_generated_tasks_per_day ?? 10;
  const maxPlansPerDay = autonomy.max_plans_per_day ?? 24;
  const cooldownMin = autonomy.strategy_min_interval_minutes ?? 30;
  const autoRun = !!autonomy.auto_run_generated;
  const strategyAgent = autonomy.strategy_agent || 'analyst';

  // Cooldown so an empty/failed plan can't make the daemon re-plan (and re-spend)
  // every single cycle.
  if (cooldownMin > 0 && plannedWithin(cooldownMin)) return { generated: [], skipped: 'cooldown' };

  // Cap PLANNING CALLS/day, not just generated tasks: a plan that yields nothing
  // (goals met, or a malformed answer) still spends on the LLM but emits no
  // strategy.generated, so the task cap alone would let it re-spend forever. Return
  // BEFORE emitting/spending so the count can't grow past the cap.
  if (countPlannedSince(24) >= maxPlansPerDay) {
    return { generated: [], skipped: 'plan-cap' };
  }

  // Hard daily cap on originated work.
  const remaining = dailyCap - countGeneratedSince(24);
  if (remaining <= 0) {
    events.emit('strategy.planned', { generated: 0, reason: 'daily cap reached' }, { actor: 'strategist' });
    return { generated: [], skipped: 'cap' };
  }

  const { goals, priorities } = readStrategy(workspace);
  if (!goals && !priorities) {
    events.emit('strategy.planned', { generated: 0, reason: 'no goals set' }, { actor: 'strategist' });
    return { generated: [], skipped: 'no-goals' };
  }

  const wanted = Math.min(perPlan, remaining);
  const instruction = buildInstruction({ goals, priorities, recent: recentOutcomes(), roster, maxTasks: wanted });

  // Gate + record the planning call itself, like any dispatch.
  const est = estimateTokens(instruction);
  const affordable = budget.canSpend(strategyAgent, est, { sessionId });
  if (!affordable.ok) {
    events.emit('strategy.planned', { generated: 0, reason: affordable.reason }, { actor: 'strategist' });
    return { generated: [], skipped: 'budget' };
  }

  let out;
  try {
    out = await dispatch(strategyAgent, "You are the autonomous CEO planning the org's next moves.", instruction, '');
  } catch (e) {
    events.emit('strategy.planned', { generated: 0, reason: `dispatch failed: ${e.message}` }, { actor: 'strategist' });
    return { generated: [], skipped: 'dispatch-error' };
  }
  budget.record({
    agent: strategyAgent, task_id: null, session_id: sessionId,
    provider: out.usage?.provider, model: out.usage?.model,
    input_tokens: out.usage?.input_tokens || 0, output_tokens: out.usage?.output_tokens || 0,
  });

  const directive = parseDirective(out.text);
  const subtasks = (directive?.subtasks || []).slice(0, wanted);
  const created = [];
  for (const st of subtasks) {
    const valid = roster.includes(st.agent);
    const agent = valid ? st.agent : strategyAgent;
    const task = tasks.create({
      title: st.title,
      description: st.description || st.title,
      agent,
      status: 'backlog',
      priority: 'P2',
      needs_approval: !autoRun, // dry-run by default: you approve what it wants to do
    });
    events.emit(
      'strategy.generated',
      { task: task.id, agent, needs_approval: !autoRun, ...(valid ? {} : { requested_agent: st.agent }) },
      { actor: 'strategist' }
    );
    created.push(task.id);
  }
  events.emit('strategy.planned', { generated: created.length }, { actor: 'strategist' });
  return { generated: created, autoRun };
}

module.exports = { generateTasks, buildInstruction };
