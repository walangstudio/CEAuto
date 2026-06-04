const path = require('path');
const memory = require('../../lib/memory');
const events = require('../../lib/events');
const tasks = require('../../lib/tasks');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('events.reduce (pure replay)', () => {
  const log = [
    { id: 1, type: 'task.created', payload: { id: 'A', agent: 'researcher', status: 'backlog' } },
    { id: 2, type: 'task.created', payload: { id: 'B', agent: 'coder', status: 'backlog' } },
    { id: 3, type: 'task.claimed', payload: { id: 'A', worker: 'w1' } },
    { id: 4, type: 'task.completed', payload: { id: 'A' } },
    { id: 5, type: 'task.blocked', payload: { id: 'B', reason: 'stuck' } },
  ];

  it('folds the lifecycle into the right end state', () => {
    const { tasks: state } = events.reduce(log);
    expect(state.A.status).toBe('done');
    expect(state.A.claimed_by).toBe(null);
    expect(state.B.status).toBe('blocked');
    expect(state.B.blocker).toBe('stuck');
  });

  it('is deterministic — applying the same log twice yields identical state', () => {
    expect(events.reduce(log)).toEqual(events.reduce(log));
  });

  it('is order-independent of input array order (sorts by id)', () => {
    const shuffled = [log[3], log[0], log[4], log[2], log[1]];
    expect(events.reduce(shuffled)).toEqual(events.reduce(log));
  });
});

describe('events log + drain (with db)', () => {
  let ws;
  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
  });
  afterEach(() => {
    events.clearSubscriptions();
    memory.close();
    cleanup(ws);
  });

  it('task mutations emit a replayable log that matches live state', () => {
    tasks.create({ id: 'T1', title: 't1', agent: 'researcher', status: 'backlog' });
    tasks.claim('T1', 'w1');
    tasks.complete('T1', {});
    tasks.create({ id: 'T2', title: 't2', agent: 'coder', status: 'backlog' });
    tasks.block('T2', { reason: 'oops' });

    const snap = events.reduce(events.all());
    expect(snap.tasks.T1.status).toBe('done');
    expect(snap.tasks.T2.status).toBe('blocked');
    // Replay matches the live SQLite table.
    expect(snap.tasks.T1.status).toBe(tasks.get('T1').status);
    expect(snap.tasks.T2.status).toBe(tasks.get('T2').status);
  });

  it('replay stays faithful when create() upserts a new status (no claim/block)', () => {
    tasks.create({ id: 'U', title: 'u', status: 'backlog' });
    tasks.create({ id: 'U', title: 'u', status: 'in-progress' }); // status change via upsert
    const snap = events.reduce(events.all());
    expect(snap.tasks.U.status).toBe('in-progress');
    expect(snap.tasks.U.status).toBe(tasks.get('U').status);
  });

  it('snapshot(uptoId) reconstructs a PAST state', () => {
    tasks.create({ id: 'X', title: 'x', status: 'backlog' });   // event #1
    tasks.claim('X', 'w');                                       // event #2
    const beforeDone = events.lastId();
    tasks.complete('X', {});                                     // event #3

    expect(events.snapshot(beforeDone).tasks.X.status).toBe('in-progress');
    expect(events.snapshot().tasks.X.status).toBe('done');
  });

  it('drain processes each event once and advances the cursor', () => {
    tasks.create({ id: 'D1', title: 'd', status: 'backlog' });
    const seen = [];
    const subs = [{ type: '*', handler: e => seen.push(e.id) }];

    const first = events.drain({ subs });
    expect(first).toBeGreaterThan(0);
    const after = events.drain({ subs });
    expect(after).toBe(0); // nothing new — cursor advanced
    expect(new Set(seen).size).toBe(seen.length); // no event seen twice
  });

  it('a throwing subscriber never breaks the drain', () => {
    tasks.create({ id: 'E1', title: 'e', status: 'backlog' });
    const subs = [
      { type: '*', handler: () => { throw new Error('boom'); } },
      { type: '*', handler: () => { subs.ok = true; } },
    ];
    expect(() => events.drain({ subs })).not.toThrow();
    expect(subs.ok).toBe(true);
  });
});
