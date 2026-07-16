/**
 * events.js — append-only event log + deterministic replay (Pillar 4).
 *
 * Every state transition is emitted here as an immutable event. Because the log
 * is append-only and totally ordered (the autoincrement id), the org's task
 * state can be re-derived by folding the events — so we get AUDIT and REPLAY for
 * free: rebuild any past snapshot, or diff two points in time. This is the bet
 * Paperclip doesn't make (it mutates a control plane; we can prove what happened).
 *
 * The reducer is pure (fold over a list), so replay is testable offline and
 * `reduce(x)` twice yields identical state.
 */

const memory = require('./memory');

function db() {
  return memory.getDb();
}

/** Append one event. Best-effort: a missing db never breaks a caller. */
function emit(type, payload = {}, { actor = 'system' } = {}) {
  const d = db();
  if (!d) return null;
  const info = d.prepare('INSERT INTO events (type, payload, actor) VALUES (?, ?, ?)')
    .run(type, JSON.stringify(payload), actor);
  return info.lastInsertRowid;
}

function parse(row) {
  let payload = {};
  try {
    payload = JSON.parse(row.payload || '{}');
  } catch {
    payload = {};
  }
  return { id: row.id, type: row.type, payload, actor: row.actor, created_at: row.created_at };
}

function list({ sinceId = 0, type = null, limit = null } = {}) {
  const d = db();
  if (!d) return [];
  const where = ['id > ?'];
  const params = [sinceId];
  if (type) {
    where.push('type = ?');
    params.push(type);
  }
  let sql = `SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY id`;
  if (limit) {
    sql += ' LIMIT ?';
    params.push(limit);
  }
  return d.prepare(sql).all(...params).map(parse);
}

function all() {
  return list();
}

function lastId() {
  const d = db();
  if (!d) return 0;
  const row = d.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM events').get();
  return row.id;
}

/**
 * Pure reducer: fold events (in id order) into a derived task-state snapshot.
 * Covers the task lifecycle so replay reconstructs status/owner from the log
 * alone. Deterministic — same events in, same snapshot out.
 */
function reduce(events) {
  const tasks = {};
  const ordered = [...events].sort((a, b) => a.id - b.id);
  for (const e of ordered) {
    const p = e.payload || {};
    const id = p.id;
    switch (e.type) {
      case 'task.created':
        tasks[id] = { id, status: p.status || 'backlog', agent: p.agent || null, claimed_by: null };
        break;
      case 'task.status':
        if (tasks[id]) {
          tasks[id].status = p.status;
          if (p.status !== 'in-progress') tasks[id].claimed_by = null;
          if (p.agent) tasks[id].agent = p.agent;
        }
        break;
      case 'task.claimed':
        if (tasks[id]) { tasks[id].status = 'in-progress'; tasks[id].claimed_by = p.worker || null; }
        break;
      case 'task.completed':
        if (tasks[id]) { tasks[id].status = 'done'; tasks[id].claimed_by = null; }
        break;
      case 'task.blocked':
        if (tasks[id]) { tasks[id].status = 'blocked'; tasks[id].claimed_by = null; tasks[id].blocker = p.reason || null; }
        break;
      case 'task.requeued':
        if (tasks[id]) { tasks[id].status = 'backlog'; tasks[id].claimed_by = null; }
        break;
      case 'task.reclaimed':
        if (tasks[id]) { tasks[id].claimed_by = null; }
        break;
      default:
        break;
    }
  }
  return { tasks };
}

/** Snapshot derived from the log up to (and including) an event id. */
function snapshot(uptoId = null) {
  const events = uptoId == null ? all() : list().filter(e => e.id <= uptoId);
  return reduce(events);
}

// ── Subscriptions + cursor-based drain (the reactive loop) ────────────────────

const SUBS = [];

/** Register a reactive handler. `type` may be a glob '*' for all events. */
function subscribe(type, handler) {
  SUBS.push({ type, handler });
}

function clearSubscriptions() {
  SUBS.length = 0;
}

/**
 * Process every event after the stored cursor through matching subscriptions,
 * then advance the cursor. This is what lets the heartbeat be event-driven, not
 * just a cron tick. Handlers are best-effort: one throwing never blocks others
 * or the cursor advance. Returns the number of events processed.
 */
function drain({ cursorKey = 'events_cursor', subs = SUBS } = {}) {
  const from = Number(memory.getRuntime(cursorKey) || 0);
  const events = list({ sinceId: from });
  for (const e of events) {
    for (const s of subs) {
      if (s.type !== '*' && s.type !== e.type) continue;
      try {
        s.handler(e);
      } catch {
        // a reactive handler must never break the drain
      }
    }
  }
  if (events.length) memory.setRuntime(cursorKey, String(events[events.length - 1].id));
  return events.length;
}

module.exports = {
  emit,
  list,
  all,
  lastId,
  reduce,
  snapshot,
  subscribe,
  clearSubscriptions,
  drain,
};
