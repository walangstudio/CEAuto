const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const budget = require('../../lib/budget');
const learning = require('../../lib/learning');
const runner = require('../../lib/runner');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

function recordingDispatch(text) {
  const d = (...a) => { d.calls.push(a); return Promise.resolve({ text, usage: { input_tokens: 1, output_tokens: 1, model: 'm', provider: 'mock' } }); };
  d.calls = [];
  return d;
}

describe('runner learning loop', () => {
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

  it('a high-scoring completion is distilled into a playbook', async () => {
    tasks.create({ id: 'T1', title: 'market sizing', agent: 'researcher', status: 'in-progress' });
    const dispatch = recordingDispatch('use TAM/SAM/SOM with cited sources');
    const evaluate = () => Promise.resolve({ score: 5 });

    const res = await runner.runTask('T1', { workspace: ws, dispatch, evaluate, settings: {} });
    expect(res.status).toBe('done');
    expect(learning.counts().playbooks).toBe(1);
  });

  it('injects a matching playbook into the next similar task\'s context', async () => {
    // Seed a playbook directly.
    learning.recordPlaybook({ task: { id: 'seed', title: 'market sizing', agent: 'researcher' }, agent: 'researcher', score: 5, result: 'TAM/SAM/SOM approach' });

    tasks.create({ id: 'T2', title: 'market sizing for healthtech', agent: 'researcher', status: 'in-progress' });
    const dispatch = recordingDispatch('done');
    await runner.runTask('T2', { workspace: ws, dispatch, settings: { autonomy: { self_evaluate: false } } });

    const contextArg = dispatch.calls[0][3]; // (agent, spec, task, context)
    expect(contextArg).toMatch(/Proven approaches/);
    expect(contextArg).toMatch(/TAM\/SAM\/SOM/);
  });

  it('a quality block is distilled into a lesson', async () => {
    tasks.create({ id: 'T3', title: 'bad task', agent: 'coder', status: 'in-progress' });
    const dispatch = recordingDispatch('weak output');
    // evaluate blocks the task (simulating quality below threshold after retries).
    const evaluate = ({ task }) => { tasks.block(task.id, { reason: 'quality 1/5', agent: 'coder' }); return Promise.resolve({ score: 1 }); };

    const res = await runner.runTask('T3', { workspace: ws, dispatch, evaluate, settings: {} });
    expect(res.status).toBe('blocked');
    expect(learning.counts().lessons).toBe(1);
  });
});
