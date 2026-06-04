/**
 * memory.js — SQLite state + episodic memory.
 *
 * The `memory` table + FTS5 keep the original recall/summary behaviour.
 * Phase 1 adds the transactional state tables (tasks, budget_ledger, approvals,
 * evals, runtime) that make atomic checkout, budgeting, governance and metrics
 * possible. Markdown files become a projection of `tasks` (see projection.js).
 */

let db = null;

function init(dbPath) {
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');

  if (db) {
    try {
      db.close();
    } catch {
      // already closed
    }
    db = null;
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      type      TEXT NOT NULL,
      content   TEXT NOT NULL,
      metadata  TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      content,
      type,
      content='memory',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
      INSERT INTO memory_fts(rowid, content, type) VALUES (new.id, new.content, new.type);
    END;

    CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, content, type) VALUES ('delete', old.id, old.content, old.type);
    END;

    CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, content, type) VALUES ('delete', old.id, old.content, old.type);
      INSERT INTO memory_fts(rowid, content, type) VALUES (new.id, new.content, new.type);
    END;

    CREATE TABLE IF NOT EXISTS tasks (
      id               TEXT PRIMARY KEY,
      title            TEXT NOT NULL,
      description      TEXT,
      agent            TEXT,
      status           TEXT NOT NULL DEFAULT 'backlog',
      priority         TEXT DEFAULT 'P2',
      deadline         TEXT,
      success_criteria TEXT,
      context_files    TEXT,
      claimed_by       TEXT,
      claimed_at       TEXT,
      blocker          TEXT,
      outcome          TEXT,
      quality          TEXT,
      learnings        TEXT,
      result_path      TEXT,
      attempts         INTEGER NOT NULL DEFAULT 0,
      eval_attempts    INTEGER NOT NULL DEFAULT 0,
      needs_approval   INTEGER NOT NULL DEFAULT 0,
      depends_on       TEXT,
      parent_id        TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);

    CREATE TABLE IF NOT EXISTS budget_ledger (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      agent         TEXT,
      task_id       TEXT,
      session_id    TEXT,
      provider      TEXT,
      model         TEXT,
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      usd           REAL NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_agent ON budget_ledger(agent);

    CREATE TABLE IF NOT EXISTS approvals (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      kind         TEXT NOT NULL,
      ref_id       TEXT,
      summary      TEXT,
      detail       TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at  TEXT,
      resolved_by  TEXT,
      note         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

    CREATE TABLE IF NOT EXISTS evals (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    TEXT,
      agent      TEXT,
      score      REAL,
      rubric     TEXT,
      feedback   TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runtime (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  migrate(db);
  return db;
}

// Additive, idempotent column migrations for DBs created before a column existed.
function migrate(d) {
  const want = { depends_on: 'TEXT', parent_id: 'TEXT' };
  const have = new Set(d.prepare('PRAGMA table_info(tasks)').all().map(c => c.name));
  for (const [name, type] of Object.entries(want)) {
    if (!have.has(name)) d.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`);
  }
}

function getDb() {
  return db;
}

function store(type, content, metadata = {}) {
  if (!db) return;
  const stmt = db.prepare('INSERT INTO memory (type, content, metadata) VALUES (?, ?, ?)');
  stmt.run(type, content, JSON.stringify(metadata));
}

function recall(query, limit = 10, type = null) {
  if (!db) return [];
  try {
    const sql = `
      SELECT m.id, m.type, m.content, m.metadata, m.created_at
      FROM memory_fts f
      JOIN memory m ON m.id = f.rowid
      WHERE memory_fts MATCH ?
      ${type ? 'AND m.type = ?' : ''}
      ORDER BY rank
      LIMIT ?
    `;
    const params = type ? [query, type, limit] : [query, limit];
    return db.prepare(sql).all(...params);
  } catch {
    const sql = `
      SELECT id, type, content, metadata, created_at
      FROM memory
      WHERE content LIKE ?
      ${type ? 'AND type = ?' : ''}
      ORDER BY created_at DESC
      LIMIT ?
    `;
    const params = type ? [`%${query}%`, type, limit] : [`%${query}%`, limit];
    return db.prepare(sql).all(...params);
  }
}

function summary(days = 7) {
  if (!db) return '';
  const rows = db.prepare(`
    SELECT type, content, created_at
    FROM memory
    WHERE created_at >= datetime('now', ?)
    ORDER BY created_at DESC
    LIMIT 50
  `).all(`-${days} days`);

  if (!rows.length) return '';

  return rows.map(r => `- [${r.type}] ${r.content.substring(0, 100)} _(${r.created_at})_`).join('\n');
}

function setRuntime(key, value) {
  if (!db) return;
  db.prepare(`
    INSERT INTO runtime (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, typeof value === 'string' ? value : JSON.stringify(value));
}

function getRuntime(key) {
  if (!db) return null;
  const row = db.prepare('SELECT value FROM runtime WHERE key = ?').get(key);
  return row ? row.value : null;
}

function close() {
  if (!db) return;
  try {
    db.close();
  } catch {
    // already closed
  }
  db = null;
}

module.exports = { init, getDb, store, recall, summary, setRuntime, getRuntime, close };
