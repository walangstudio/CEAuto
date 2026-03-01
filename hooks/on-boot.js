/**
 * on-boot.js - Hook that runs when CEO agent boots
 * Compatible with any MCP agent framework
 */

const fs = require('fs');
const path = require('path');

/**
 * Execute boot sequence
 * @param {Object} context - Boot context
 * @param {string} context.workspace - Workspace directory
 * @returns {Object} Boot result
 */
async function onBoot(context) {
  const { workspace } = context;
  
  const files = {
    context: 'memory/context.md',
    goals: 'strategy/goals.md',
    priorities: 'strategy/priorities.md',
    vetos: 'comms/vetos.md',
    blocked: 'tasks/blocked.md',
    inProgress: 'tasks/in-progress.md',
    backlog: 'tasks/backlog.md'
  };
  
  const results = {};
  
  // Read all status files
  for (const [key, file] of Object.entries(files)) {
    const filePath = path.join(workspace, file);
    try {
      if (fs.existsSync(filePath)) {
        results[key] = fs.readFileSync(filePath, 'utf-8');
      } else {
        results[key] = null;
      }
    } catch (err) {
      results[key] = { error: err.message };
    }
  }
  
  return {
    success: true,
    filesLoaded: Object.keys(results).filter(k => results[k] !== null).length,
    data: results
  };
}

module.exports = { onBoot };
