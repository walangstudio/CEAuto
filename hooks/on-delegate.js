/**
 * on-delegate.js — notification hook fired when a task is delegated.
 * Side-effect only (appends to reports/hooks-log.md).
 */

const { note } = require('../lib/hook-log');

async function onDelegate(context = {}) {
  const task = context.task || {};
  note(context.workspace, 'delegate', `${task.id || ''} ${task.title || ''} → ${context.agent || '—'}`);
  return { success: true };
}

module.exports = { onDelegate };
