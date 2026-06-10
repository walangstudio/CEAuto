/**
 * on-blocked.js — notification hook fired when a task becomes blocked.
 * Side-effect only (appends to reports/hooks-log.md).
 */

const { note } = require('../lib/hook-log');

async function onBlocked(context = {}) {
  const task = context.task || {};
  note(context.workspace, 'blocked', `${task.id || ''} ${task.title || ''} — ${context.reason || ''}`);
  return { success: true };
}

module.exports = { onBlocked };
