const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const budget = require('../../lib/budget');
const runner = require('../../lib/runner');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

// A dispatch that returns a ceauto decomposition directive and records the task
// text it was asked to plan (to prove the planning instruction was injected).
function dispatchPlan(directive) {
  const d = (agentId, _spec, task) => {
    d.calls.push({ agentId, task });
    return Promise.resolve({
      text: 'plan:\n\n```ceauto\n' + JSON.stringify(directive) + '\n```',
      usage: { input_tokens: 1, output_tokens: 1, model: 'm', provider: 'mock' },
    });
  };
  d.calls = [];
  return d;
}

describe('runner LLM planner step', () => {
  let ws;
  const settings = { autonomy: { self_evaluate: false }, agents: { researcher: {}, coder: {} } };

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

  it('decomposes a plan task into subtasks and marks the parent Planned', async () => {
    tasks.create({ id: 'BIG', title: 'launch', agent: 'researcher', status: 'in-progress', plan: true });
    const dispatch = dispatchPlan({ subtasks: [{ title: 'research', agent: 'researcher' }, { title: 'build', agent: 'coder' }] });

    const res = await runner.runTask('BIG', { workspace: ws, dispatch, settings });

    expect(res.status).toBe('done');
    expect(dispatch.calls[0].task).toMatch(/PLANNING MODE/); // instruction injected
    expect(res.delegated).toHaveLength(2);
    expect(tasks.get('BIG').outcome).toBe('Planned');
    const kids = tasks.children('BIG');
    expect(kids).toHaveLength(2);
    expect(kids.map(k => k.title).sort()).toEqual(['build', 'research']);
    expect(kids.every(k => k.status === 'backlog' && k.parent_id === 'BIG')).toBe(true);
  });

  it('maps a subtask depends_on (sibling title) to the new child id (a real DAG)', async () => {
    tasks.create({ id: 'BIG', title: 'x', agent: 'researcher', status: 'in-progress', plan: true });
    const dispatch = dispatchPlan({ subtasks: [
      { title: 'first', agent: 'researcher' },
      { title: 'second', agent: 'coder', depends_on: ['first'] },
    ] });

    await runner.runTask('BIG', { workspace: ws, dispatch, settings });

    const kids = tasks.children('BIG');
    const first = kids.find(k => k.title === 'first');
    const second = kids.find(k => k.title === 'second');
    expect(JSON.parse(second.depends_on)).toEqual([first.id]); // sibling title → child id, not the literal
  });

  it('handles duplicate subtask titles and self-references without a corrupt DAG', async () => {
    tasks.create({ id: 'BIG', title: 'x', agent: 'researcher', status: 'in-progress', plan: true });
    const dispatch = dispatchPlan({ subtasks: [
      { title: 'dup', agent: 'researcher' },
      { title: 'dup', agent: 'researcher' },                       // duplicate title
      { title: 'self', agent: 'coder', depends_on: ['self'] },     // self-reference
      { title: 'last', agent: 'coder', depends_on: ['dup'] },      // refers to a duplicated title
    ] });

    const res = await runner.runTask('BIG', { workspace: ws, dispatch, settings });

    // res.delegated is the child ids in creation order (deterministic, unlike
    // created_at which has second precision).
    expect(res.delegated).toHaveLength(4);
    const firstDupId = res.delegated[0];          // the first 'dup' child
    const selfTask = tasks.get(res.delegated[2]); // 'self'
    const lastTask = tasks.get(res.delegated[3]); // 'last'
    expect(JSON.parse(selfTask.depends_on)).toEqual([]);          // self-ref dropped, no self-cycle
    expect(JSON.parse(lastTask.depends_on)).toEqual([firstDupId]); // resolves to the FIRST 'dup'
  });

  it('plans via the llm executor even when the agent is configured for shell', async () => {
    tasks.create({ id: 'BIG', title: 'x', agent: 'ops', status: 'in-progress', plan: true });
    const dispatch = dispatchPlan({ subtasks: [{ title: 'do it', agent: 'ops' }] });

    // ops is mapped to shell with an EMPTY allowlist — a shell dispatch would throw.
    const res = await runner.runTask('BIG', {
      workspace: ws, dispatch,
      settings: { autonomy: { self_evaluate: false }, agents: { ops: {} }, executors: { by_agent: { ops: 'shell' }, shell: { allowlist: [] } } },
    });

    expect(res.status).toBe('done'); // planning forced llm, so the shell path was never taken
    expect(tasks.children('BIG')).toHaveLength(1);
  });
});
