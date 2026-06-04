const path = require('path');
const memory = require('../../lib/memory');
const budget = require('../../lib/budget');
const learning = require('../../lib/learning');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('learning loop', () => {
  let ws;
  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
  });
  afterEach(() => {
    memory.close();
    cleanup(ws);
  });

  it('records a playbook only for high-scoring work', () => {
    expect(learning.recordPlaybook({ task: { id: 'A', title: 'market sizing', agent: 'researcher' }, agent: 'researcher', score: 5, result: 'use TAM/SAM/SOM' })).toBe(true);
    expect(learning.recordPlaybook({ task: { id: 'B', title: 'weak', agent: 'researcher' }, agent: 'researcher', score: 2, result: 'meh' })).toBe(false);
    expect(learning.counts().playbooks).toBe(1);
  });

  it('records a lesson from a block', () => {
    expect(learning.recordLesson({ task: { id: 'C', title: 'deploy', agent: 'ops' }, agent: 'ops', reason: 'missing creds' })).toBe(true);
    expect(learning.counts().lessons).toBe(1);
  });

  it('recalls a matching playbook + lesson as injectable context', () => {
    learning.recordPlaybook({ task: { id: 'A', title: 'market sizing for fintech', agent: 'researcher' }, agent: 'researcher', score: 5, result: 'TAM/SAM/SOM with sources' });
    learning.recordLesson({ task: { id: 'B', title: 'market sizing', agent: 'researcher' }, agent: 'researcher', reason: 'no sources cited' });

    const ctx = learning.recallContext({ title: 'market sizing for healthtech' }, 'researcher');
    expect(ctx).toMatch(/Proven approaches/);
    expect(ctx).toMatch(/TAM\/SAM\/SOM/);
    expect(ctx).toMatch(/Lessons/);
  });

  it('returns empty context on a cold start', () => {
    expect(learning.recallContext({ title: 'anything' }, 'coder')).toBe('');
  });

  it('computes dispatch stats and recommends the cheapest model that works', () => {
    // Two models for researcher: cheap+good vs pricey+good. Recommend the cheap one.
    const db = memory.getDb();
    const evalRow = db.prepare('INSERT INTO evals (task_id, agent, score, rubric, feedback) VALUES (?, ?, ?, ?, ?)');
    const ledRow = db.prepare('INSERT INTO budget_ledger (agent, task_id, model, usd, input_tokens, output_tokens) VALUES (?, ?, ?, ?, 0, 0)');
    for (let i = 0; i < 4; i++) {
      evalRow.run(`cheap-${i}`, 'researcher', 5, 'q', 'good');
      ledRow.run('researcher', `cheap-${i}`, 'haiku', 0.001);
      evalRow.run(`pricey-${i}`, 'researcher', 5, 'q', 'good');
      ledRow.run('researcher', `pricey-${i}`, 'opus', 0.05);
    }
    const stats = learning.dispatchStats('researcher');
    expect(stats.find(s => s.model === 'haiku').successRate).toBe(1);
    expect(learning.recommendModel('researcher')).toBe('haiku'); // cheapest that clears the bar
  });

  it('does not let retries (multiple ledger rows per task) inflate the stats', () => {
    const db = memory.getDb();
    const evalRow = db.prepare('INSERT INTO evals (task_id, agent, score, rubric, feedback) VALUES (?, ?, ?, ?, ?)');
    const ledRow = db.prepare('INSERT INTO budget_ledger (agent, task_id, model, usd, input_tokens, output_tokens) VALUES (?, ?, ?, ?, 0, 0)');
    // ONE task, ONE eval (score 4), but THREE ledger rows (two retries).
    evalRow.run('T', 'coder', 4, 'q', 'ok');
    ledRow.run('coder', 'T', 'sonnet', 0.01);
    ledRow.run('coder', 'T', 'sonnet', 0.01);
    ledRow.run('coder', 'T', 'sonnet', 0.01);

    const stats = learning.dispatchStats('coder');
    const sonnet = stats.find(s => s.model === 'sonnet');
    expect(sonnet.samples).toBe(1);        // one task, not three
    expect(sonnet.avgScore).toBe(4);       // not averaged 3x
    expect(sonnet.avgUsd).toBeCloseTo(0.03); // total cost for the task
  });

  it('recommends nothing without enough samples', () => {
    expect(learning.recommendModel('writer')).toBe(null);
    // suppress unused
    expect(budget).toBeTruthy();
  });
});
