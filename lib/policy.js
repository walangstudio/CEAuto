/**
 * policy.js — decides what the agent may NOT do on its own.
 *
 * Two layers:
 *   1. Policy-as-code (G2): an optional config/policy.yaml of ordered rules. The
 *      first matching rule decides; a rule may require approval and set a `quorum`
 *      (number of distinct approvers needed before execution).
 *   2. Legacy fallback: if no rule matches (or no policy file exists), the
 *      original settings.yaml `autonomy.*` checks apply — so behaviour is
 *      unchanged unless an operator opts into rules.
 *
 * Pure over (action, settings) given the loaded rules; a configure/reset seam
 * keeps it unit-testable and hermetic.
 */

const fs = require('fs');
const path = require('path');

let RULES = null; // null = not loaded yet

function loadFromDisk() {
  try {
    const yaml = require('js-yaml');
    const raw = fs.readFileSync(path.join(__dirname, '../config/policy.yaml'), 'utf-8');
    const doc = yaml.load(raw) || {};
    return Array.isArray(doc.rules) ? doc.rules : [];
  } catch {
    return [];
  }
}

/** Override the rules (tests / explicit config). */
function configure(rules = []) {
  RULES = Array.isArray(rules) ? rules : [];
}

function resetConfig() {
  RULES = null;
}

function rules() {
  if (RULES == null) RULES = loadFromDisk();
  return RULES;
}

/** Does an action match a rule's `match` block? Empty/absent match never matches. */
function matchesRule(rule, action) {
  const m = rule.match || {};
  const keys = Object.keys(m);
  if (!keys.length) return false;
  if (m.decision_type != null && action.decision_type !== m.decision_type) return false;
  if (m.kind != null && action.kind !== m.kind) return false;
  if (Array.isArray(m.kind_in) && !m.kind_in.includes(action.kind)) return false;
  if (m.budget_overage === true && !action.budget_overage) return false;
  if (m.est_cost_usd_over != null && !(action.est_cost_usd != null && action.est_cost_usd > m.est_cost_usd_over)) return false;
  return true;
}

function requiresApproval(action = {}, settings = {}) {
  // 1. Policy-as-code: first matching rule with an explicit verdict wins. A rule
  // must say `require_approval: true|false`; anything else is treated as a
  // non-decision and falls through (so a half-written rule can't silently gate).
  for (const rule of rules()) {
    if (!rule || typeof rule !== 'object') continue;
    if (!matchesRule(rule, action)) continue;
    if (rule.require_approval === false) return { required: false };
    if (rule.require_approval === true) {
      return {
        required: true,
        reason: rule.reason || 'policy rule',
        quorum: Math.max(1, Number(rule.quorum) || 1),
      };
    }
  }

  // 2. Legacy fallback (unchanged), quorum 1.
  const autonomy = settings.autonomy || {};
  const list = autonomy.require_approval_for || [];
  if (action.decision_type === 'strategic') {
    return { required: true, reason: 'strategic (one-way door) decision', quorum: 1 };
  }
  if (action.kind && list.includes(action.kind)) {
    return { required: true, reason: `policy: ${action.kind} requires approval`, quorum: 1 };
  }
  if (action.budget_overage) {
    return { required: true, reason: 'budget overage', quorum: 1 };
  }
  const threshold = autonomy.approval_cost_threshold_usd;
  if (threshold != null && action.est_cost_usd != null && action.est_cost_usd > threshold) {
    return { required: true, reason: `estimated cost $${action.est_cost_usd} over $${threshold}`, quorum: 1 };
  }
  return { required: false };
}

module.exports = { requiresApproval, configure, resetConfig, rules };
