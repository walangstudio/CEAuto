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

describe('llm-adapter OpenAI-compatible dispatch', () => {
  const route = { model: 'meta/llama-3.3-70b-instruct', provider: 'openai' };
  let prevMock, prevKey, prevBase, prevFetch;

  beforeEach(() => {
    prevMock = process.env.CEAUTO_MOCK_LLM;
    prevKey = process.env.OPENAI_API_KEY;
    prevBase = process.env.OPENAI_BASE_URL;
    prevFetch = global.fetch;
    delete process.env.CEAUTO_MOCK_LLM; // hit the real provider switch, not the mock seam
    delete process.env.OPENAI_BASE_URL; // no leak from a prior test; each test sets its own
    process.env.OPENAI_API_KEY = 'test-key';
  });
  afterEach(() => {
    if (prevMock === undefined) delete process.env.CEAUTO_MOCK_LLM; else process.env.CEAUTO_MOCK_LLM = prevMock;
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = prevBase;
    global.fetch = prevFetch;
  });

  function mockFetch(body, { ok = true, status = 200 } = {}) {
    const fn = vi.fn(async () => ({
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }));
    global.fetch = fn;
    return fn;
  }

  it('posts to {base_url}/chat/completions with bearer auth and parses content', async () => {
    process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1';
    const fn = mockFetch({
      choices: [{ message: { content: 'hello world' } }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    });

    const { text, usage } = await dispatch('researcher', 'system-spec', 'do a thing', 'some ctx', route);

    expect(fn).toHaveBeenCalledTimes(1);
    const [url, opts] = fn.mock.calls[0];
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer test-key');
    const sent = JSON.parse(opts.body);
    expect(sent.model).toBe('meta/llama-3.3-70b-instruct');
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'system-spec' });
    expect(sent.messages[1].role).toBe('user');
    expect(text).toBe('hello world');
    expect(usage.input_tokens).toBe(11);
    expect(usage.output_tokens).toBe(7);
    expect(usage.provider).toBe('openai');
  });

  it('falls back to reasoning_content when content is empty (reasoning models)', async () => {
    mockFetch({ choices: [{ message: { content: '', reasoning_content: 'the answer' } }] });
    const { text } = await dispatch('researcher', 'spec', 'task', '', route);
    expect(text).toBe('the answer');
  });

  it('strips a trailing slash on the base_url before appending the path', async () => {
    process.env.OPENAI_BASE_URL = 'https://api.example.com/v1/';
    const fn = mockFetch({ choices: [{ message: { content: 'ok' } }] });
    await dispatch('researcher', 'spec', 'task', '', route);
    expect(fn.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('throws including the HTTP status on a non-ok response', async () => {
    mockFetch({ error: 'nope' }, { ok: false, status: 429 });
    await expect(dispatch('researcher', 'spec', 'task', '', route)).rejects.toThrow(/429/);
  });

  it('estimates usage when the response omits a usage block', async () => {
    mockFetch({ choices: [{ message: { content: 'abcd' } }] });
    const { usage } = await dispatch('researcher', 'spec', 'task', '', route);
    expect(usage.input_tokens).toBeGreaterThan(0);
    expect(usage.output_tokens).toBeGreaterThan(0);
  });
});
