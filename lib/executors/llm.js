/**
 * llm executor — the default. Wraps llm-adapter.dispatch behind the executor
 * interface so the runner no longer special-cases LLM calls. deps.dispatch is
 * honored (tests inject a mock), keeping behaviour identical to before.
 *
 * It also surfaces any structured delegation directive the agent embedded in its
 * answer (Pillar 5) as { subtasks, escalate } — the runner enforces authority
 * and depth/fan-out caps before acting on it.
 *
 * ctx.route (Pillar 6, optional) is the learned dispatch policy's {model,provider}
 * override; passed straight to the adapter. Other executors ignore it.
 */

const { parseDirective } = require('../delegation');

async function llm(ctx, deps = {}) {
  const dispatch = deps.dispatch || require('../llm-adapter').dispatch;
  const { agent, agentSpec, task, context, route } = ctx;
  const { text, usage } = await dispatch(agent, agentSpec, task, context, route || {});
  const directive = parseDirective(text);
  return { text, usage, subtasks: directive?.subtasks, escalate: directive?.escalate };
}

module.exports = llm;
