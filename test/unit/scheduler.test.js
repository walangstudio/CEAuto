const scheduler = require('../../lib/scheduler');

function task(id, over = {}) {
  return {
    id,
    status: 'backlog',
    priority: 'P2',
    claimed_by: null,
    created_at: '2026-01-01T00:00:00Z',
    depends_on: null,
    ...over,
  };
}

describe('scheduler.readyOrder', () => {
  it('only returns tasks whose deps are all done', () => {
    const all = [
      task('A', { status: 'done' }),
      task('B', { depends_on: JSON.stringify(['A']) }),
      task('C', { depends_on: JSON.stringify(['B']) }),
    ];
    const ready = scheduler.readyOrder(all).map(t => t.id);
    expect(ready).toEqual(['B']); // A done, B ready, C waits on B
  });

  it('treats a task with no deps as ready', () => {
    const ready = scheduler.readyOrder([task('X'), task('Y', { depends_on: '[]' })]).map(t => t.id);
    expect(ready.sort()).toEqual(['X', 'Y']);
  });

  it('excludes claimed, done, and blocked tasks', () => {
    const all = [
      task('claimed', { claimed_by: 'w' }),
      task('done', { status: 'done' }),
      task('blocked', { status: 'blocked' }),
      task('open'),
    ];
    expect(scheduler.readyOrder(all).map(t => t.id)).toEqual(['open']);
  });

  it('orders by priority then age', () => {
    const all = [
      task('old-p2', { priority: 'P2', created_at: '2026-01-01' }),
      task('p1', { priority: 'P1', created_at: '2026-02-01' }),
      task('new-p2', { priority: 'P2', created_at: '2026-03-01' }),
    ];
    expect(scheduler.readyOrder(all).map(t => t.id)).toEqual(['p1', 'old-p2', 'new-p2']);
  });

  it('a dep that does not exist is not satisfied (task is not ready)', () => {
    const all = [task('B', { depends_on: JSON.stringify(['ghost']) })];
    expect(scheduler.readyOrder(all)).toEqual([]);
  });
});

describe('scheduler.findDeadlocks', () => {
  it('flags an unknown dependency', () => {
    const all = [task('B', { depends_on: JSON.stringify(['ghost']) })];
    expect(scheduler.findDeadlocks(all)).toEqual([{ id: 'B', reason: 'unknown dependency: ghost' }]);
  });

  it('flags a 2-node cycle', () => {
    const all = [
      task('A', { depends_on: JSON.stringify(['B']) }),
      task('B', { depends_on: JSON.stringify(['A']) }),
    ];
    const ids = scheduler.findDeadlocks(all).map(d => d.id).sort();
    expect(ids).toEqual(['A', 'B']);
    expect(scheduler.findDeadlocks(all).every(d => d.reason === 'dependency cycle')).toBe(true);
  });

  it('flags a self-dependency as a cycle', () => {
    const all = [task('A', { depends_on: JSON.stringify(['A']) })];
    expect(scheduler.findDeadlocks(all)).toEqual([{ id: 'A', reason: 'dependency cycle' }]);
  });

  it('does not flag a healthy chain', () => {
    const all = [
      task('A', { status: 'done' }),
      task('B', { depends_on: JSON.stringify(['A']) }),
      task('C', { depends_on: JSON.stringify(['B']) }),
    ];
    expect(scheduler.findDeadlocks(all)).toEqual([]);
  });

  it('unknown-dep takes precedence over cycle for the same task', () => {
    const all = [
      task('A', { depends_on: JSON.stringify(['B', 'ghost']) }),
      task('B', { depends_on: JSON.stringify(['A']) }),
    ];
    const byId = Object.fromEntries(scheduler.findDeadlocks(all).map(d => [d.id, d.reason]));
    expect(byId.A).toBe('unknown dependency: ghost');
    expect(byId.B).toBe('dependency cycle');
  });
});
