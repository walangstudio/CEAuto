/**
 * on-decide.js — notification hook fired when the CEO makes a decision.
 * Side-effect only (appends to reports/hooks-log.md); the decision log itself
 * is written by the server/handler, not here.
 */

const { note } = require('../lib/hook-log');

async function onDecide(context = {}) {
  note(context.workspace, 'decide', `${context.decision || ''} (${context.persona || 'default'})`);
  return { success: true };
}

module.exports = { onDecide };
