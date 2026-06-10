/**
 * goals.js — append progress notes to strategy/goals.md so the agent's own
 * output feeds back into its north-star tracking.
 */

const fs = require('fs');
const path = require('path');

const PROGRESS_HEADER = '## Progress Log';

function recordProgress(workspace, { taskId, title, score }) {
  const abs = path.join(workspace, 'strategy', 'goals.md');
  const date = new Date().toISOString().split('T')[0];
  const line = `- [${date}] ✅ ${title} (${taskId}) — quality ${score}/5`;

  let content = '';
  try {
    content = fs.readFileSync(abs, 'utf-8');
  } catch {
    content = '# Goals\n';
  }

  if (!content.includes(PROGRESS_HEADER)) {
    content += `\n\n${PROGRESS_HEADER}\n`;
  }
  content = content.replace(/\s*$/, '') + '\n' + line + '\n';

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return line;
}

module.exports = { recordProgress };
