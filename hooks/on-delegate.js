/**
 * on-delegate.js - Hook that runs when task is delegated
 * Compatible with any MCP agent framework
 */

const fs = require('fs');
const path = require('path');

/**
 * Handle task delegation
 * @param {Object} context - Delegation context
 * @param {string} context.workspace - Workspace directory
 * @param {Object} context.task - Task being delegated
 * @param {string} context.agent - Agent being assigned to
 * @returns {Object} Delegation result
 */
async function onDelegate(context) {
  const { workspace, task, agent } = context;
  
  const logEntry = {
    timestamp: new Date().toISOString(),
    event: 'delegate',
    task: task.id || task.title,
    agent: agent,
    status: 'delegated'
  };
  
  // Log to agent-logs.md
  const logPath = path.join(workspace, 'memory/agent-logs.md');
  const logContent = `\n## ${logEntry.timestamp}\n**Event:** Task Delegated\n**Task:** ${logEntry.task}\n**Agent:** ${logEntry.agent}\n**Status:** ${logEntry.status}\n`;
  
  try {
    fs.appendFileSync(logPath, logContent);
  } catch (err) {
    // File might not exist, create it
    fs.writeFileSync(logPath, `# Agent Logs\n${logContent}`);
  }
  
  // Add to in-progress.md
  const inProgressPath = path.join(workspace, 'tasks/in-progress.md');
  const taskRow = `| ${task.id || 'TBD'} | ${task.title} | ${agent} | ${new Date().toISOString().split('T')[0]} | ${new Date().toISOString().split('T')[0]} | In Progress | ${task.nextMilestone || 'TBD'} |\n`;
  
  // Read existing content
  let existing = '';
  try {
    existing = fs.readFileSync(inProgressPath, 'utf-8');
  } catch (err) {
    existing = '# In Progress\n\n| ID | Task | Agent | Started | Last Update | Status | Next Milestone |\n|----|------|-------|---------|-------------|--------|----------------|\n';
  }
  
  // Append the new task
  fs.writeFileSync(inProgressPath, existing + taskRow);
  
  return {
    success: true,
    logged: true,
    taskDelegated: task
  };
}

module.exports = { onDelegate };
