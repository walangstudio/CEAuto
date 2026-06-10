const { dispatch } = require('../../lib/llm-adapter');

describe('llm-adapter dispatch route override (Pillar 6)', () => {
  let prev;
  beforeEach(() => {
    prev = process.env.CEAUTO_MOCK_LLM;
    process.env.CEAUTO_MOCK_LLM = '1'; // mock seam: no real provider, no spend
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.CEAUTO_MOCK_LLM;
    else process.env.CEAUTO_MOCK_LLM = prev;
  });

  it('uses the configured model when no route is given (back-compat)', async () => {
    const { usage } = await dispatch('researcher', 'spec', 'task', 'ctx');
    expect(usage.model).toBe('mock-model');
    expect(usage.provider).toBe('mock');
  });

  it('applies a complete {model, provider} route', async () => {
    const { usage } = await dispatch('researcher', 'spec', 'task', 'ctx', { model: 'haiku', provider: 'anthropic' });
    expect(usage.model).toBe('haiku');
    expect(usage.provider).toBe('anthropic');
  });

  it('ignores a partial route (model without provider) to avoid a cross-provider mismatch', async () => {
    const { usage } = await dispatch('researcher', 'spec', 'task', 'ctx', { model: 'haiku' });
    expect(usage.model).toBe('mock-model'); // fell back to config, did NOT keep the orphan model
    expect(usage.provider).toBe('mock');
  });

  it('ignores a partial route (provider without model)', async () => {
    const { usage } = await dispatch('researcher', 'spec', 'task', 'ctx', { provider: 'openai' });
    expect(usage.model).toBe('mock-model');
    expect(usage.provider).toBe('mock');
  });
});
