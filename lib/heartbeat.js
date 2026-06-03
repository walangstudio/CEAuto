/**
 * heartbeat.js — the autonomy cycle.
 *
 * runCycle() is a pure, dependency-injected function: it scans the actionable
 * task queue and runs up to max_tasks_per_cycle through the runner, bounded by
 * a per-heartbeat token budget, then logs the cycle. The daemon
 * (bin/ceauto-daemon.js) calls it on a schedule; the ceo_run_cycle tool calls
 * it exactly once. Same code path either way, so the loop is unit-testable
 * without spawning a process.
 */

const fs = require('fs');
const path = require('path');
const memory = require('./memory');
const tasks = require('./tasks');
const budget = require('./budget');
const runner = require('./runner');

function writeCycleLog(workspace, summary) {
  const line = `- ${new Date().toISOString()} ran=${summary.ran || 0} done=${summary.done || 0} blocked=${summary.blocked || 0}${summary.paused ? ' (paused)' : ''}`;
  const abs = path.join(workspace, 'reports', 'heartbeat-log.md');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  let prev = '';
  try {
    prev = fs.readFileSync(abs, 'utf-8');
  } catch {
    prev = '';
  }
  if (!prev) prev = '# Heartbeat Log\n\n';
  fs.writeFileSync(abs, prev + line + '\n');
}

async function runCycle(deps = {}) {
  const workspace = deps.workspace || process.cwd();
  const settings = deps.settings || {};
  const autonomy = settings.autonomy || {};
  const maxTasks = deps.maxTasks ?? autonomy.max_tasks_per_cycle ?? 3;
  const perHeartbeat = deps.perHeartbeatTokens ?? autonomy.per_heartbeat_token_budget ?? Infinity;
  const log = deps.log || (() => {});
  const runTask = deps.runTask || runner.runTask;

  const summary = { ran: 0, done: 0, blocked: 0, skipped: 0, vetoed: 0, results: [] };

  if (budget.isPaused()) {
    writeCycleLog(workspace, { ...summary, paused: true });
    log('heartbeat: paused (budget hold) — resume to continue');
    return { ...summary, paused: true };
  }

  const startTokens = budget.spentTotal(1).tokens;
  const queue = tasks.listActionable().slice(0, maxTasks);

  for (const t of queue) {
    if (budget.spentTotal(1).tokens - startTokens >= perHeartbeat) {
      log('heartbeat: per-cycle token budget reached');
      break;
    }
    const res = await runTask(t.id, {
      workspace,
      pkgRoot: deps.pkgRoot,
      dispatch: deps.dispatch,
      sessionId: deps.sessionId || 'daemon',
      settings,
      requestApproval: deps.requestApproval,
      evaluate: deps.evaluate,
      hooks: deps.hooks,
      backoffMs: deps.backoffMs,
    });
    summary.ran += 1;
    summary.results.push({ id: t.id, status: res.status });
    if (res.status === 'done') summary.done += 1;
    else if (res.status === 'blocked') summary.blocked += 1;
    else if (res.status === 'vetoed') summary.vetoed += 1;
    else summary.skipped += 1;
  }

  writeCycleLog(workspace, summary);
  memory.store('events', `heartbeat: ran ${summary.ran} (done ${summary.done}, blocked ${summary.blocked})`, summary);
  log(`heartbeat: ran ${summary.ran}, done ${summary.done}, blocked ${summary.blocked}`);
  return summary;
}

module.exports = { runCycle };
