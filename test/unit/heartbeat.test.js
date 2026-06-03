const fs = require('fs');
const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const budget = require('../../lib/budget');
const heartbeat = require('../../lib/heartbeat');
const { makeMockDispatch } = require('../helpers/mock-llm');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('heartbeat.runCycle', () => {
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

  function seed(n) {
    for (let i = 1; i <= n; i++) {
      tasks.create({ id: `T-${i}`, title: `task ${i}`, agent: 'researcher', status: 'backlog' });
    }
  }

  it('runs up to maxTasks and leaves the rest queued', async () => {
    seed(4);
    const dispatch = makeMockDispatch();
    const res = await heartbeat.runCycle({
      workspace: ws,
      dispatch,
      maxTasks: 2,
      settings: { autonomy: { self_evaluate: false } },
    });
    expect(res.ran).toBe(2);
    expect(res.done).toBe(2);
    expect(tasks.listByStatus('done')).toHaveLength(2);
    expect(tasks.listActionable().length).toBe(2); // remaining
    expect(fs.existsSync(path.join(ws, 'reports', 'heartbeat-log.md'))).toBe(true);
  });

  it('does nothing while budget is paused', async () => {
    seed(2);
    budget.pause('manual');
    const dispatch = makeMockDispatch();
    const res = await heartbeat.runCycle({ workspace: ws, dispatch, settings: { autonomy: { self_evaluate: false } } });
    expect(res.paused).toBe(true);
    expect(res.ran).toBe(0);
    expect(dispatch.calls).toHaveLength(0);
  });

  it('stops at the per-heartbeat token budget', async () => {
    seed(5);
    // each mock call ~ a few tokens; cap at 1 token forces a single task
    const dispatch = makeMockDispatch({ inputTokens: 5, outputTokens: 5 });
    const res = await heartbeat.runCycle({
      workspace: ws,
      dispatch,
      maxTasks: 5,
      perHeartbeatTokens: 1,
      settings: { autonomy: { self_evaluate: false } },
    });
    expect(res.ran).toBe(1); // budget tripped after the first
  });
});
