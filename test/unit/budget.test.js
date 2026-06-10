const path = require('path');
const memory = require('../../lib/memory');
const budget = require('../../lib/budget');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('budget accounting', () => {
  let ws;

  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
    budget.configure({
      pricing: { default: { input: 1, output: 2 } }, // $1/1k in, $2/1k out
      budgets: {
        per_agent_daily_tokens: 1000,
        per_session_tokens: 500,
        global_daily_tokens: 5000,
        global_daily_usd: 100,
      },
    });
  });

  afterEach(() => {
    memory.resetConfig?.();
    budget.resetConfig();
    memory.close();
    cleanup(ws);
  });

  it('prices and records a call', () => {
    const r = budget.record({ agent: 'coder', model: 'x', input_tokens: 1000, output_tokens: 1000 });
    expect(r.usd).toBeCloseTo(3, 6); // 1*1 + 1*2
    expect(budget.spentByAgent('coder').tokens).toBe(2000);
    expect(budget.spentTotal().usd).toBeCloseTo(3, 6);
  });

  it('enforces the per-agent daily token cap', () => {
    budget.record({ agent: 'coder', model: 'x', input_tokens: 600, output_tokens: 300 }); // 900
    expect(budget.canSpend('coder', 50).ok).toBe(true);
    expect(budget.canSpend('coder', 200).ok).toBe(false); // 900+200 > 1000
  });

  it('enforces the per-session cap', () => {
    budget.record({ agent: 'coder', session_id: 's1', model: 'x', input_tokens: 400, output_tokens: 0 });
    const res = budget.canSpend('coder', 200, { sessionId: 's1' });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/session/);
  });

  it('pause blocks all spend until resumed', () => {
    budget.pause('manual hold');
    expect(budget.isPaused()).toBe(true);
    expect(budget.canSpend('coder', 1).ok).toBe(false);
    budget.resume();
    expect(budget.isPaused()).toBe(false);
    expect(budget.canSpend('coder', 1).ok).toBe(true);
  });
});
