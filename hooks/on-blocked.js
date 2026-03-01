/**
 * on-blocked.js - Hook that runs when a task becomes blocked
 * Compatible with any MCP agent framework
 */

const fs = require('fs');
const path = require('path');

/**
 * Handle blocked task
 * @param {Object} context - Block context
 * @param {string} context.workspace - Workspace directory
 * @param {Object} context.task - Task that is blocked
 * @param {string} context.reason - Why it's blocked
 * @returns {Object} Block handling result
 */
async function onBlocked(context) {
  const { workspace, task, reason, agent } = context;
  
  const date = new Date().toISOString().split('T')[0];
  
  // Log to blocked.md
  const blockedPath = path.join(workspace, 'tasks/blocked.md');
  const taskId = task.id || `T-${Date.now()}`;
  
  const blockedRow = `| ${taskId} | ${task.title} | ${agent || 'Unassigned'} | ${date} | ${reason} | CEO to resolve | No |\n`;
  
  try {
    let existing = fs.readFileSync(blockedPath, 'utf-8');
    fs.writeFileSync(blockedPath, existing + blockedRow);
  } catch (err) {
    const header = '# Blocked Tasks — CEO Attention Required\n\n| ID | Task | Agent | Blocked Since | Reason | CEO Action Needed | Escalated |\n|----|------|-------|---------------|--------|-------------------|-----------|\n';
    fs.writeFileSync(blockedPath, header + blockedRow);
  }
  
  // Also log to agent-logs
  const logPath = path.join(workspace, 'memory/agent-logs.md');
  const logEntry = `
## ${new Date().toISOString()}
**Event:** Task Blocked
**Task:** ${task.title}
**Reason:** ${reason}
**Agent:** ${agent || 'N/A'}
`;
  
  try {
    fs.appendFileSync(logPath, logEntry);
  } catch (err) {
    fs.writeFileSync(logPath, `# Agent Logs\n${logEntry}`);
  }
  
  return {
    success: true,
    taskBlocked: true,
    taskId: taskId,
    reason: reason
  };
}

module.exports = { onBlocked };
