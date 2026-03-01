/**
 * on-complete.js - Hook that runs when a task is completed
 * Compatible with any MCP agent framework
 */

const fs = require('fs');
const path = require('path');

/**
 * Handle task completion
 * @param {Object} context - Completion context
 * @param {string} context.workspace - Workspace directory
 * @param {Object} context.task - Task that was completed
 * @param {string} context.outcome - Outcome description
 * @param {string} context.quality - Quality rating
 * @returns {Object} Completion result
 */
async function onComplete(context) {
  const { workspace, task, outcome, quality, agent } = context;
  
  const date = new Date().toISOString().split('T')[0];
  const taskId = task.id || `T-${Date.now()}`;
  
  // Log to done.md
  const donePath = path.join(workspace, 'tasks/done.md');
  const doneRow = `| ${taskId} | ${task.title} | ${agent || '—'} | ${date} | ${outcome || 'Done'} | ${quality || '✅'} |\n`;
  
  try {
    let existing = fs.readFileSync(donePath, 'utf-8');
    fs.writeFileSync(donePath, existing + doneRow);
  } catch (err) {
    const header = '# Completed\n\n| ID | Task | Agent | Completed | Outcome | Quality |\n|----|------|-------|-----------|---------|---------|\n';
    fs.writeFileSync(donePath, header + doneRow);
  }
  
  // Remove from in-progress.md (simple approach - would need more robust parsing in production)
  const inProgressPath = path.join(workspace, 'tasks/in-progress.md');
  try {
    let inProgress = fs.readFileSync(inProgressPath, 'utf-8');
    // Remove the line with this taskId
    const lines = inProgress.split('\n').filter(line => !line.includes(`| ${taskId} |`));
    fs.writeFileSync(inProgressPath, lines.join('\n'));
  } catch (err) {
    // File might not exist, ignore
  }
  
  return {
    success: true,
    taskCompleted: true,
    taskId: taskId,
    outcome: outcome
  };
}

module.exports = { onComplete };
