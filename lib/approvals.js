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

function request({ kind, ref_id, summary = '', detail = {}, quorum = 1 }) {
  const q = Math.max(1, Number(quorum) || 1);
  const info = db().prepare(`
    INSERT INTO approvals (kind, ref_id, summary, detail, status, quorum, votes)
    VALUES (?, ?, ?, ?, 'pending', ?, '{}')
  `).run(kind, ref_id || null, summary, JSON.stringify(detail), q);
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

/**
 * Record one approver's vote. A single reject vetoes immediately; approvals need
 * `quorum` DISTINCT approvers before they flip to approved (quorum 1 = the old
 * single-approver behaviour). A vote on an already-resolved request is a no-op.
 */
function resolve(id, decision, by = 'human', note = '') {
  const row = get(id);
  // No-op on a missing or already-resolved approval: return null so callers
  // (e.g. budget-resume on approval) don't re-fire on a repeat vote.
  if (!row || row.status !== 'pending') return null;

  const votes = safeVotes(row.votes);
  votes[by] = decision === 'approve' ? 'approve' : 'reject';

  const quorum = row.quorum || 1;
  let status = 'pending';
  if (decision !== 'approve') {
    status = 'rejected';
  } else {
    const approvers = Object.values(votes).filter(v => v === 'approve').length;
    if (approvers >= quorum) status = 'approved';
  }

  if (status === 'pending') {
    // Quorum not yet met — record the vote, stay pending.
    db().prepare("UPDATE approvals SET votes = ? WHERE id = ? AND status = 'pending'").run(JSON.stringify(votes), id);
  } else {
    db().prepare(`
      UPDATE approvals
      SET votes = ?, status = ?, resolved_by = ?, note = ?, resolved_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `).run(JSON.stringify(votes), status, by, note, id);
  }
  return get(id);
}

function safeVotes(raw) {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Distinct approve-votes on an approval row. One source of truth for every view. */
function approverCount(row) {
  return Object.values(safeVotes(row && row.votes)).filter(v => v === 'approve').length;
}

function approve(id, by, note) {
  return resolve(id, 'approve', by, note);
}

function reject(id, by, note) {
  return resolve(id, 'reject', by, note);
}

/** Is there already a pending request for this (kind, ref_id)? */
function hasPending(kind, refId) {
  const row = db().prepare(`
    SELECT 1 FROM approvals WHERE kind = ? AND ref_id = ? AND status = 'pending' LIMIT 1
  `).get(kind, refId);
  return Boolean(row);
}

/** Is there an approved record for this (kind, ref_id)? */
function isApproved(kind, refId) {
  return latestStatus(kind, refId) === 'approved';
}

/** Was the latest request for this (kind, ref_id) rejected? (terminal — don't reopen) */
function isRejected(kind, refId) {
  return latestStatus(kind, refId) === 'rejected';
}

function latestStatus(kind, refId) {
  const row = db().prepare(`
    SELECT status FROM approvals
    WHERE kind = ? AND ref_id = ?
    ORDER BY requested_at DESC, id DESC LIMIT 1
  `).get(kind, refId);
  return row ? row.status : null;
}

function renderApprovals(workspace) {
  const rows = list();
  const lines = [
    '# Approvals Queue',
    '',
    '| ID | Kind | Ref | Summary | Status | Votes | Resolved By |',
    '|----|------|-----|---------|--------|-------|-------------|',
    ...rows.map(r => {
      const votes = (r.quorum || 1) > 1 ? `${approverCount(r)}/${r.quorum}` : '—';
      return `| ${r.id} | ${r.kind} | ${r.ref_id || '—'} | ${(r.summary || '').replace(/\n/g, ' ')} | ${r.status} | ${votes} | ${r.resolved_by || '—'} |`;
    }),
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
  hasPending,
  resolve,
  approve,
  reject,
  isApproved,
  isRejected,
  approverCount,
  renderApprovals,
};
