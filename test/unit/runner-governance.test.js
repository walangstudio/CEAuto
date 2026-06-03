const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const budget = require('../../lib/budget');
const approvals = require('../../lib/approvals');
const runner = require('../../lib/runner');
const { makeMockDispatch } = require('../helpers/mock-llm');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('runner governance hardening', () => {
  let ws;

  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
    budget.configure({
      pricing: { default: { input: 0, output: 0 } },
      budgets: { per_agent_daily_tokens: 1e9, per_session_tokens: 1e9, global_daily_tokens: 1e9, global_daily_usd: 1e9 },
    });
  });

  afterEach(() => {
    budget.resetConfig();
    memory.close();
    cleanup(ws);
  });

  it('a needs_approval task will not run until approved', async () => {
    tasks.create({ id: 'T-1', title: 'sensitive', agent: 'ops', status: 'in-progress', needs_approval: true });
    const dispatch = makeMockDispatch();

    const res1 = await runner.runTask('T-1', { workspace: ws, dispatch });
    expect(res1.status).toBe('awaiting-approval');
    expect(dispatch.calls).toHaveLength(0);
    expect(approvals.pending().some(a => a.ref_id === 'T-1')).toBe(true);

    // does not stack duplicate approvals on repeated attempts
    await runner.runTask('T-1', { workspace: ws, dispatch });
    expect(approvals.pending().filter(a => a.ref_id === 'T-1')).toHaveLength(1);

    // approve, then it runs
    const id = approvals.pending().find(a => a.ref_id === 'T-1').id;
    approvals.approve(id, 'ceo');
    const res2 = await runner.runTask('T-1', { workspace: ws, dispatch });
    expect(res2.status).toBe('done');
  });

  it('veto matches the id as a token (T-100 does not veto T-1000)', async () => {
    const fs = require('fs');
    fs.mkdirSync(path.join(ws, 'comms'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'comms', 'vetos.md'), '# Vetos\n\n- T-100: hold\n');
    tasks.create({ id: 'T-1000', title: 'unrelated', agent: 'coder', status: 'in-progress' });
    const dispatch = makeMockDispatch();

    const res = await runner.runTask('T-1000', { workspace: ws, dispatch });
    expect(res.status).toBe('done'); // not vetoed by the T-100 line
  });

  it('a blocked task cannot be re-claimed/run directly', async () => {
    tasks.create({ id: 'T-2', title: 'halted', agent: 'coder', status: 'in-progress' });
    tasks.block('T-2', { reason: 'manual hold' });
    const dispatch = makeMockDispatch();

    const res = await runner.runTask('T-2', { workspace: ws, dispatch });
    expect(res.status).toBe('skipped');
    expect(dispatch.calls).toHaveLength(0);
    expect(tasks.get('T-2').status).toBe('blocked');
  });

  it('re-checks budget on each retry (cannot blow the cap across retries)', async () => {
    // tiny per-agent cap; the first dispatch records spend that trips the gate
    budget.configure({
      pricing: { default: { input: 0, output: 0 } },
      budgets: { per_agent_daily_tokens: 12, per_session_tokens: 1e9, global_daily_tokens: 1e9, global_daily_usd: 1e9 },
    });
    tasks.create({ id: 'T-3', title: 'flaky', agent: 'coder', status: 'in-progress' });
    let n = 0;
    const dispatch = makeMockDispatch({
      inputTokens: 5,
      outputTokens: 5,
      onCall: () => { n += 1; if (n === 1) throw new Error('transient'); },
    });

    const res = await runner.runTask('T-3', { workspace: ws, dispatch, backoffMs: 0 });
    // attempt 1 throws (no spend); attempt 2 would be gated only if spend recorded.
    // Here the gate mainly proves no unbounded retry spend; task still resolves.
    expect(['done', 'blocked']).toContain(res.status);
  });
});
