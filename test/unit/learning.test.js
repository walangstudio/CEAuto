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

  it('recommendDispatch returns the routable {model, provider} pair', () => {
    const db = memory.getDb();
    const evalRow = db.prepare('INSERT INTO evals (task_id, agent, score, rubric, feedback) VALUES (?, ?, ?, ?, ?)');
    const ledRow = db.prepare('INSERT INTO budget_ledger (agent, task_id, provider, model, usd, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, 0, 0)');
    for (let i = 0; i < 4; i++) {
      evalRow.run(`h-${i}`, 'researcher', 5, 'q', 'good');
      ledRow.run('researcher', `h-${i}`, 'anthropic', 'haiku', 0.001);
      evalRow.run(`o-${i}`, 'researcher', 5, 'q', 'good');
      ledRow.run('researcher', `o-${i}`, 'anthropic', 'opus', 0.05);
    }
    expect(learning.recommendDispatch('researcher')).toEqual({ model: 'haiku', provider: 'anthropic' });
    expect(learning.recommendDispatch('writer')).toBe(null); // no signal
  });

  it('recommendDispatch carries a null provider for legacy rows (adapter then falls back)', () => {
    const db = memory.getDb();
    const evalRow = db.prepare('INSERT INTO evals (task_id, agent, score, rubric, feedback) VALUES (?, ?, ?, ?, ?)');
    // legacy ledger rows: no provider column set -> NULL provider
    const ledRow = db.prepare('INSERT INTO budget_ledger (agent, task_id, model, usd, input_tokens, output_tokens) VALUES (?, ?, ?, ?, 0, 0)');
    for (let i = 0; i < 4; i++) {
      evalRow.run(`s-${i}`, 'coder', 5, 'q', 'good');
      ledRow.run('coder', `s-${i}`, 'sonnet', 0.01);
    }
    expect(learning.recommendDispatch('coder')).toEqual({ model: 'sonnet', provider: null });
  });

  // Seed one good model (the exploit) + extra under-sampled models (explore targets).
  function seedExploreScenario(extra = []) {
    const db = memory.getDb();
    const evalRow = db.prepare('INSERT INTO evals (task_id, agent, score, rubric, feedback) VALUES (?, ?, ?, ?, ?)');
    const ledRow = db.prepare('INSERT INTO budget_ledger (agent, task_id, provider, model, usd, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, 0, 0)');
    for (let i = 0; i < 4; i++) {            // haiku: 4 good runs -> the exploit pick
      evalRow.run(`hk-${i}`, 'researcher', 5, 'q', 'good');
      ledRow.run('researcher', `hk-${i}`, 'anthropic', 'haiku', 0.001);
    }
    for (const { model, provider, samples, usd } of extra) {
      for (let i = 0; i < samples; i++) {
        evalRow.run(`${model}-${i}`, 'researcher', 5, 'q', 'good');
        ledRow.run('researcher', `${model}-${i}`, provider, model, usd);
      }
    }
  }

  it('epsilon-greedy exploration re-samples an abandoned model when the coin fires', () => {
    seedExploreScenario([{ model: 'opus', provider: 'anthropic', samples: 1, usd: 0.05 }]);
    // coin fires (rng < epsilon) -> explore the non-exploit candidate (under-sampled opus)
    expect(learning.recommendDispatch('researcher', { epsilon: 1, rng: () => 0 }))
      .toEqual({ model: 'opus', provider: 'anthropic', explore: true });
    // coin misses (rng >= epsilon) -> the cheapest-that-works exploit pick, no explore tag
    expect(learning.recommendDispatch('researcher', { epsilon: 0.5, rng: () => 0.9 }))
      .toEqual({ model: 'haiku', provider: 'anthropic' });
    // epsilon defaults to 0 -> never explores (behaviour unchanged)
    expect(learning.recommendDispatch('researcher')).toEqual({ model: 'haiku', provider: 'anthropic' });
  });

  it('exploration picks the least-sampled routable candidate', () => {
    seedExploreScenario([
      { model: 'opus', provider: 'anthropic', samples: 1, usd: 0.05 },   // most neglected
      { model: 'sonnet', provider: 'anthropic', samples: 2, usd: 0.02 },
    ]);
    expect(learning.recommendDispatch('researcher', { epsilon: 1, rng: () => 0 }))
      .toEqual({ model: 'opus', provider: 'anthropic', explore: true });
  });

  it('exploration never fires when the exploit pick is the only candidate', () => {
    seedExploreScenario(); // only haiku
    expect(learning.recommendDispatch('researcher', { epsilon: 1, rng: () => 0 }))
      .toEqual({ model: 'haiku', provider: 'anthropic' }); // falls through to exploit, no explore tag
  });

  it('exploration skips legacy null-provider candidates (not routable)', () => {
    seedExploreScenario(); // haiku (good, anthropic)
    const db = memory.getDb();
    const evalRow = db.prepare('INSERT INTO evals (task_id, agent, score, rubric, feedback) VALUES (?, ?, ?, ?, ?)');
    const legacy = db.prepare('INSERT INTO budget_ledger (agent, task_id, model, usd, input_tokens, output_tokens) VALUES (?, ?, ?, ?, 0, 0)');
    evalRow.run('legacy-0', 'researcher', 5, 'q', 'good'); // under-sampled, NULL provider
    legacy.run('researcher', 'legacy-0', 'sonnet', 0.5);
    // the only non-exploit candidate has no provider -> nothing routable to explore -> exploit
    expect(learning.recommendDispatch('researcher', { epsilon: 1, rng: () => 0 }))
      .toEqual({ model: 'haiku', provider: 'anthropic' });
  });
});
