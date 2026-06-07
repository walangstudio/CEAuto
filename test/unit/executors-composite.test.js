const executors = require('../../lib/executors');

// A dispatch mock whose answer depends on the context it receives, so we can
// prove chain mode feeds each step's output into the next.
function contextAwareDispatch() {
  const calls = [];
  async function dispatch(agentId, agentSpec, task, context = '') {
    calls.push({ agentId, task, context });
    const n = calls.length;
    return {
      text: `step${n}<<${context}>>`,
      usage: { input_tokens: 10, output_tokens: 5, model: 'mock-model', provider: 'mock' },
    };
  }
  dispatch.calls = calls;
  return dispatch;
}

describe('composite executor', () => {
  it('chains steps: each step sees the previous output, result is the last step', async () => {
    const dispatch = contextAwareDispatch();
    const res = await executors.execute(
      'composite',
      {
        agent: 'builder',
        agentSpec: 'spec',
        task: 'ship it',
        context: 'seed',
        params: { mode: 'chain', steps: [{ executor: 'llm' }, { executor: 'llm' }] },
      },
      { dispatch }
    );

    expect(dispatch.calls).toHaveLength(2);
    expect(dispatch.calls[0].context).toBe('seed'); // first step gets the seed only
    expect(dispatch.calls[1].context).toContain('prior step output'); // second sees step 1
    expect(dispatch.calls[1].context).toContain('step1<<seed>>');
    expect(res.text.startsWith('step2<<')).toBe(true); // pipeline result = last step
    expect(res.text).toContain('step1<<seed>>'); // and it carries the chained input
  });

  it('sums usage across steps and marks the ledger as composite', async () => {
    const dispatch = contextAwareDispatch();
    const res = await executors.execute(
      'composite',
      { agent: 'builder', agentSpec: '', task: 't', context: '', params: { steps: [{ executor: 'llm' }, { executor: 'llm' }, { executor: 'llm' }] } },
      { dispatch }
    );
    expect(res.usage.input_tokens).toBe(30); // 3 * 10
    expect(res.usage.output_tokens).toBe(15); // 3 * 5
    expect(res.usage.provider).toBe('composite');
    expect(res.usage.model).toBe('composite(llm+llm+llm)');
  });

  it('map mode runs every step on the same input and reduces to one document', async () => {
    const dispatch = contextAwareDispatch();
    const res = await executors.execute(
      'composite',
      { agent: 'builder', agentSpec: '', task: 't', context: 'X', params: { mode: 'map', steps: [{ executor: 'llm' }, { executor: 'llm' }] } },
      { dispatch }
    );
    expect(dispatch.calls[0].context).toBe('X');
    expect(dispatch.calls[1].context).toBe('X'); // map: no chaining, both see the original
    expect(res.text).toContain('## Step 1 (llm)');
    expect(res.text).toContain('## Step 2 (llm)');
  });

  it('defaults to chain mode when no mode is given', async () => {
    const dispatch = contextAwareDispatch();
    await executors.execute(
      'composite',
      { agent: 'b', agentSpec: '', task: 't', context: 'C', params: { steps: [{ executor: 'llm' }, { executor: 'llm' }] } },
      { dispatch }
    );
    expect(dispatch.calls[1].context).toContain('prior step output'); // chained, not map
  });

  it('propagates a step failure (runner then retries the whole chain)', async () => {
    let n = 0;
    const dispatch = () => {
      n += 1;
      if (n === 2) throw new Error('step 2 boom');
      return Promise.resolve({ text: 'ok', usage: { input_tokens: 1, output_tokens: 1 } });
    };
    await expect(
      executors.execute('composite', { agent: 'b', agentSpec: '', task: 't', context: '', params: { steps: [{ executor: 'llm' }, { executor: 'llm' }] } }, { dispatch })
    ).rejects.toThrow(/step 2 boom/);
  });

  it('rejects an empty step list', async () => {
    await expect(
      executors.execute('composite', { agent: 'x', task: 't', params: { steps: [] } }, {})
    ).rejects.toThrow(/non-empty/);
  });

  it('rejects a nested composite step (no unbounded recursion)', async () => {
    await expect(
      executors.execute('composite', { agent: 'x', task: 't', params: { steps: [{ executor: 'composite' }] } }, {})
    ).rejects.toThrow(/nested composite/);
  });

  it('rejects too many steps', async () => {
    const steps = Array.from({ length: 11 }, () => ({ executor: 'llm' }));
    await expect(
      executors.execute('composite', { agent: 'x', task: 't', params: { steps } }, { dispatch: contextAwareDispatch() })
    ).rejects.toThrow(/too many steps/);
  });
});
