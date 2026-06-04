const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const budget = require('../../lib/budget');
const heartbeat = require('../../lib/heartbeat');
const { makeMockDispatch } = require('../helpers/mock-llm');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('heartbeat DAG scheduling', () => {
  let ws;
  const settings = { autonomy: { self_evaluate: false } };

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

  it('runs a dependency chain in order within one cycle', async () => {
    tasks.create({ id: 'A', title: 'a', agent: 'researcher', status: 'backlog' });
    tasks.create({ id: 'B', title: 'b', agent: 'researcher', status: 'backlog', depends_on: ['A'] });
    tasks.create({ id: 'C', title: 'c', agent: 'researcher', status: 'backlog', depends_on: ['B'] });

    const dispatch = makeMockDispatch();
    const res = await heartbeat.runCycle({ workspace: ws, dispatch, maxTasks: 10, settings });

    expect(res.done).toBe(3);
    expect(res.results.map(r => r.id)).toEqual(['A', 'B', 'C']); // topological order
    expect(tasks.listByStatus('done')).toHaveLength(3);
  });

  it('does not run a dependent until its dep is done', async () => {
    tasks.create({ id: 'A', title: 'a', agent: 'researcher', status: 'backlog' });
    tasks.create({ id: 'B', title: 'b', agent: 'researcher', status: 'backlog', depends_on: ['A'] });

    const dispatch = makeMockDispatch();
    // Only allow one task to run this cycle.
    const res = await heartbeat.runCycle({ workspace: ws, dispatch, maxTasks: 1, settings });

    expect(res.ran).toBe(1);
    expect(res.results[0].id).toBe('A');
    expect(tasks.get('B').status).toBe('backlog'); // still waiting
  });

  it('blocks a dependency cycle instead of starving', async () => {
    tasks.create({ id: 'A', title: 'a', agent: 'researcher', status: 'backlog', depends_on: ['B'] });
    tasks.create({ id: 'B', title: 'b', agent: 'researcher', status: 'backlog', depends_on: ['A'] });

    const dispatch = makeMockDispatch();
    const res = await heartbeat.runCycle({ workspace: ws, dispatch, maxTasks: 10, settings });

    expect(res.deadlocked).toBe(2);
    expect(res.ran).toBe(0);
    expect(tasks.get('A').status).toBe('blocked');
    expect(tasks.get('B').status).toBe('blocked');
    expect(tasks.get('A').blocker).toMatch(/cycle/);
    expect(dispatch.calls).toHaveLength(0);
  });

  it('blocks a task with an unknown dependency', async () => {
    tasks.create({ id: 'B', title: 'b', agent: 'researcher', status: 'backlog', depends_on: ['ghost'] });
    const dispatch = makeMockDispatch();
    const res = await heartbeat.runCycle({ workspace: ws, dispatch, maxTasks: 10, settings });

    expect(res.deadlocked).toBe(1);
    expect(tasks.get('B').status).toBe('blocked');
    expect(tasks.get('B').blocker).toMatch(/unknown dependency/);
  });
});
