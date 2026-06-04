/**
 * tasks.js — transactional task store. SQLite is the source of truth; the
 * markdown tables under tasks/ are rendered from here (projection.js).
 *
 * Statuses: backlog | in-progress | blocked | done
 */

const memory = require('./memory');

const STALE_CLAIM_MS = 10 * 60 * 1000; // a claim older than this can be reclaimed

function db() {
  const d = memory.getDb();
  if (!d) throw new Error('memory not initialised — call memory.init() first');
  return d;
}

function nowIso() {
  return new Date().toISOString();
}

function genId() {
  return `T-${Date.now()}-${Number(process.hrtime.bigint() % 100000n)}`;
}

function create(task = {}) {
  const id = task.id || genId();
  const row = {
    id,
    title: task.title || '(untitled)',
    description: task.description || '',
    agent: task.agent || null,
    status: task.status || 'backlog',
    priority: task.priority || 'P2',
    deadline: task.deadline || null,
    success_criteria: task.success_criteria || null,
    context_files: JSON.stringify(task.context_files || []),
    needs_approval: task.needs_approval ? 1 : 0,
    depends_on: task.depends_on != null ? JSON.stringify(normalizeDeps(task.depends_on)) : null,
    parent_id: task.parent_id || null,
  };
  db().prepare(`
    INSERT INTO tasks (id, title, description, agent, status, priority, deadline, success_criteria, context_files, needs_approval, depends_on, parent_id)
    VALUES (@id, @title, @description, @agent, @status, @priority, @deadline, @success_criteria, @context_files, @needs_approval, @depends_on, @parent_id)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      agent = excluded.agent,
      status = excluded.status,
      priority = excluded.priority,
      deadline = excluded.deadline,
      success_criteria = excluded.success_criteria,
      context_files = excluded.context_files,
      needs_approval = excluded.needs_approval,
      depends_on = COALESCE(excluded.depends_on, tasks.depends_on),
      parent_id = COALESCE(excluded.parent_id, tasks.parent_id),
      updated_at = datetime('now')
  `).run(row);
  return get(id);
}

function normalizeDeps(deps) {
  if (Array.isArray(deps)) return deps.filter(x => typeof x === 'string' && x);
  if (typeof deps === 'string' && deps.trim()) return [deps.trim()];
  return [];
}

function get(id) {
  return db().prepare('SELECT * FROM tasks WHERE id = ?').get(id) || null;
}

function listByStatus(status) {
  return db().prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at').all(status);
}

function all() {
  return db().prepare('SELECT * FROM tasks').all();
}

function children(parentId) {
  return db().prepare('SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at').all(parentId);
}

function listActionable() {
  // un-claimed, not done/blocked, ready for a worker to pick up
  return db().prepare(`
    SELECT * FROM tasks
    WHERE status IN ('backlog', 'in-progress')
      AND claimed_by IS NULL
    ORDER BY
      CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
      created_at
  `).all();
}

/**
 * Atomically claim a task for a worker. Returns true iff THIS caller won the
 * claim. A single synchronous better-sqlite3 UPDATE guarantees exactly one
 * winner even when the daemon and a manual call race for the same task.
 */
function claim(id, worker, { ttlMs = STALE_CLAIM_MS } = {}) {
  const staleCutoff = new Date(Date.now() - ttlMs).toISOString();
  const info = db().prepare(`
    UPDATE tasks
    SET claimed_by = ?, claimed_at = ?, status = 'in-progress', updated_at = datetime('now')
    WHERE id = ?
      AND status NOT IN ('done', 'blocked')
      AND (claimed_by IS NULL OR claimed_at <= ?)
  `).run(worker, nowIso(), id, staleCutoff);
  return info.changes === 1;
}

function release(id) {
  db().prepare(`
    UPDATE tasks SET claimed_by = NULL, claimed_at = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
  return get(id);
}

function complete(id, { outcome = 'Done', quality = '⭐⭐⭐⭐', learnings = '', agent, result_path } = {}) {
  db().prepare(`
    UPDATE tasks
    SET status = 'done', outcome = ?, quality = ?, learnings = ?,
        agent = COALESCE(?, agent), result_path = COALESCE(?, result_path),
        claimed_by = NULL, claimed_at = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(outcome, quality, learnings, agent || null, result_path || null, id);
  return get(id);
}

function block(id, { reason = '', agent } = {}) {
  db().prepare(`
    UPDATE tasks
    SET status = 'blocked', blocker = ?, agent = COALESCE(?, agent),
        claimed_by = NULL, claimed_at = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(reason, agent || null, id);
  return get(id);
}

function requeue(id) {
  db().prepare(`
    UPDATE tasks
    SET status = 'backlog', claimed_by = NULL, claimed_at = NULL,
        attempts = attempts + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
  return get(id);
}

function incrementAttempts(id) {
  db().prepare('UPDATE tasks SET attempts = attempts + 1, updated_at = datetime(\'now\') WHERE id = ?').run(id);
  return get(id);
}

// Requeue specifically for a quality (self-eval) retry — uses a separate
// counter so transport retries (attempts) and quality retries (eval_attempts)
// never throttle each other.
function requeueForEval(id) {
  db().prepare(`
    UPDATE tasks
    SET status = 'backlog', claimed_by = NULL, claimed_at = NULL,
        eval_attempts = eval_attempts + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
  return get(id);
}

module.exports = {
  STALE_CLAIM_MS,
  create,
  get,
  all,
  children,
  listByStatus,
  listActionable,
  claim,
  release,
  complete,
  block,
  requeue,
  requeueForEval,
  incrementAttempts,
};
