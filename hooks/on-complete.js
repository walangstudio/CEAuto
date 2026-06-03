/**
 * on-complete.js — notification hook fired when a task is completed.
 * Side-effect only (appends to reports/hooks-log.md). Task state is owned by
 * projection.js / tasks.js, so this no longer mutates the task tables.
 */

const { note } = require('../lib/hook-log');

async function onComplete(context = {}) {
  const task = context.task || {};
  note(context.workspace, 'complete', `${task.id || ''} ${task.title || ''} → ${context.outcome || 'done'} (${context.agent || '—'})`);
  return { success: true };
}

module.exports = { onComplete };
