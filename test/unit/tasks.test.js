const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('tasks store', () => {
  let ws;

  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
  });

  afterEach(() => {
    memory.close();
    cleanup(ws);
  });

  it('creates and reads a task', () => {
    const t = tasks.create({ id: 'T-1', title: 'Ship it', agent: 'coder', priority: 'P1' });
    expect(t.id).toBe('T-1');
    expect(t.status).toBe('backlog');
    expect(tasks.get('T-1').title).toBe('Ship it');
  });

  it('generates an id when none provided', () => {
    const t = tasks.create({ title: 'auto id' });
    expect(t.id).toMatch(/^T-/);
  });

  it('lists by status and actionable', () => {
    tasks.create({ id: 'T-1', title: 'a', status: 'backlog', priority: 'P3' });
    tasks.create({ id: 'T-2', title: 'b', status: 'in-progress', priority: 'P1' });
    tasks.create({ id: 'T-3', title: 'c', status: 'done' });
    expect(tasks.listByStatus('backlog').map(t => t.id)).toEqual(['T-1']);
    // actionable = not done, unclaimed; P1 first
    expect(tasks.listActionable().map(t => t.id)).toEqual(['T-2', 'T-1']);
  });

  it('completes, blocks and requeues', () => {
    tasks.create({ id: 'T-1', title: 'x', status: 'in-progress' });
    tasks.complete('T-1', { outcome: 'done', quality: '⭐⭐⭐⭐⭐' });
    expect(tasks.get('T-1').status).toBe('done');

    tasks.create({ id: 'T-2', title: 'y', status: 'in-progress' });
    tasks.block('T-2', { reason: 'waiting on API key' });
    expect(tasks.get('T-2').status).toBe('blocked');
    expect(tasks.get('T-2').blocker).toMatch(/API key/);

    const before = tasks.get('T-2').attempts;
    tasks.requeue('T-2');
    expect(tasks.get('T-2').status).toBe('backlog');
    expect(tasks.get('T-2').attempts).toBe(before + 1);
  });

  it('atomic claim — exactly one of two racers wins', () => {
    tasks.create({ id: 'T-1', title: 'race', status: 'backlog' });
    const a = tasks.claim('T-1', 'worker-a');
    const b = tasks.claim('T-1', 'worker-b');
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(tasks.get('T-1').claimed_by).toBe('worker-a');
  });

  it('a stale claim can be reclaimed', () => {
    tasks.create({ id: 'T-1', title: 'stale', status: 'backlog' });
    expect(tasks.claim('T-1', 'worker-a')).toBe(true);
    // zero TTL makes the existing claim immediately stale
    expect(tasks.claim('T-1', 'worker-b', { ttlMs: 0 })).toBe(true);
    expect(tasks.get('T-1').claimed_by).toBe('worker-b');
  });

  it('a done task cannot be claimed', () => {
    tasks.create({ id: 'T-1', title: 'finished', status: 'done' });
    expect(tasks.claim('T-1', 'worker-a')).toBe(false);
  });
});
