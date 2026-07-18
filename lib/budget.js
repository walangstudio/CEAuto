/**
 * budget.js — token + USD accounting and hard spend caps.
 *
 * Every LLM call is recorded to budget_ledger. Before a call the runner asks
 * canSpend(); a breach pauses autonomous execution (a runtime flag) so the
 * daemon stops spending until a human resumes. This lands BEFORE any loop so a
 * cost runaway is structurally impossible.
 */

const fs = require('fs');
const path = require('path');
const memory = require('./memory');

const PAUSE_KEY = 'budget_paused';

const DEFAULT_BUDGETS = {
  per_agent_daily_tokens: 200000,
  per_session_tokens: 100000,
  global_daily_tokens: 2000000,
  global_daily_usd: 25,
};

let CONFIG = null;

function loadFromDisk() {
  try {
    const yaml = require('js-yaml');
    const raw = fs.readFileSync(path.join(__dirname, '../config/providers.yaml'), 'utf-8');
    const doc = yaml.load(raw) || {};
    return {
      pricing: doc.pricing || { default: { input: 0, output: 0 } },
      budgets: { ...DEFAULT_BUDGETS, ...(doc.budgets || {}) },
    };
  } catch {
    return { pricing: { default: { input: 0, output: 0 } }, budgets: { ...DEFAULT_BUDGETS } };
  }
}

function getConfig() {
  if (!CONFIG) CONFIG = loadFromDisk();
  return CONFIG;
}

/** Override pricing/budgets (tests). */
function configure(partial = {}) {
  const base = getConfig();
  CONFIG = {
    pricing: partial.pricing || base.pricing,
    budgets: { ...base.budgets, ...(partial.budgets || {}) },
  };
}

function resetConfig() {
  CONFIG = null;
}

// Runtimes that don't spend our LLM API dollars — a local command (shell), an
// external worker (webhook), or another MCP server (mcp). Pricing their proxy
// token counts at pricing.default would accrue phantom USD against the global USD
// cap, so their spend is $0. NOTE: claude-code and composite are deliberately
// EXCLUDED — both can drive real LLM spend and must stay under the USD cap
// (composite is priced conservatively via pricing.default).
const NON_LLM_PROVIDERS = new Set(['shell', 'webhook', 'mcp']);

function priceFor(model, inputTokens, outputTokens) {
  const { pricing } = getConfig();
  const p = pricing[model] || pricing.default || { input: 0, output: 0 };
  return (inputTokens / 1000) * (p.input || 0) + (outputTokens / 1000) * (p.output || 0);
}

function db() {
  const d = memory.getDb();
  if (!d) throw new Error('memory not initialised — call memory.init() first');
  return d;
}

/**
 * Record one LLM call's usage. Returns { usd, input_tokens, output_tokens }.
 */
function record({ agent, task_id, session_id, provider, model, input_tokens = 0, output_tokens = 0 }) {
  const usd = NON_LLM_PROVIDERS.has(provider) ? 0 : priceFor(model, input_tokens, output_tokens);
  db().prepare(`
    INSERT INTO budget_ledger (agent, task_id, session_id, provider, model, input_tokens, output_tokens, usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(agent || null, task_id || null, session_id || null, provider || null, model || null, input_tokens, output_tokens, usd);
  return { usd, input_tokens, output_tokens };
}

function agg(where, params) {
  const row = db().prepare(`
    SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
           COALESCE(SUM(usd), 0) AS usd
    FROM budget_ledger ${where}
  `).get(...params);
  return { tokens: row.tokens, usd: row.usd };
}

function spentByAgent(agent, days = 1) {
  return agg("WHERE agent = ? AND created_at >= datetime('now', ?)", [agent, `-${days} days`]);
}

// Spend summed across a set of agents (a role's subtree) — used for role budget
// rollup in org.js.
function spentByAgents(agents, days = 1) {
  if (!agents || !agents.length) return { tokens: 0, usd: 0 };
  const placeholders = agents.map(() => '?').join(',');
  return agg(`WHERE agent IN (${placeholders}) AND created_at >= datetime('now', ?)`, [...agents, `-${days} days`]);
}

// Windowed by default: a long-lived daemon/server keeps ONE session_id for its
// whole life, so an all-time sum would eventually trip the per-session cap and
// globally pause autonomy. days=null keeps the all-time sum for callers that want it.
function spentBySession(sessionId, days = 1) {
  if (days == null) return agg('WHERE session_id = ?', [sessionId]);
  return agg("WHERE session_id = ? AND created_at >= datetime('now', ?)", [sessionId, `-${days} days`]);
}

function spentTotal(days = 1) {
  if (days == null) return agg('', []);
  return agg("WHERE created_at >= datetime('now', ?)", [`-${days} days`]);
}

function pause(reason = 'budget exceeded') {
  memory.setRuntime(PAUSE_KEY, reason);
}

function resume() {
  memory.setRuntime(PAUSE_KEY, '');
}

function isPaused() {
  return Boolean(memory.getRuntime(PAUSE_KEY));
}

function pauseReason() {
  return memory.getRuntime(PAUSE_KEY) || null;
}

/**
 * Can `agent` afford to spend ~estTokens more right now?
 * @returns {{ok:boolean, reason?:string}}
 */
function canSpend(agent, estTokens = 0, { sessionId } = {}) {
  if (isPaused()) return { ok: false, reason: `paused: ${pauseReason()}` };
  const { budgets } = getConfig();

  const total = spentTotal(1);
  if (total.tokens + estTokens > budgets.global_daily_tokens) {
    return { ok: false, reason: 'global daily token cap reached' };
  }
  // USD is gated on already-recorded spend (no per-call $ estimate available),
  // so use >= to block at the ceiling rather than one call past it.
  if (total.usd >= budgets.global_daily_usd) {
    return { ok: false, reason: 'global daily USD cap reached' };
  }
  if (agent) {
    const a = spentByAgent(agent, 1);
    if (a.tokens + estTokens > budgets.per_agent_daily_tokens) {
      return { ok: false, reason: `agent ${agent} daily token cap reached` };
    }
  }
  if (sessionId) {
    const s = spentBySession(sessionId);
    if (s.tokens + estTokens > budgets.per_session_tokens) {
      return { ok: false, reason: 'session token cap reached' };
    }
  }
  return { ok: true };
}

module.exports = {
  configure,
  resetConfig,
  priceFor,
  record,
  spentByAgent,
  spentByAgents,
  spentBySession,
  spentTotal,
  canSpend,
  pause,
  resume,
  isPaused,
  pauseReason,
};
