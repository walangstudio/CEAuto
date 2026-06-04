/**
 * llm executor — the default. Wraps llm-adapter.dispatch behind the executor
 * interface so the runner no longer special-cases LLM calls. deps.dispatch is
 * honored (tests inject a mock), keeping behaviour identical to before.
 */

async function llm(ctx, deps = {}) {
  const dispatch = deps.dispatch || require('../llm-adapter').dispatch;
  const { agent, agentSpec, task, context } = ctx;
  const { text, usage } = await dispatch(agent, agentSpec, task, context);
  return { text, usage };
}

module.exports = llm;
