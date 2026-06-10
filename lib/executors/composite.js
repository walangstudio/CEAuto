/**
 * composite executor (Pillar 1) — run an ordered list of executors as one task,
 * map/reduce style. The agent's `params` declare the steps:
 *
 *   params: {
 *     mode: 'chain' | 'map',          // default 'chain'
 *     steps: [
 *       { executor: 'llm' },
 *       { executor: 'shell', params: { command, args } },
 *       { executor: 'mcp-tool', agent: 'research-bot', params: {...} },
 *     ],
 *   }
 *
 * - chain (default): a pipeline — each step's text is fed to the next as extra
 *   context; the result is the LAST step's text (the pipeline's output).
 * - map: every step runs on the same input; the result is their texts reduced
 *   into one labelled document.
 *
 * Usage is summed across steps so the runner records the true total spend; the
 * ledger model/provider mark it as a composite. Budget/approval/veto still wrap
 * the WHOLE task in the runner — composite does not re-gate per step.
 *
 * Out of scope by design: composite does not surface a delegation directive
 * (only the llm executor does, for a single answer) and may not nest another
 * composite — both would invite unbounded fan-out/recursion.
 *
 * Cost: a composite's real spend is ~steps.length × a single dispatch, and the
 * runner re-runs the WHOLE chain from step 1 on a retry (it doesn't memoise
 * completed steps). The runner scales its pre-dispatch budget estimate by the
 * step count so the gate reflects the multi-step cost — but for an expensive LLM
 * chain prefer a conservative token cap or `needs_approval: true` on the task.
 */

const MAX_STEPS = 10;

async function composite(ctx, deps = {}) {
  // Lazy require: index.js requires this module, so resolving it at call time
  // (not load time) avoids the circular-init undefined-export trap.
  const { execute } = require('./index');

  const params = ctx.params || {};
  const steps = Array.isArray(params.steps) ? params.steps : [];
  if (!steps.length) {
    throw new Error('composite executor: params.steps must be a non-empty array');
  }
  if (steps.length > MAX_STEPS) {
    throw new Error(`composite executor: too many steps (${steps.length} > ${MAX_STEPS})`);
  }

  const mode = params.mode === 'map' ? 'map' : 'chain';
  const usage = { input_tokens: 0, output_tokens: 0 };
  const outputs = [];

  for (const step of steps) {
    const stepExecutorId = step.executor || 'llm';
    if (stepExecutorId === 'composite') {
      throw new Error('composite executor: nested composite steps are not allowed');
    }

    // chain feeds the previous step's output forward; map gives each the original.
    const prior = outputs.length ? outputs[outputs.length - 1].text : '';
    const stepContext =
      mode === 'chain' && prior
        ? `${ctx.context || ''}\n\n--- prior step output ---\n${prior}`
        : ctx.context;

    const out = await execute(
      stepExecutorId,
      {
        agent: step.agent || ctx.agent,
        agentSpec: ctx.agentSpec,
        task: ctx.task,
        context: stepContext,
        params: step.params || {},
        route: ctx.route, // only the llm step consumes it
      },
      deps
    );

    outputs.push({ executor: stepExecutorId, text: out.text || '' });
    usage.input_tokens += out.usage?.input_tokens || 0;
    usage.output_tokens += out.usage?.output_tokens || 0;
  }

  const text =
    mode === 'map'
      ? outputs.map((o, i) => `## Step ${i + 1} (${o.executor})\n${o.text}`).join('\n\n')
      : outputs[outputs.length - 1].text;

  return {
    text,
    usage: {
      ...usage,
      model: `composite(${steps.map(s => s.executor || 'llm').join('+')})`,
      provider: 'composite',
    },
  };
}

module.exports = composite;
