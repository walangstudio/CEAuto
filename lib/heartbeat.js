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
const metrics = require('./metrics');
const scheduler = require('./scheduler');
const projection = require('./projection');
const events = require('./events');

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

// Reactive event drain: project every new event to an append-only audit feed.
// Cursor-based, so each event is rendered exactly once across cycles. This is
// the seam where the loop becomes event-driven, not just a cron tick.
function drainEvents(workspace) {
  const abs = path.join(workspace, 'reports', 'events-feed.md');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const subs = [{
    type: '*',
    handler: (e) => {
      const line = `- #${e.id} ${e.created_at} \`${e.type}\` ${JSON.stringify(e.payload)}\n`;
      try {
        fs.appendFileSync(abs, line);
      } catch {
        fs.writeFileSync(abs, line);
      }
    },
  }];
  return events.drain({ subs });
}

async function runCycle(deps = {}) {
  const workspace = deps.workspace || process.cwd();
  const settings = deps.settings || {};
  const autonomy = settings.autonomy || {};
  const maxTasks = deps.maxTasks ?? autonomy.max_tasks_per_cycle ?? 3;
  const perHeartbeat = deps.perHeartbeatTokens ?? autonomy.per_heartbeat_token_budget ?? Infinity;
  const log = deps.log || (() => {});
  const runTask = deps.runTask || runner.runTask;

  const summary = { ran: 0, done: 0, blocked: 0, skipped: 0, vetoed: 0, deadlocked: 0, results: [] };

  if (budget.isPaused()) {
    writeCycleLog(workspace, { ...summary, paused: true });
    log('heartbeat: paused (budget hold) — resume to continue');
    return { ...summary, paused: true };
  }

  // Break deadlocks first so they can't silently starve the queue: a task that
  // depends on a non-existent task or sits in a dependency cycle gets blocked
  // with a clear reason instead of being skipped forever.
  for (const d of scheduler.findDeadlocks(tasks.all())) {
    tasks.block(d.id, { reason: d.reason });
    summary.deadlocked += 1;
    summary.results.push({ id: d.id, status: 'deadlocked', reason: d.reason });
    log(`heartbeat: blocked ${d.id} — ${d.reason}`);
  }
  if (summary.deadlocked) projection.renderTasks(workspace);

  let cycleTokens = 0; // only this cycle's own spend, not global daily
  const attempted = new Set();

  // Re-scan readiness after every run so a completed task unblocks its
  // dependents within the same heartbeat (a whole chain can drain in one cycle).
  // `attempted` bounds the loop: a task that doesn't reach 'done' (skipped,
  // awaiting-approval) is tried at most once per cycle, so we never spin.
  while (summary.ran < maxTasks) {
    if (cycleTokens >= perHeartbeat) {
      log('heartbeat: per-cycle token budget reached');
      break;
    }
    const ready = scheduler.readyOrder(tasks.all()).filter(t => !attempted.has(t.id));
    if (!ready.length) break;
    const t = ready[0];
    attempted.add(t.id);

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
    if (res.usage) cycleTokens += (res.usage.input_tokens || 0) + (res.usage.output_tokens || 0);
    summary.ran += 1;
    summary.results.push({ id: t.id, status: res.status });
    if (res.status === 'done') summary.done += 1;
    else if (res.status === 'blocked') summary.blocked += 1;
    else if (res.status === 'vetoed') summary.vetoed += 1;
    else summary.skipped += 1;
  }

  writeCycleLog(workspace, summary);
  try {
    metrics.writeReport(workspace);
  } catch {
    // metrics are best-effort; never fail a cycle over a report
  }
  events.emit('cycle.ran', { ran: summary.ran, done: summary.done, blocked: summary.blocked, deadlocked: summary.deadlocked });
  // Project all events emitted this cycle (task lifecycle + the cycle event) to
  // the audit feed.
  try {
    drainEvents(workspace);
  } catch {
    // audit feed is best-effort
  }
  memory.store('events', `heartbeat: ran ${summary.ran} (done ${summary.done}, blocked ${summary.blocked})`, summary);
  log(`heartbeat: ran ${summary.ran}, done ${summary.done}, blocked ${summary.blocked}`);
  return summary;
}

module.exports = { runCycle };
