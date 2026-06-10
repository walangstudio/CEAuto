/**
 * org.js — the org chart as a graph (Pillar 2 / Phase C).
 *
 * Roles form a reporting tree (config/org.yaml). Agents bind to a role via its
 * `members`. The payoff over flat per-agent caps is the BUDGET ROLLUP: an
 * agent's spend counts against its own role and every ancestor up to the root,
 * so a department envelope bounds the sum of its members and the root bounds the
 * whole org. `can_delegate_to` encodes delegation authority for Pillar 5.
 *
 * Pure resolution + an injected spend function keep this fully unit-testable
 * offline; checkBudgets takes `spentByAgents` so it never imports the ledger.
 */

const fs = require('fs');
const path = require('path');

let CONFIG = null;

function loadFromDisk() {
  try {
    const yaml = require('js-yaml');
    const raw = fs.readFileSync(path.join(__dirname, '../config/org.yaml'), 'utf-8');
    const doc = yaml.load(raw) || {};
    return { roles: doc.roles || {} };
  } catch {
    return { roles: {} };
  }
}

function get() {
  if (!CONFIG) CONFIG = loadFromDisk();
  return CONFIG;
}

/** Override the org (tests). Pass { roles } or a full doc. */
function configure(doc = {}) {
  CONFIG = { roles: doc.roles || {} };
}

function resetConfig() {
  CONFIG = null;
}

function roles() {
  return get().roles;
}

/** The role an agent belongs to (the role whose members list it), or null. */
function roleOf(agent) {
  const all = roles();
  for (const [name, def] of Object.entries(all)) {
    if ((def.members || []).includes(agent)) return name;
  }
  return null;
}

/** [role, parent, …, root] following reports_to. Cycle-safe. */
function ancestorsOf(role) {
  const all = roles();
  const chain = [];
  const seen = new Set();
  let cur = role;
  while (cur && all[cur] && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = all[cur].reports_to;
  }
  return chain;
}

/** Direct + transitive child roles of a role (the subtree, inclusive). */
function descendantsOf(role) {
  const all = roles();
  const out = [role];
  const queue = [role];
  const seen = new Set([role]);
  while (queue.length) {
    const cur = queue.shift();
    for (const [name, def] of Object.entries(all)) {
      if (def.reports_to === cur && !seen.has(name)) {
        seen.add(name);
        out.push(name);
        queue.push(name);
      }
    }
  }
  return out;
}

/** Every agent in a role's subtree (its members + all descendant roles'). */
function agentsInRole(role) {
  const all = roles();
  const out = new Set();
  for (const r of descendantsOf(role)) {
    for (const m of (all[r] && all[r].members) || []) out.add(m);
  }
  return [...out];
}

function budgetOf(role) {
  const def = roles()[role];
  return (def && def.budget) || null;
}

/** May `fromRole` assign work to `toAgent` (resolved to its role)? */
function canDelegate(fromRole, toAgent) {
  const def = roles()[fromRole];
  if (!def) return true; // acting role not modelled → don't block (e.g. no org)
  const toRole = roleOf(toAgent);
  // The acting role IS modelled, so the org is authoritative: an unknown target
  // (e.g. a hallucinated agent name) is not delegable.
  if (!toRole) return false;
  const allowed = def.can_delegate_to || [];
  return allowed.includes(toRole);
}

/** Optional per-role executor/model the runner can fall back to. */
function executorFor(agent) {
  const def = roles()[roleOf(agent)];
  return (def && def.executor) || null;
}

/**
 * Role budget gate: would `agent` spending ~estTokens breach its role or any
 * ancestor role's daily envelope? `spentByAgents(agents, days)` is injected
 * (budget.spentByAgents in prod) so this stays ledger-agnostic.
 * @returns {{ok:boolean, reason?:string}}
 */
function checkBudgets(agent, estTokens, { spentByAgents }) {
  const role = roleOf(agent);
  if (!role) return { ok: true };
  for (const r of ancestorsOf(role)) {
    const b = budgetOf(r);
    if (!b) continue;
    // Each ancestor owns a DIFFERENT agent subtree, so these sums are distinct.
    // Operator split mirrors budget.js: tokens add the per-call estimate (`>`);
    // USD has no per-call estimate so it blocks at the ceiling (`>=`).
    const spent = spentByAgents(agentsInRole(r), 1);
    if (b.daily_tokens != null && spent.tokens + estTokens > b.daily_tokens) {
      return { ok: false, reason: `role ${r} daily token cap reached` };
    }
    if (b.daily_usd != null && spent.usd >= b.daily_usd) {
      return { ok: false, reason: `role ${r} daily USD cap reached` };
    }
  }
  return { ok: true };
}

/** Org tree with per-role budget + live spend, for the ceo_org tool/report. */
function tree({ spentByAgents } = {}) {
  const all = roles();
  return Object.entries(all).map(([name, def]) => {
    const node = {
      role: name,
      title: def.title || name,
      reports_to: def.reports_to || null,
      members: def.members || [],
      budget: def.budget || null,
      can_delegate_to: def.can_delegate_to || [],
    };
    if (spentByAgents) node.spent = spentByAgents(agentsInRole(name), 1);
    return node;
  });
}

module.exports = {
  configure,
  resetConfig,
  roles,
  roleOf,
  ancestorsOf,
  descendantsOf,
  agentsInRole,
  budgetOf,
  canDelegate,
  executorFor,
  checkBudgets,
  tree,
};
