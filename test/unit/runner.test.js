const fs = require('fs');
const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const budget = require('../../lib/budget');
const runner = require('../../lib/runner');
const { makeMockDispatch } = require('../helpers/mock-llm');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('runner.runTask', () => {
  let ws;

  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
    budget.configure({
      pricing: { default: { input: 0, output: 0 } },
      budgets: {
        per_agent_daily_tokens: 1e9,
        per_session_tokens: 1e9,
        global_daily_tokens: 1e9,
        global_daily_usd: 1e9,
      },
    });
  });

  afterEach(() => {
    budget.resetConfig();
    memory.close();
    cleanup(ws);
  });

  it('runs a task to done, writes the result, and records spend', async () => {
    tasks.create({ id: 'T-1', title: 'Summarise market', agent: 'researcher', status: 'in-progress' });
    const dispatch = makeMockDispatch({ responder: () => 'Market is large.', outputTokens: 10, inputTokens: 20 });

    const res = await runner.runTask('T-1', { workspace: ws, dispatch });

    expect(res.status).toBe('done');
    expect(tasks.get('T-1').status).toBe('done');
    expect(fs.readFileSync(path.join(ws, res.resultPath), 'utf-8')).toBe('Market is large.');
    expect(budget.spentByAgent('researcher').tokens).toBe(30);
  });

  it('retries on failure then succeeds', async () => {
    tasks.create({ id: 'T-2', title: 'flaky', agent: 'coder', status: 'in-progress' });
    let n = 0;
    const dispatch = makeMockDispatch({
      onCall: () => {
        n += 1;
        if (n === 1) throw new Error('transient');
      },
      responder: () => 'second try worked',
    });

    const res = await runner.runTask('T-2', { workspace: ws, dispatch, backoffMs: 0 });
    expect(res.status).toBe('done');
    expect(n).toBe(2);
  });

  it('blocks the task after exhausting retries', async () => {
    tasks.create({ id: 'T-3', title: 'doomed', agent: 'coder', status: 'in-progress' });
    const dispatch = makeMockDispatch({ onCall: () => { throw new Error('always fails'); } });

    const res = await runner.runTask('T-3', {
      workspace: ws,
      dispatch,
      backoffMs: 0,
      settings: { autonomy: { max_retries_per_agent: 1 } },
    });
    expect(res.status).toBe('blocked');
    expect(tasks.get('T-3').status).toBe('blocked');
    expect(tasks.get('T-3').attempts).toBe(2); // initial + 1 retry
  });

  it('blocks on a timeout', async () => {
    tasks.create({ id: 'T-4', title: 'slow', agent: 'coder', status: 'in-progress' });
    const dispatch = () => new Promise(() => {}); // never resolves

    const res = await runner.runTask('T-4', {
      workspace: ws,
      dispatch,
      timeoutMs: 50,
      backoffMs: 0,
      settings: { autonomy: { max_retries_per_agent: 0 } },
    });
    expect(res.status).toBe('blocked');
    expect(res.reason).toMatch(/timed out/);
  });

  it('skips a task already claimed by another worker', async () => {
    tasks.create({ id: 'T-5', title: 'taken', agent: 'coder', status: 'in-progress' });
    tasks.claim('T-5', 'other-worker');
    const dispatch = makeMockDispatch();

    const res = await runner.runTask('T-5', { workspace: ws, dispatch });
    expect(res.status).toBe('skipped');
    expect(dispatch.calls).toHaveLength(0);
  });

  function seedHistory(agent, model, provider, n = 4) {
    const db = memory.getDb();
    const evalRow = db.prepare('INSERT INTO evals (task_id, agent, score, rubric, feedback) VALUES (?, ?, ?, ?, ?)');
    const ledRow = db.prepare('INSERT INTO budget_ledger (agent, task_id, provider, model, usd, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, 0, 0)');
    for (let i = 0; i < n; i++) {
      evalRow.run(`${model}-${i}`, agent, 5, 'q', 'good');
      ledRow.run(agent, `${model}-${i}`, provider, model, 0.001);
    }
  }

  it('auto-routes to the cheapest historically-good model when enabled', async () => {
    seedHistory('researcher', 'haiku', 'anthropic');
    tasks.create({ id: 'T-R1', title: 'route me', agent: 'researcher', status: 'in-progress' });
    const dispatch = makeMockDispatch({ responder: () => 'done' });

    const res = await runner.runTask('T-R1', {
      workspace: ws, dispatch,
      settings: { dispatch: { auto_route: true } },
    });

    expect(res.status).toBe('done');
    expect(dispatch.calls.at(-1).route).toEqual({ model: 'haiku', provider: 'anthropic' });
    expect(res.usage.model).toBe('haiku'); // ledger sees the routed model
  });

  it('does not route when auto_route is off, even with history', async () => {
    seedHistory('researcher', 'haiku', 'anthropic');
    tasks.create({ id: 'T-R2', title: 'no route', agent: 'researcher', status: 'in-progress' });
    const dispatch = makeMockDispatch({ responder: () => 'done' });

    const res = await runner.runTask('T-R2', { workspace: ws, dispatch });

    expect(res.status).toBe('done');
    expect(dispatch.calls.at(-1).route).toEqual({}); // no override passed
    expect(res.usage.model).toBe('mock-model'); // configured/default model
  });

  it('falls back to config when auto_route is on but there is no signal', async () => {
    tasks.create({ id: 'T-R3', title: 'cold start', agent: 'researcher', status: 'in-progress' });
    const dispatch = makeMockDispatch({ responder: () => 'done' });

    const res = await runner.runTask('T-R3', {
      workspace: ws, dispatch,
      settings: { dispatch: { auto_route: true } },
    });

    expect(res.status).toBe('done');
    expect(dispatch.calls.at(-1).route).toEqual({}); // recommendDispatch -> null -> {}
    expect(res.usage.model).toBe('mock-model');
  });

  it('blocks and pauses when budget is exhausted', async () => {
    budget.configure({
      pricing: { default: { input: 0, output: 0 } },
      budgets: { per_agent_daily_tokens: 1, per_session_tokens: 1e9, global_daily_tokens: 1e9, global_daily_usd: 1e9 },
    });
    tasks.create({ id: 'T-6', title: 'too costly', agent: 'coder', status: 'in-progress' });
    const dispatch = makeMockDispatch();

    const res = await runner.runTask('T-6', { workspace: ws, dispatch });
    expect(res.status).toBe('blocked');
    expect(res.reason).toMatch(/cap/);
    expect(budget.isPaused()).toBe(true);
    expect(dispatch.calls).toHaveLength(0);
  });
});
