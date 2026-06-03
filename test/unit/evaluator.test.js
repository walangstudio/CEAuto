const fs = require('fs');
const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const budget = require('../../lib/budget');
const evaluator = require('../../lib/evaluator');
const { makeMockDispatch } = require('../helpers/mock-llm');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('evaluator.selfEval', () => {
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

  it('parses scores in several shapes', () => {
    expect(evaluator.parseScore('5 - great')).toBe(5);
    expect(evaluator.parseScore('Rating: 2/5, weak')).toBe(2);
    expect(evaluator.parseScore('no number here')).toBe(4);
    expect(evaluator.parseScore('9 out of nowhere')).toBe(4); // no 1-5 digit -> default
  });

  it('high score logs goal progress, task stays done', async () => {
    const task = tasks.create({ id: 'T-1', title: 'Write brief', agent: 'writer', status: 'done' });
    const dispatch = makeMockDispatch({ responder: () => '5 — excellent and complete' });

    const res = await evaluator.selfEval({ task, output: 'great work', deps: { workspace: ws, dispatch } });
    expect(res.score).toBe(5);
    expect(tasks.get('T-1').status).toBe('done');
    expect(fs.readFileSync(path.join(ws, 'strategy', 'goals.md'), 'utf-8')).toContain('T-1');
  });

  it('low score requeues the task (bounded by attempts)', async () => {
    const task = tasks.create({ id: 'T-2', title: 'Weak draft', agent: 'writer', status: 'done' });
    const dispatch = makeMockDispatch({ responder: () => '2 — misses the criteria' });

    const res = await evaluator.selfEval({
      task,
      output: 'meh',
      deps: { workspace: ws, dispatch, evalThreshold: 3, maxEvalRetries: 2 },
    });
    expect(res.score).toBe(2);
    expect(tasks.get('T-2').status).toBe('backlog');
    expect(tasks.get('T-2').attempts).toBe(1);
  });

  it('low score blocks once retries are exhausted', async () => {
    const task = tasks.create({ id: 'T-3', title: 'Stubborn', agent: 'coder', status: 'done' });
    // pretend it has already been retried twice
    memory.getDb().prepare('UPDATE tasks SET attempts = 2 WHERE id = ?').run('T-3');
    const fresh = tasks.get('T-3');
    const dispatch = makeMockDispatch({ responder: () => '1 — still broken' });

    await evaluator.selfEval({
      task: fresh,
      output: 'nope',
      deps: { workspace: ws, dispatch, evalThreshold: 3, maxEvalRetries: 2 },
    });
    expect(tasks.get('T-3').status).toBe('blocked');
  });

  it('respects self_evaluate:false', async () => {
    const task = tasks.create({ id: 'T-4', title: 'skip', agent: 'writer', status: 'done' });
    const dispatch = makeMockDispatch();
    const res = await evaluator.selfEval({
      task,
      output: 'x',
      deps: { workspace: ws, dispatch, settings: { autonomy: { self_evaluate: false } } },
    });
    expect(res).toBeNull();
    expect(dispatch.calls).toHaveLength(0);
  });
});
