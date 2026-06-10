const fs = require('fs');
const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const budget = require('../../lib/budget');
const approvals = require('../../lib/approvals');
const metrics = require('../../lib/metrics');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('metrics', () => {
  let ws;

  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
    budget.configure({ pricing: { default: { input: 1, output: 1 } }, budgets: {} });
  });

  afterEach(() => {
    budget.resetConfig();
    memory.close();
    cleanup(ws);
  });

  it('aggregates tasks, spend, approvals and evals', () => {
    tasks.create({ id: 'T-1', title: 'a', status: 'backlog' });
    tasks.create({ id: 'T-2', title: 'b', status: 'done' });
    tasks.complete('T-2', { outcome: 'ok' });
    budget.record({ agent: 'coder', model: 'x', input_tokens: 1000, output_tokens: 1000 });
    approvals.request({ kind: 'decision', ref_id: 'DEC-1', summary: 'pivot' });
    memory.getDb().prepare('INSERT INTO evals (task_id, score) VALUES (?, ?)').run('T-2', 4);
    memory.store('decisions', 'go big');

    const s = metrics.snapshot();
    expect(s.tasks.backlog).toBe(1);
    expect(s.tasks.done).toBe(1);
    expect(s.throughput_7d).toBe(1);
    expect(s.spend_total.tokens).toBe(2000);
    expect(s.spend_total.usd).toBeCloseTo(2, 4);
    expect(s.approvals_pending).toBe(1);
    expect(s.eval_avg).toBe(4);
    expect(s.decisions).toBe(1);
  });

  it('writes reports/metrics.md', () => {
    tasks.create({ id: 'T-9', title: 'x', status: 'done' });
    metrics.writeReport(ws);
    const md = fs.readFileSync(path.join(ws, 'reports', 'metrics.md'), 'utf-8');
    expect(md).toMatch(/CEAuto Metrics/);
    expect(md).toMatch(/Throughput/);
  });
});
