/**
 * scheduler.js — dependency-aware task ordering (Pillar 3, the Task DAG).
 *
 * Pure functions over a snapshot of tasks. A task carries `depends_on` (a JSON
 * array of task ids that must be `done` first) and an optional `parent_id`
 * (subtasks). The heartbeat asks this module two things each cycle:
 *   readyOrder(all)    — actionable, unclaimed tasks whose deps are all done,
 *                        ordered by priority then age (deterministic).
 *   findDeadlocks(all) — pending tasks that can NEVER run (unknown dep or a
 *                        dependency cycle), so the cycle blocks them with a
 *                        clear reason instead of starving the queue forever.
 */

const ACTIONABLE = new Set(['backlog', 'in-progress']);
const PRIORITY = { P1: 1, P2: 2, P3: 3 };

function parseDeps(t) {
  if (!t || t.depends_on == null) return [];
  try {
    const d = JSON.parse(t.depends_on);
    return Array.isArray(d) ? d.filter(x => typeof x === 'string' && x) : [];
  } catch {
    return [];
  }
}

function byPriorityThenAge(a, b) {
  const ra = PRIORITY[a.priority] || 4;
  const rb = PRIORITY[b.priority] || 4;
  if (ra !== rb) return ra - rb;
  return String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
    String(a.id).localeCompare(String(b.id));
}

// A dep is satisfied iff the referenced task exists and is done.
function depsSatisfied(t, byId) {
  return parseDeps(t).every(d => {
    const dep = byId.get(d);
    return dep && dep.status === 'done';
  });
}

function readyOrder(all) {
  const byId = new Map(all.map(t => [t.id, t]));
  return all
    .filter(t => ACTIONABLE.has(t.status) && !t.claimed_by && depsSatisfied(t, byId))
    .sort(byPriorityThenAge);
}

// Tasks that can never become ready, each with a human-readable reason.
// One reason per task (unknown-dep takes precedence over cycle).
function findDeadlocks(all) {
  const byId = new Map(all.map(t => [t.id, t]));
  const pending = all.filter(t => ACTIONABLE.has(t.status));
  const flagged = new Map();

  for (const t of pending) {
    const missing = parseDeps(t).filter(d => !byId.has(d));
    if (missing.length) flagged.set(t.id, `unknown dependency: ${missing.join(', ')}`);
  }

  for (const id of detectCycles(pending)) {
    if (!flagged.has(id)) flagged.set(id, 'dependency cycle');
  }

  return [...flagged].map(([id, reason]) => ({ id, reason }));
}

// Kahn's algorithm over the pending subgraph: edges only between pending tasks
// (deps that are done or unknown don't participate). Whatever can't be drained
// to indegree 0 is stuck in a cycle.
function detectCycles(pending) {
  const pendingIds = new Set(pending.map(t => t.id));
  const indeg = new Map();
  const dependents = new Map(); // dep id -> [ids that depend on it]

  for (const t of pending) {
    // Keep self-deps: a task depending on itself never reaches indegree 0,
    // so Kahn flags it as a (trivial) cycle, which is correct.
    const pdeps = parseDeps(t).filter(d => pendingIds.has(d));
    indeg.set(t.id, pdeps.length);
    for (const d of pdeps) {
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d).push(t.id);
    }
  }

  const queue = pending.filter(t => (indeg.get(t.id) || 0) === 0).map(t => t.id);
  while (queue.length) {
    const id = queue.shift();
    for (const dep of dependents.get(id) || []) {
      indeg.set(dep, indeg.get(dep) - 1);
      if (indeg.get(dep) === 0) queue.push(dep);
    }
  }
  return pending.filter(t => (indeg.get(t.id) || 0) > 0).map(t => t.id);
}

module.exports = { readyOrder, findDeadlocks, parseDeps };
