/**
 * policy.js — decides what the agent may NOT do on its own.
 *
 * Pure function over a settings object (settings.yaml autonomy.*). Strategic
 * (one-way-door) decisions, policy-listed action kinds, budget overage, and
 * high estimated cost all require a human approval before autonomous execution.
 */

function requiresApproval(action = {}, settings = {}) {
  const autonomy = settings.autonomy || {};
  const list = autonomy.require_approval_for || [];

  if (action.decision_type === 'strategic') {
    return { required: true, reason: 'strategic (one-way door) decision' };
  }
  if (action.kind && list.includes(action.kind)) {
    return { required: true, reason: `policy: ${action.kind} requires approval` };
  }
  if (action.budget_overage) {
    return { required: true, reason: 'budget overage' };
  }
  const threshold = autonomy.approval_cost_threshold_usd;
  if (threshold != null && action.est_cost_usd != null && action.est_cost_usd > threshold) {
    return { required: true, reason: `estimated cost $${action.est_cost_usd} over $${threshold}` };
  }
  return { required: false };
}

module.exports = { requiresApproval };
