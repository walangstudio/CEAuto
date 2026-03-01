/**
 * on-decide.js - Hook that runs when CEO makes a decision
 * Compatible with any MCP agent framework
 */

const fs = require('fs');
const path = require('path');

/**
 * Log a CEO decision
 * @param {Object} context - Decision context
 * @param {string} context.workspace - Workspace directory
 * @param {string} context.decision - Decision text
 * @param {string} context.rationale - Why this decision
 * @param {string} context.persona - Which persona used
 * @returns {Object} Decision log result
 */
async function onDecide(context) {
  const { workspace, decision, rationale, persona, impact } = context;
  
  const date = new Date().toISOString().split('T')[0];
  
  const logEntry = `## ${date}
**Decision:** ${decision}
**Rationale:** ${rationale}
**Persona:** ${persona || 'default'}
**Impact:** ${impact || 'None'}
**Status:** In effect
**Vetoed:** No

---

`;
  
  const logPath = path.join(workspace, 'memory/decisions.md');
  
  try {
    fs.appendFileSync(logPath, logEntry);
  } catch (err) {
    // File might not exist, create it
    fs.writeFileSync(logPath, `# CEO Decision Log\n\n${logEntry}`);
  }
  
  return {
    success: true,
    decisionLogged: true,
    decision: decision
  };
}

module.exports = { onDecide };
