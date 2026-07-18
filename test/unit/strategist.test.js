/**
 * Tests for the generative autonomy step (lib/strategist.js) and its heartbeat
 * integration + the comms/STOP kill switch.
 */

const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const budget = require('../../lib/budget');
const events = require('../../lib/events');
const strategist = require('../../lib/strategist');
const heartbeat = require('../../lib/heartbeat');
const { makeMockDispatch } = require('../helpers/mock-llm');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

// A mock plan: the LLM answers with a fenced ceauto directive of two tasks.
const DIRECTIVE =
  '```ceauto\n' +
  JSON.stringify({ subtasks: [
    { title: 'Research the market', description: 'gather sizing data', agent: 'researcher' },
    { title: 'Analyze findings', description: 'synthesize', agent: 'analyst' },
  ] }) +
  '\n```';

const planDispatch = () => makeMockDispatch({ responder: () => DIRECTIVE });

describe('strategist.generateTasks', () => {
  let ws;
  beforeEach(() => {
    ws = makeTmpWorkspace({ 'strategy/goals.md': '# Goals\n\nShip the MVP.\n' });
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

  it('turns goals into backlog tasks, dry-run (needs_approval) by default', async () => {
    const res = await strategist.generateTasks({
      workspace: ws, dispatch: planDispatch(),
      settings: { autonomy: { pursue_goals: true, strategy_min_interval_minutes: 0 } },
    });
    expect(res.generated).toHaveLength(2);
    const all = tasks.all();
    expect(all).toHaveLength(2);
    expect(all.every(t => t.status === 'backlog')).toBe(true);
    expect(all.every(t => t.needs_approval === 1)).toBe(true); // dry-run
    // audit events emitted
    expect(events.list().filter(e => e.type === 'strategy.generated')).toHaveLength(2);
    expect(events.list().filter(e => e.type === 'strategy.planned')).toHaveLength(1);
  });

  it('auto_run_generated:true creates tasks that need no approval', async () => {
    const res = await strategist.generateTasks({
      workspace: ws, dispatch: planDispatch(),
      settings: { autonomy: { auto_run_generated: true, strategy_min_interval_minutes: 0 } },
    });
    expect(res.autoRun).toBe(true);
    expect(tasks.all().every(t => t.needs_approval === 0)).toBe(true);
  });

  it('enforces the daily generation cap', async () => {
    const settings = { autonomy: { max_generated_tasks_per_day: 2, strategy_min_interval_minutes: 0 } };
    const first = await strategist.generateTasks({ workspace: ws, dispatch: planDispatch(), settings });
    expect(first.generated).toHaveLength(2);
    const second = await strategist.generateTasks({ workspace: ws, dispatch: planDispatch(), settings });
    expect(second.generated).toHaveLength(0);
    expect(second.skipped).toBe('cap');
    expect(tasks.all()).toHaveLength(2); // no more originated
  });

  it('respects the re-plan cooldown', async () => {
    const settings = { autonomy: {} }; // default 30-min cooldown
    await strategist.generateTasks({ workspace: ws, dispatch: planDispatch(), settings });
    const again = await strategist.generateTasks({ workspace: ws, dispatch: planDispatch(), settings });
    expect(again.skipped).toBe('cooldown');
  });

  it('skips when the budget is paused (planning call is gated too)', async () => {
    budget.pause('manual hold');
    const res = await strategist.generateTasks({
      workspace: ws, dispatch: planDispatch(),
      settings: { autonomy: { strategy_min_interval_minutes: 0 } },
    });
    expect(res.skipped).toBe('budget');
    expect(tasks.all()).toHaveLength(0);
  });

  it('bills the planning call even when the plan yields nothing', async () => {
    const dispatch = makeMockDispatch({ responder: () => 'sorry, no plan today' }); // parseDirective -> null
    const res = await strategist.generateTasks({
      workspace: ws, dispatch, settings: { autonomy: { strategy_min_interval_minutes: 0 } },
    });
    expect(res.generated).toHaveLength(0);
    expect(tasks.all()).toHaveLength(0);
    const led = memory.getDb().prepare("SELECT COUNT(*) AS n FROM budget_ledger WHERE session_id = 'strategist'").get();
    expect(led.n).toBe(1); // spend is recorded so the caps can see it
  });

  it('caps planning CALLS per day, so zero-yield plans cannot re-spend forever', async () => {
    const dispatch = makeMockDispatch({ responder: () => 'no directive' });
    const settings = { autonomy: { max_plans_per_day: 2, strategy_min_interval_minutes: 0 } };
    await strategist.generateTasks({ workspace: ws, dispatch, settings });
    await strategist.generateTasks({ workspace: ws, dispatch, settings });
    const third = await strategist.generateTasks({ workspace: ws, dispatch, settings });
    expect(third.skipped).toBe('plan-cap');
    const led = memory.getDb().prepare("SELECT COUNT(*) AS n FROM budget_ledger WHERE session_id = 'strategist'").get();
    expect(led.n).toBe(2); // the third never dispatched
  });

  it('falls back to the strategy agent for an unknown agent and records the request', async () => {
    const bad = '```ceauto\n' + JSON.stringify({ subtasks: [{ title: 'do a thing', agent: 'wizard' }] }) + '\n```';
    await strategist.generateTasks({
      workspace: ws, dispatch: makeMockDispatch({ responder: () => bad }),
      settings: { autonomy: { strategy_agent: 'analyst', strategy_min_interval_minutes: 0 } },
    });
    expect(tasks.all()[0].agent).toBe('analyst');
    const ev = events.list().find(e => e.type === 'strategy.generated');
    expect(ev.payload.requested_agent).toBe('wizard');
  });

  it('skips when no goals are set', async () => {
    const bare = makeTmpWorkspace(); // no strategy files
    memory.close();
    memory.init(path.join(bare, 'db', 'memory.sqlite'));
    const res = await strategist.generateTasks({
      workspace: bare, dispatch: planDispatch(),
      settings: { autonomy: { strategy_min_interval_minutes: 0 } },
    });
    expect(res.skipped).toBe('no-goals');
    cleanup(bare);
  });
});

describe('heartbeat integration', () => {
  let ws;
  beforeEach(() => {
    ws = makeTmpWorkspace({ 'strategy/goals.md': '# Goals\n\nShip the MVP.\n' });
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

  it('generates tasks from goals when the queue is idle (pursue_goals)', async () => {
    const res = await heartbeat.runCycle({
      workspace: ws, dispatch: planDispatch(),
      settings: { autonomy: { self_evaluate: false, pursue_goals: true, strategy_min_interval_minutes: 0 } },
    });
    expect(res.generated).toBe(2);
    expect(tasks.all()).toHaveLength(2);
    expect(tasks.listByStatus('done')).toHaveLength(0); // dry-run: await approval, not run
  });

  it('does not regenerate while generated tasks are still pending (anti-flood)', async () => {
    const settings = { autonomy: { self_evaluate: false, pursue_goals: true, strategy_min_interval_minutes: 0 } };
    const r1 = await heartbeat.runCycle({ workspace: ws, dispatch: planDispatch(), settings });
    expect(r1.generated).toBe(2);
    // cooldown disabled, so ONLY the idle-gate (pending dry-run tasks) stops re-planning
    const r2 = await heartbeat.runCycle({ workspace: ws, dispatch: planDispatch(), settings });
    expect(r2.generated).toBe(0);
    expect(tasks.all()).toHaveLength(2);
  });

  it('does NOT generate when pursue_goals is off', async () => {
    const res = await heartbeat.runCycle({
      workspace: ws, dispatch: planDispatch(),
      settings: { autonomy: { self_evaluate: false } },
    });
    expect(res.generated).toBe(0);
    expect(tasks.all()).toHaveLength(0);
  });

  it('pending dry-run tasks do not starve a real task of its cycle slot', async () => {
    // two gated tasks created first (older) sit ahead of one runnable task; with
    // maxTasks=1 the gated no-ops must NOT consume the only real-work slot.
    tasks.create({ id: 'G-1', title: 'gated 1', agent: 'researcher', status: 'backlog', needs_approval: true });
    tasks.create({ id: 'G-2', title: 'gated 2', agent: 'researcher', status: 'backlog', needs_approval: true });
    tasks.create({ id: 'R-1', title: 'real work', agent: 'researcher', status: 'backlog' });
    const res = await heartbeat.runCycle({
      workspace: ws, dispatch: makeMockDispatch(), maxTasks: 1,
      settings: { autonomy: { self_evaluate: false } },
    });
    expect(tasks.get('R-1').status).toBe('done'); // ran despite the gated pool ahead of it
    expect(res.done).toBe(1);
  });

  it('comms/STOP halts the whole cycle', async () => {
    const halted = makeTmpWorkspace({ 'comms/STOP': '' });
    memory.close();
    memory.init(path.join(halted, 'db', 'memory.sqlite'));
    tasks.create({ id: 'T-1', title: 'work', agent: 'researcher', status: 'backlog' });
    const dispatch = makeMockDispatch();
    const res = await heartbeat.runCycle({ workspace: halted, dispatch, settings: { autonomy: { self_evaluate: false } } });
    expect(res.halted).toBe(true);
    expect(res.ran).toBe(0);
    expect(dispatch.calls).toHaveLength(0);
    cleanup(halted);
  });
});
