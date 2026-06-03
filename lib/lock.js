/**
 * lock.js — single-instance guard for the daemon, stored in SQLite (runtime
 * table) rather than a filesystem lock so it survives Windows file-handle
 * quirks and shares the WAL DB. A lock older than ttlMs is considered stale
 * (the previous daemon crashed) and can be taken over.
 */

const memory = require('./memory');

const KEY = 'daemon_lock';
const DEFAULT_TTL = 5 * 60 * 1000;

function holder() {
  const raw = memory.getRuntime(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function acquire(pid, { ttlMs = DEFAULT_TTL } = {}) {
  const cur = holder();
  if (cur && cur.pid !== pid) {
    const age = Date.now() - new Date(cur.ts).getTime();
    if (age < ttlMs) return false; // someone else holds a fresh lock
  }
  memory.setRuntime(KEY, JSON.stringify({ pid, ts: new Date().toISOString() }));
  return true;
}

function refresh(pid) {
  memory.setRuntime(KEY, JSON.stringify({ pid, ts: new Date().toISOString() }));
}

function release(pid) {
  const cur = holder();
  if (cur && cur.pid === pid) {
    memory.setRuntime(KEY, '');
  }
}

module.exports = { acquire, refresh, release, holder };
