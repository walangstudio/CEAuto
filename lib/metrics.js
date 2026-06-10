/**
 * metrics.js — read-only aggregations over the SQLite state for observability.
 * No new state; just answers "how is the autonomous org doing right now".
 */

const fs = require('fs');
const path = require('path');
const memory = require('./memory');
const budget = require('./budget');

function db() {
  const d = memory.getDb();
  if (!d) throw new Error('memory not initialised — call memory.init() first');
  return d;
}

function tasksByStatus() {
  const rows = db().prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').all();
  const out = { backlog: 0, 'in-progress': 0, blocked: 0, done: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

function throughput(days = 7) {
  const row = db().prepare(`
    SELECT COUNT(*) AS n FROM tasks
    WHERE status = 'done' AND updated_at >= datetime('now', ?)
  `).get(`-${days} days`);
  return row.n;
}

function spend(days = null) {
  // Single source of truth — budget.js owns ledger aggregation.
  const s = budget.spentTotal(days);
  return { tokens: s.tokens, usd: Number(s.usd.toFixed(4)) };
}

function decisionsCount() {
  return db().prepare("SELECT COUNT(*) AS n FROM memory WHERE type = 'decisions'").get().n;
}

function approvalsPending() {
  return db().prepare("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'").get().n;
}

function evalAverage() {
  const row = db().prepare('SELECT AVG(score) AS avg, COUNT(*) AS n FROM evals').get();
  return { avg: row.avg == null ? null : Number(row.avg.toFixed(2)), count: row.n };
}

function snapshot() {
  const ev = evalAverage();
  return {
    tasks: tasksByStatus(),
    throughput_7d: throughput(7),
    spend_today: spend(1),
    spend_total: spend(),
    decisions: decisionsCount(),
    approvals_pending: approvalsPending(),
    eval_avg: ev.avg,
    eval_count: ev.count,
    paused: Boolean(memory.getRuntime('budget_paused')),
  };
}

function renderMarkdown(snap = snapshot()) {
  return [
    '# CEAuto Metrics',
    `_Generated ${new Date().toISOString()}_`,
    '',
    '## Tasks',
    `- Backlog: ${snap.tasks.backlog}`,
    `- In progress: ${snap.tasks['in-progress']}`,
    `- Blocked: ${snap.tasks.blocked}`,
    `- Done: ${snap.tasks.done}`,
    `- Throughput (7d): ${snap.throughput_7d}`,
    '',
    '## Spend',
    `- Today: ${snap.spend_today.tokens} tokens ($${snap.spend_today.usd})`,
    `- Total: ${snap.spend_total.tokens} tokens ($${snap.spend_total.usd})`,
    `- Autonomous spend: ${snap.paused ? '⏸️ PAUSED (budget hold)' : '▶️ active'}`,
    '',
    '## Governance & Quality',
    `- Decisions logged: ${snap.decisions}`,
    `- Approvals pending: ${snap.approvals_pending}`,
    `- Avg self-eval score: ${snap.eval_avg == null ? 'n/a' : `${snap.eval_avg}/5`} (${snap.eval_count} evals)`,
    '',
  ].join('\n');
}

function writeReport(workspace) {
  const md = renderMarkdown();
  const abs = path.join(workspace, 'reports', 'metrics.md');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, md);
  return md;
}

module.exports = { snapshot, renderMarkdown, writeReport, throughput, spend };
