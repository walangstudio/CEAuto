/**
 * learning.js — the learning loop (Pillar 6). The org gets better and cheaper
 * over time. Three feedback paths, all on top of the existing evals + memory FTS
 * (no new tables):
 *
 *   1. Playbooks  — a high-scoring task distills a reusable (task-type → approach)
 *                   note; the best match is injected as context for similar future
 *                   tasks, so proven approaches propagate.
 *   2. Post-mortems — a blocked/failed task distills a lesson, recalled before a
 *                   similar task runs, so the org stops repeating mistakes.
 *   3. Dispatch policy — success-rate + cost per (agent, model) from evals joined
 *                   with the ledger; recommends the cheapest historically-good
 *                   model. Advisory (surfaced via ceo_insights).
 */

const memory = require('./memory');

const PLAYBOOK_MIN_SCORE = 4;

function taskType(task) {
  return task.agent || 'general';
}

/** Distill a playbook from a high-scoring completion. No-op below the bar. */
function recordPlaybook({ task, agent, score, result }) {
  if (score == null || score < PLAYBOOK_MIN_SCORE) return false;
  const approach = String(result || '').slice(0, 800);
  const content = `Playbook — ${agent} — ${task.title}\nApproach (scored ${score}/5):\n${approach}`;
  memory.store('playbook', content, { task_id: task.id, agent, task_type: taskType(task), score });
  return true;
}

/** Distill a lesson from a blocked/failed task. */
function recordLesson({ task, agent, reason }) {
  if (!reason) return false;
  const content = `Lesson — ${agent} — ${task.title}\nWhat went wrong: ${reason}`;
  memory.store('lesson', content, { task_id: task.id, agent, reason });
  return true;
}

/**
 * Proven approaches + relevant lessons to inject before running a similar task,
 * so the agent benefits from past wins and avoids past failures. Empty string
 * when nothing matches (e.g. a cold start).
 */
// Build an OR query of significant terms. FTS5 ANDs bare terms, which is too
// strict across differently-worded tasks — OR ranks by overlap instead.
function ftsOrQuery(text) {
  const tokens = String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  return [...new Set(tokens)].slice(0, 12).join(' OR ');
}

function recallContext(task, agent, { limit = 2 } = {}) {
  const query = ftsOrQuery(`${agent || ''} ${task.title || ''}`);
  if (!query) return '';
  const playbooks = memory.recall(query, limit, 'playbook');
  const lessons = memory.recall(query, limit, 'lesson');
  if (!playbooks.length && !lessons.length) return '';
  const parts = [];
  if (playbooks.length) {
    parts.push('## Proven approaches (from past high-scoring work)');
    playbooks.forEach(p => parts.push(p.content));
  }
  if (lessons.length) {
    parts.push('## Lessons (avoid these past failures)');
    lessons.forEach(l => parts.push(l.content));
  }
  return parts.join('\n\n');
}

/**
 * Per-model performance for an agent: sample count, success rate (eval score at
 * or above passScore), average score, average USD. Joins evals to the ledger by
 * (task_id, agent) — the agent's own dispatch rows, not the evaluator's.
 */
function dispatchStats(agent, { passScore = 3 } = {}) {
  const db = memory.getDb();
  if (!db) return [];
  // Pre-aggregate ledger and evals to ONE row per task BEFORE joining, so retries
  // (multiple ledger rows) and re-evals (multiple eval rows) can't multiply the
  // join and skew the stats. Cost is summed per (task, model); score is the
  // task's best eval. Then aggregate per model over distinct tasks.
  return db.prepare(`
    SELECT l.model AS model,
           COUNT(*) AS samples,
           AVG(CASE WHEN ev.score >= ? THEN 1.0 ELSE 0 END) AS success_rate,
           AVG(ev.score) AS avg_score,
           AVG(l.usd) AS avg_usd
    FROM (
      SELECT task_id, model, SUM(usd) AS usd
      FROM budget_ledger
      WHERE agent = ? AND model IS NOT NULL
      GROUP BY task_id, model
    ) l
    JOIN (
      SELECT task_id, MAX(score) AS score
      FROM evals
      WHERE agent = ?
      GROUP BY task_id
    ) ev ON ev.task_id = l.task_id
    GROUP BY l.model
    ORDER BY avg_usd ASC
  `).all(passScore, agent, agent).map(r => ({
    model: r.model,
    samples: r.samples,
    successRate: r.success_rate,
    avgScore: r.avg_score,
    avgUsd: r.avg_usd,
  }));
}

/**
 * The cheapest model whose success rate clears the bar with enough samples —
 * "cheapest that works". Null when there isn't enough signal yet.
 */
function recommendModel(agent, { minSamples = 3, minSuccess = 0.6 } = {}) {
  const stats = dispatchStats(agent); // already ascending by avg_usd
  const good = stats.filter(s => s.samples >= minSamples && s.successRate >= minSuccess);
  return good.length ? good[0].model : null;
}

function counts() {
  const db = memory.getDb();
  if (!db) return { playbooks: 0, lessons: 0 };
  const playbooks = db.prepare("SELECT COUNT(*) AS n FROM memory WHERE type = 'playbook'").get().n;
  const lessons = db.prepare("SELECT COUNT(*) AS n FROM memory WHERE type = 'lesson'").get().n;
  return { playbooks, lessons };
}

module.exports = {
  recordPlaybook,
  recordLesson,
  recallContext,
  dispatchStats,
  recommendModel,
  counts,
};
