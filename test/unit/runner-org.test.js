const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const budget = require('../../lib/budget');
const org = require('../../lib/org');
const runner = require('../../lib/runner');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('runner enforces role/department budgets', () => {
  let ws;
  const settings = { autonomy: { self_evaluate: false } };

  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
    budget.configure({
      pricing: { default: { input: 0, output: 0 } },
      budgets: { per_agent_daily_tokens: 1e9, per_session_tokens: 1e9, global_daily_tokens: 1e9, global_daily_usd: 1e9 },
    });
    org.configure({
      roles: {
        ceo: { budget: { daily_tokens: 1e9 }, can_delegate_to: ['eng'] },
        eng: { reports_to: 'ceo', members: ['coder'], budget: { daily_tokens: 100 } },
      },
    });
  });

  afterEach(() => {
    org.resetConfig();
    budget.resetConfig();
    memory.close();
    cleanup(ws);
  });

  it('blocks a task whose role envelope is already spent, without dispatching', () => {
    // Push the eng role over its 100-token cap.
    budget.record({ agent: 'coder', input_tokens: 120, output_tokens: 0, model: 'default' });

    tasks.create({ id: 'T-eng', title: 'eng task', agent: 'coder', status: 'in-progress' });
    const dispatch = (...a) => { dispatch.calls.push(a); return Promise.resolve({ text: 'x', usage: {} }); };
    dispatch.calls = [];

    return runner.runTask('T-eng', { workspace: ws, dispatch, settings }).then(res => {
      expect(res.status).toBe('blocked');
      expect(res.reason).toMatch(/role eng daily token cap/);
      expect(dispatch.calls).toHaveLength(0);
      expect(tasks.get('T-eng').status).toBe('blocked');
    });
  });

  it('does not globally pause on a role breach (siblings keep working)', () => {
    budget.record({ agent: 'coder', input_tokens: 120, output_tokens: 0, model: 'default' });
    tasks.create({ id: 'T-eng', title: 'eng task', agent: 'coder', status: 'in-progress' });
    const dispatch = () => Promise.resolve({ text: 'x', usage: {} });

    return runner.runTask('T-eng', { workspace: ws, dispatch, settings }).then(() => {
      expect(budget.isPaused()).toBe(false);
    });
  });

  it('runs normally when the role is under budget', () => {
    tasks.create({ id: 'T-ok', title: 'ok', agent: 'coder', status: 'in-progress' });
    const dispatch = () => Promise.resolve({ text: 'done', usage: { input_tokens: 1, output_tokens: 1, model: 'default', provider: 'mock' } });

    return runner.runTask('T-ok', { workspace: ws, dispatch, settings }).then(res => {
      expect(res.status).toBe('done');
    });
  });
});
