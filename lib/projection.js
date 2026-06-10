/**
 * projection.js — single writer that rebuilds the tasks/*.md tables from the
 * SQLite `tasks` table. This replaces the old fragile line-filtering and makes
 * the markdown a read-only view humans can glance at; SQLite stays the truth.
 */

const fs = require('fs');
const path = require('path');
const tasks = require('./tasks');

function dateOf(iso) {
  return (iso || '').split('T')[0] || iso || '';
}

function write(workspace, rel, content) {
  const abs = path.join(workspace, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function renderBacklog(rows) {
  const header =
    '# Backlog\n\n| ID | Task | Agent | Priority | Deadline |\n|----|------|-------|----------|----------|\n';
  const body = rows
    .map(t => `| ${t.id} | ${t.title} | ${t.agent || '—'} | ${t.priority || 'P2'} | ${t.deadline || 'TBD'} |`)
    .join('\n');
  return header + body + '\n';
}

function renderInProgress(rows) {
  const header =
    '# In Progress\n\n| ID | Task | Agent | Started | Last Update | Status | Blocker | Next Checkpoint |\n' +
    '|----|------|-------|---------|-------------|--------|---------|------------------|\n';
  const body = rows
    .map(t => {
      const status = t.claimed_by ? '🔵 Running' : '🟢 On Track';
      return `| ${t.id} | ${t.title} | ${t.agent || '—'} | ${dateOf(t.claimed_at || t.created_at)} | ${dateOf(t.updated_at)} | ${status} | ${t.blocker || '—'} | ${t.deadline || 'TBD'} |`;
    })
    .join('\n');
  return header + body + '\n';
}

function renderBlocked(rows) {
  const header =
    '# Blocked Tasks\n\n| ID | Task | Agent | Blocked Since | Reason | Action Needed | Escalated |\n' +
    '|----|------|-------|---------------|--------|---------------|-----------|\n';
  const body = rows
    .map(t => `| ${t.id} | ${t.title} | ${t.agent || '—'} | ${dateOf(t.updated_at)} | ${t.blocker || '—'} | CEO to resolve | No |`)
    .join('\n');
  return header + body + '\n';
}

function renderDone(rows) {
  const header =
    '# Completed\n\n| ID | Task | Agent | Completed | Outcome | Quality | Learnings |\n' +
    '|----|------|-------|-----------|---------|---------|-----------|\n';
  const body = rows
    .map(t => `| ${t.id} | ${t.title} | ${t.agent || '—'} | ${dateOf(t.updated_at)} | ${t.outcome || 'Done'} | ${t.quality || '✅'} | ${t.learnings || '—'} |`)
    .join('\n');
  return header + body + '\n';
}

/**
 * Re-render all four task files from SQLite. Call after any task mutation.
 */
function renderTasks(workspace) {
  write(workspace, 'tasks/backlog.md', renderBacklog(tasks.listByStatus('backlog')));
  write(workspace, 'tasks/in-progress.md', renderInProgress(tasks.listByStatus('in-progress')));
  write(workspace, 'tasks/blocked.md', renderBlocked(tasks.listByStatus('blocked')));
  write(workspace, 'tasks/done.md', renderDone(tasks.listByStatus('done')));
}

module.exports = { renderTasks };
