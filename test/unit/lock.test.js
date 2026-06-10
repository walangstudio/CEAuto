const path = require('path');
const memory = require('../../lib/memory');
const lock = require('../../lib/lock');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('daemon single-instance lock', () => {
  let ws;

  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
  });

  afterEach(() => {
    memory.close();
    cleanup(ws);
  });

  it('first acquirer wins, a second fresh acquirer is refused', () => {
    expect(lock.acquire(111)).toBe(true);
    expect(lock.acquire(222)).toBe(false);
    expect(lock.holder().pid).toBe(111);
  });

  it('the same pid can re-acquire (refresh)', () => {
    expect(lock.acquire(111)).toBe(true);
    expect(lock.acquire(111)).toBe(true);
  });

  it('a stale lock can be taken over', () => {
    expect(lock.acquire(111)).toBe(true);
    expect(lock.acquire(222, { ttlMs: 0 })).toBe(true); // existing lock immediately stale
    expect(lock.holder().pid).toBe(222);
  });

  it('release frees the lock for others', () => {
    lock.acquire(111);
    lock.release(111);
    expect(lock.acquire(222)).toBe(true);
  });
});
