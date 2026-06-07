/**
 * executors/index.js — one interface, many runtimes.
 *
 * execute(executorId, ctx, deps) -> { text, usage }
 *   ctx:  { agent, agentSpec, task, context, params, route? }
 *   deps: { dispatch?, shellAllowlist? }
 *
 * Budget, approval, veto and self-eval all wrap this uniformly in the runner —
 * an agent's runtime is just a config choice.
 */

const llm = require('./llm');
const shell = require('./shell');
const mcpTool = require('./mcp-tool');
const webhook = require('./webhook');
const claudeCode = require('./claude-code');
const composite = require('./composite');

const REGISTRY = {
  llm,
  shell,
  'mcp-tool': mcpTool,
  webhook,
  'http-webhook': webhook,
  'claude-code': claudeCode,
  composite,
};

function resolve(executorId) {
  return REGISTRY[executorId] || null;
}

async function execute(executorId, ctx, deps = {}) {
  const ex = REGISTRY[executorId] || REGISTRY.llm;
  return ex(ctx, deps);
}

module.exports = { execute, resolve, REGISTRY };
