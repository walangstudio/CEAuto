/**
 * Regression tests for the review-hardening fixes (P0/P1).
 * Each `it` maps to one finding id from the review plan.
 */

const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const budget = require('../../lib/budget');
const runner = require('../../lib/runner');
const sources = require('../../lib/sources');
const scheduler = require('../../lib/scheduler');
const approvals = require('../../lib/approvals');
const { dispatch } = require('../../lib/llm-adapter');
const { makeMockDispatch } = require('../helpers/mock-llm');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('review fixes', () => {
  let ws;
  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
    budget.configure({
      pricing: { default: { input: 1, output: 1 } }, // nonzero so $0 is meaningful
      budgets: { per_agent_daily_tokens: 1e9, per_session_tokens: 1e9, global_daily_tokens: 1e9, global_daily_usd: 1e9 },
    });
  });
  afterEach(() => {
    budget.resetConfig();
    memory.close();
    cleanup(ws);
  });

  // C2 — a crashed worker's stale claim is reclaimed so the loop can retry it.
  it('C2: reclaimStale releases a task claimed long ago', () => {
    tasks.create({ id: 'T-stale', title: 'stranded', agent: 'ops', status: 'in-progress' });
    const old = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago
    memory.getDb().prepare("UPDATE tasks SET claimed_by = 'dead-pid', claimed_at = ? WHERE id = ?").run(old, 'T-stale');

    expect(scheduler.readyOrder(tasks.all()).map(t => t.id)).not.toContain('T-stale'); // hidden while claimed
    const reclaimed = tasks.reclaimStale();
    expect(reclaimed).toContain('T-stale');
    expect(tasks.get('T-stale').claimed_by).toBeNull();
    expect(scheduler.readyOrder(tasks.all()).map(t => t.id)).toContain('T-stale'); // now runnable
  });

  it('C2: a fresh claim is NOT reclaimed', () => {
    tasks.create({ id: 'T-fresh', title: 'busy', agent: 'ops', status: 'in-progress' });
    tasks.claim('T-fresh', 'live-pid');
    expect(tasks.reclaimStale()).not.toContain('T-fresh');
    expect(tasks.get('T-fresh').claimed_by).toBe('live-pid');
  });

  // C1 — a throw AFTER the task completes must not re-run the LLM or double-bill.
  it('C1: a post-dispatch failure does not re-dispatch or double-record', async () => {
    tasks.create({ id: 'T-1', title: 'work', agent: 'researcher', status: 'in-progress' });
    const mock = makeMockDispatch();
    const evaluate = () => { throw new Error('eval DB blew up after complete'); };

    await expect(
      runner.runTask('T-1', { workspace: ws, dispatch: mock, evaluate, settings: {} })
    ).rejects.toThrow(/eval DB blew up/);

    expect(mock.calls).toHaveLength(1); // dispatched exactly once
    const ledger = memory.getDb().prepare("SELECT COUNT(*) AS n FROM budget_ledger WHERE task_id = 'T-1'").get();
    expect(ledger.n).toBe(1); // billed exactly once
    expect(tasks.get('T-1').status).toBe('done'); // completed before the eval threw
  });

  // C3 — requeue makes a budget-blocked task actionable again (server wires this on approve).
  it('C3: requeue moves a blocked task back into the ready queue', () => {
    tasks.create({ id: 'T-b', title: 'held', agent: 'ops', status: 'in-progress' });
    tasks.block('T-b', { reason: 'budget: cap', agent: 'ops' });
    expect(scheduler.readyOrder(tasks.all()).map(t => t.id)).not.toContain('T-b');
    tasks.requeue('T-b');
    expect(tasks.get('T-b').status).toBe('backlog');
    expect(scheduler.readyOrder(tasks.all()).map(t => t.id)).toContain('T-b');
  });

  // C6 — process-based executors must not accrue phantom USD at LLM pricing.
  it('C6: a shell-provider ledger row costs $0; an llm row is priced', () => {
    budget.record({ agent: 'ops', task_id: 'T-sh', provider: 'shell', model: 'node', input_tokens: 1000, output_tokens: 1000 });
    budget.record({ agent: 'researcher', task_id: 'T-llm', provider: 'anthropic', model: 'x', input_tokens: 1000, output_tokens: 1000 });
    const rows = memory.getDb().prepare('SELECT task_id, usd FROM budget_ledger ORDER BY task_id').all();
    const byTask = Object.fromEntries(rows.map(r => [r.task_id, r.usd]));
    expect(byTask['T-sh']).toBe(0);
    expect(byTask['T-llm']).toBeGreaterThan(0);
  });

  // S3 — a caller-supplied id that would escape reports/tasks/ is rejected.
  it('S3: tasks.create rejects an unsafe id', () => {
    expect(() => tasks.create({ id: '../../etc/evil', title: 'x' })).toThrow(/unsafe task id/);
    expect(() => tasks.create({ id: 'sub/dir', title: 'x' })).toThrow(/unsafe task id/);
    expect(() => tasks.create({ id: 'T-ok-123', title: 'x' })).not.toThrow();
  });

  // S1 — a task routed to a require_approval executor is held even if not flagged.
  it('S1: executors.require_approval gates a task without dispatching', async () => {
    tasks.create({ id: 'T-sh2', title: 'shell work', agent: 'ops', status: 'in-progress' });
    const mock = makeMockDispatch();
    const res = await runner.runTask('T-sh2', {
      workspace: ws,
      dispatch: mock,
      settings: { executors: { by_agent: { ops: 'shell' }, require_approval: ['shell'] } },
    });
    expect(res.status).toBe('awaiting-approval');
    expect(mock.calls).toHaveLength(0);
    expect(approvals.hasPending('task', 'T-sh2')).toBe(true);
  });

  // S1 — reactive-source tasks default to needs_approval so external input can't auto-run.
  it('S1: an ingested source task defaults to needs_approval', () => {
    const sig = sources.fromWebhook({ title: 'inbound' }, { agent: 'ops' });
    const task = sources.ingest(sig, { needsApproval: true });
    expect(task.needs_approval).toBe(1);
  });

  // A rejected task approval is terminal — the runner blocks it instead of
  // reopening a fresh approval every cycle (dry-run rejection must converge).
  it('a rejected task approval blocks the task and never dispatches', async () => {
    tasks.create({ id: 'T-rej', title: 'gated', agent: 'researcher', status: 'in-progress', needs_approval: true });
    const mock = makeMockDispatch();
    let res = await runner.runTask('T-rej', { workspace: ws, dispatch: mock, settings: {} });
    expect(res.status).toBe('awaiting-approval');

    const ap = approvals.pending().find(a => a.ref_id === 'T-rej');
    approvals.reject(ap.id, 'human');

    res = await runner.runTask('T-rej', { workspace: ws, dispatch: mock, settings: {} });
    expect(res.status).toBe('rejected');
    expect(tasks.get('T-rej').status).toBe('blocked');
    expect(mock.calls).toHaveLength(0);
  });

  // comms/STOP halts the runner path too (not just the heartbeat).
  it('comms/STOP halts a direct runTask', async () => {
    const fs = require('fs'); const p = require('path');
    fs.mkdirSync(p.join(ws, 'comms'), { recursive: true });
    fs.writeFileSync(p.join(ws, 'comms', 'STOP'), '');
    tasks.create({ id: 'T-stop', title: 'x', agent: 'researcher', status: 'in-progress' });
    const mock = makeMockDispatch();
    const res = await runner.runTask('T-stop', { workspace: ws, dispatch: mock, settings: {} });
    expect(res.status).toBe('halted');
    expect(mock.calls).toHaveLength(0);
  });
});

// S5 — refuse to send the API key over plaintext http to a non-loopback host.
describe('S5: base_url TLS guard', () => {
  let prevKey, prevBase, prevMock;
  beforeEach(() => {
    prevKey = process.env.OPENAI_API_KEY;
    prevBase = process.env.OPENAI_BASE_URL;
    prevMock = process.env.CEAUTO_MOCK_LLM;
    delete process.env.CEAUTO_MOCK_LLM;
    process.env.OPENAI_API_KEY = 'k';
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = prevBase;
    if (prevMock === undefined) delete process.env.CEAUTO_MOCK_LLM; else process.env.CEAUTO_MOCK_LLM = prevMock;
  });

  it('rejects an http base_url on a remote host', async () => {
    process.env.OPENAI_BASE_URL = 'http://api.evil.example.com/v1';
    await expect(
      dispatch('researcher', 'spec', 'task', '', { model: 'm', provider: 'openai' })
    ).rejects.toThrow(/refusing to send the API key/);
  });
});
