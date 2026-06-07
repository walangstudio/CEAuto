/**
 * Deterministic in-process replacement for llm-adapter.dispatch.
 * Returns the same { text, usage } shape the real adapter returns, so nothing
 * downstream (budget accounting, runner) can tell the difference — and tests
 * never call a real provider or spend money.
 */

function estimateTokens(s) {
  return Math.max(1, Math.ceil(String(s || '').length / 4));
}

/**
 * @param {Object} opts
 * @param {Function|string} [opts.responder] - (agentId, spec, task, context) => text, or a fixed string
 * @param {number} [opts.inputTokens] - force input token count
 * @param {number} [opts.outputTokens] - force output token count
 * @param {string} [opts.model]
 * @param {Function} [opts.onCall] - side effect per call (e.g. throw to simulate failure)
 */
function makeMockDispatch(opts = {}) {
  const calls = [];
  const responder =
    opts.responder ||
    ((agentId, _spec, task) => `[${agentId}] completed: ${String(task).slice(0, 80)}`);

  async function dispatch(agentId, agentSpec, task, context = '', route = {}) {
    calls.push({ agentId, agentSpec, task, context, route });
    if (opts.onCall) await opts.onCall(agentId, agentSpec, task, context, calls.length);
    const text =
      typeof responder === 'function'
        ? await responder(agentId, agentSpec, task, context)
        : responder;
    const input_tokens =
      opts.inputTokens ?? estimateTokens(`${agentSpec}\n${context}\n${task}`);
    const output_tokens = opts.outputTokens ?? estimateTokens(text);
    // Honour a route override (Pillar 6) so the ledger/tests see the routed pair,
    // exactly as the real adapter reflects it back in usage.
    return {
      text,
      usage: {
        input_tokens,
        output_tokens,
        model: (route && route.model) || opts.model || 'mock-model',
        provider: (route && route.provider) || 'mock',
      },
    };
  }

  dispatch.calls = calls;
  return dispatch;
}

module.exports = { makeMockDispatch, estimateTokens };
