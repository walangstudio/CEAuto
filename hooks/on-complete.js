/**
 * on-complete.js — notification hook fired when a task is completed.
 * Side-effect only (appends to reports/hooks-log.md). Task state is owned by
 * projection.js / tasks.js, so this no longer mutates the task tables.
 */

const fs = require('fs');
const path = require('path');

function note(workspace, event, detail) {
  const line = `- ${new Date().toISOString()} [${event}] ${detail}`;
  const abs = path.join(workspace || '.', 'reports', 'hooks-log.md');
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    let prev = '';
    try {
      prev = fs.readFileSync(abs, 'utf-8');
    } catch {
      prev = '';
    }
    if (!prev) prev = '# Hooks Log\n\n';
    fs.writeFileSync(abs, prev + line + '\n');
  } catch {
    // never throw from a hook
  }
  return line;
}

async function onComplete(context = {}) {
  const task = context.task || {};
  note(context.workspace, 'complete', `${task.id || ''} ${task.title || ''} → ${context.outcome || 'done'} (${context.agent || '—'})`);
  return { success: true };
}

module.exports = { onComplete };
