/**
 * on-delegate.js — notification hook fired when a task is delegated.
 * Side-effect only (appends to reports/hooks-log.md).
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

async function onDelegate(context = {}) {
  const task = context.task || {};
  note(context.workspace, 'delegate', `${task.id || ''} ${task.title || ''} → ${context.agent || '—'}`);
  return { success: true };
}

module.exports = { onDelegate };
