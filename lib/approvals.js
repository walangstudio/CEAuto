/**
 * approvals.js — the human-in-the-loop queue.
 *
 * Anything the policy gates (strategic decisions, budget overage, sensitive
 * actions) lands here as `pending` and the daemon will not execute it until a
 * human approves. Mirrored to comms/approvals.md so it is visible without a DB
 * client, alongside the existing comms/vetos.md hard-stop.
 */

const fs = require('fs');
const path = require('path');
const memory = require('./memory');

function db() {
  const d = memory.getDb();
  if (!d) throw new Error('memory not initialised — call memory.init() first');
  return d;
}

function request({ kind, ref_id, summary = '', detail = {} }) {
  const info = db().prepare(`
    INSERT INTO approvals (kind, ref_id, summary, detail, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(kind, ref_id || null, summary, JSON.stringify(detail));
  return info.lastInsertRowid;
}

function get(id) {
  return db().prepare('SELECT * FROM approvals WHERE id = ?').get(id) || null;
}

function list(status) {
  if (status) {
    return db().prepare('SELECT * FROM approvals WHERE status = ? ORDER BY requested_at DESC').all(status);
  }
  return db().prepare('SELECT * FROM approvals ORDER BY requested_at DESC').all();
}

function pending() {
  return list('pending');
}

function resolve(id, decision, by = 'human', note = '') {
  const status = decision === 'approve' ? 'approved' : 'rejected';
  db().prepare(`
    UPDATE approvals
    SET status = ?, resolved_by = ?, note = ?, resolved_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `).run(status, by, note, id);
  return get(id);
}

function approve(id, by, note) {
  return resolve(id, 'approve', by, note);
}

function reject(id, by, note) {
  return resolve(id, 'reject', by, note);
}

/** Is there an approved record for this (kind, ref_id)? */
function isApproved(kind, refId) {
  const row = db().prepare(`
    SELECT status FROM approvals
    WHERE kind = ? AND ref_id = ?
    ORDER BY requested_at DESC LIMIT 1
  `).get(kind, refId);
  return Boolean(row && row.status === 'approved');
}

function renderApprovals(workspace) {
  const rows = list();
  const lines = [
    '# Approvals Queue',
    '',
    '| ID | Kind | Ref | Summary | Status | Resolved By |',
    '|----|------|-----|---------|--------|-------------|',
    ...rows.map(r => `| ${r.id} | ${r.kind} | ${r.ref_id || '—'} | ${(r.summary || '').replace(/\n/g, ' ')} | ${r.status} | ${r.resolved_by || '—'} |`),
    '',
  ];
  const abs = path.join(workspace, 'comms', 'approvals.md');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, lines.join('\n'));
}

module.exports = {
  request,
  get,
  list,
  pending,
  resolve,
  approve,
  reject,
  isApproved,
  renderApprovals,
};
