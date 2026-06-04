/**
 * executors/index.js — one interface, many runtimes.
 *
 * execute(executorId, ctx, deps) -> { text, usage }
 *   ctx:  { agent, agentSpec, task, context, params }
 *   deps: { dispatch?, shellAllowlist? }
 *
 * Budget, approval, veto and self-eval all wrap this uniformly in the runner —
 * an agent's runtime is just a config choice.
 */

const llm = require('./llm');
const shell = require('./shell');
const mcpTool = require('./mcp-tool');

const REGISTRY = {
  llm,
  shell,
  'mcp-tool': mcpTool,
};

function resolve(executorId) {
  return REGISTRY[executorId] || null;
}

async function execute(executorId, ctx, deps = {}) {
  const ex = REGISTRY[executorId] || REGISTRY.llm;
  return ex(ctx, deps);
}

module.exports = { execute, resolve, REGISTRY };
