/**
 * memory.js — SQLite episodic memory with FTS5
 * Tables: decisions, directives, agent_outputs, sessions, events
 */

let db = null;

function init(dbPath) {
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);

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
  `);
}

function store(type, content, metadata = {}) {
  if (!db) return;
  const stmt = db.prepare('INSERT INTO memory (type, content, metadata) VALUES (?, ?, ?)');
  stmt.run(type, content, JSON.stringify(metadata));
}

function recall(query, limit = 10, type = null) {
  if (!db) return [];
  try {
    let sql = `
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
    // Fallback to LIKE if FTS query malformed
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

module.exports = { init, store, recall, summary };
