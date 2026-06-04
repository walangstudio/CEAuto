const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const budget = require('../../lib/budget');
const org = require('../../lib/org');
const approvals = require('../../lib/approvals');
const events = require('../../lib/events');
const runner = require('../../lib/runner');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

// A dispatch whose answer embeds a ceauto delegation directive.
function dispatchWith(directive) {
  const d = (...a) => {
    d.calls.push(a);
    return Promise.resolve({ text: 'done\n\n```ceauto\n' + JSON.stringify(directive) + '\n```', usage: { input_tokens: 1, output_tokens: 1, model: 'default', provider: 'mock' } });
  };
  d.calls = [];
  return d;
}

describe('runner inter-agent delegation', () => {
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

  it('spawns child tasks from a directive, parented to the task', async () => {
    tasks.create({ id: 'P', title: 'parent', agent: 'researcher', status: 'in-progress' });
    const dispatch = dispatchWith({ subtasks: [{ title: 'sub one', agent: 'researcher' }, { title: 'sub two', agent: 'researcher' }] });

    const res = await runner.runTask('P', { workspace: ws, dispatch, settings });
    expect(res.status).toBe('done');
    expect(res.delegated).toHaveLength(2);
    const kids = tasks.children('P');
    expect(kids).toHaveLength(2);
    expect(kids[0].status).toBe('backlog');
    expect(kids.map(k => k.title).sort()).toEqual(['sub one', 'sub two']);
  });

  it('caps fan-out at max_subtasks_per_task', async () => {
    tasks.create({ id: 'P', title: 'parent', agent: 'researcher', status: 'in-progress' });
    const many = Array.from({ length: 9 }, (_, i) => ({ title: `s${i}`, agent: 'researcher' }));
    const dispatch = dispatchWith({ subtasks: many });

    const res = await runner.runTask('P', {
      workspace: ws, dispatch,
      settings: { autonomy: { self_evaluate: false, max_subtasks_per_task: 3 } },
    });
    expect(res.delegated).toHaveLength(3);
    expect(tasks.children('P')).toHaveLength(3);
  });

  it('stops delegating at max depth', async () => {
    // P (depth 0) -> C (depth 1). With max depth 1, C may not spawn.
    tasks.create({ id: 'P', title: 'p', agent: 'researcher', status: 'done' });
    tasks.create({ id: 'C', title: 'c', agent: 'researcher', status: 'in-progress', parent_id: 'P' });
    const dispatch = dispatchWith({ subtasks: [{ title: 'grandchild', agent: 'researcher' }] });

    const res = await runner.runTask('C', {
      workspace: ws, dispatch,
      settings: { autonomy: { self_evaluate: false, max_delegation_depth: 1 } },
    });
    expect(res.delegated).toHaveLength(0);
    expect(tasks.children('C')).toHaveLength(0);
  });

  it('denies delegation outside the role\'s authority', async () => {
    org.configure({
      roles: {
        research: { members: ['researcher'], can_delegate_to: ['research'] },
        engineering: { members: ['coder'] },
      },
    });
    tasks.create({ id: 'P', title: 'p', agent: 'researcher', status: 'in-progress' });
    const dispatch = dispatchWith({ subtasks: [{ title: 'code it', agent: 'coder' }] });

    const res = await runner.runTask('P', { workspace: ws, dispatch, settings });
    expect(res.delegated).toHaveLength(0); // research can't delegate to engineering
    expect(tasks.children('P')).toHaveLength(0);
    org.resetConfig();
  });

  it('a delegation failure cannot re-dispatch the done task or double-spawn', async () => {
    tasks.create({ id: 'P', title: 'p', agent: 'researcher', status: 'in-progress' });
    const dispatch = dispatchWith({ subtasks: [{ title: 'child', agent: 'researcher' }] });
    // Force processDelegation to throw partway through.
    const spy = vi.spyOn(org, 'canDelegate').mockImplementation(() => { throw new Error('boom'); });

    const res = await runner.runTask('P', { workspace: ws, dispatch, settings });
    expect(res.status).toBe('done');         // still reported done
    expect(dispatch.calls).toHaveLength(1);  // NOT re-dispatched
    expect(tasks.children('P')).toHaveLength(0);
    expect(events.all().some(e => e.type === 'delegation.error')).toBe(true);
    spy.mockRestore();
  });

  it('opens an escalation approval up the reporting line', async () => {
    org.configure({
      roles: {
        ceo: {},
        research: { reports_to: 'ceo', members: ['researcher'] },
      },
    });
    tasks.create({ id: 'P', title: 'p', agent: 'researcher', status: 'in-progress' });
    const dispatch = dispatchWith({ escalate: { reason: 'one-way door' } });

    await runner.runTask('P', { workspace: ws, dispatch, settings });
    const pending = approvals.pending();
    expect(pending.some(a => a.kind === 'escalation' && a.ref_id === 'P')).toBe(true);
    org.resetConfig();
  });
});
