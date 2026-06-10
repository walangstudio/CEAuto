const fs = require('fs');
const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const projection = require('../../lib/projection');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('projection (SQLite -> markdown)', () => {
  let ws;

  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
  });

  afterEach(() => {
    memory.close();
    cleanup(ws);
  });

  function read(rel) {
    return fs.readFileSync(path.join(ws, rel), 'utf-8');
  }

  it('renders each status into its own file', () => {
    tasks.create({ id: 'T-1', title: 'Research market', agent: 'researcher', status: 'backlog', priority: 'P1' });
    tasks.create({ id: 'T-2', title: 'Build API', agent: 'coder', status: 'in-progress' });
    tasks.create({ id: 'T-3', title: 'Audit', agent: 'security', status: 'blocked' });
    tasks.block('T-3', { reason: 'needs creds' });
    tasks.create({ id: 'T-4', title: 'Write docs', agent: 'writer', status: 'done' });
    tasks.complete('T-4', { outcome: 'published', quality: '⭐⭐⭐⭐⭐' });

    projection.renderTasks(ws);

    expect(read('tasks/backlog.md')).toContain('T-1');
    expect(read('tasks/backlog.md')).toContain('Research market');
    expect(read('tasks/in-progress.md')).toContain('T-2');
    expect(read('tasks/blocked.md')).toContain('needs creds');
    expect(read('tasks/done.md')).toContain('published');
  });

  it('re-render reflects state transitions (no stale rows)', () => {
    tasks.create({ id: 'T-9', title: 'moves', agent: 'coder', status: 'in-progress' });
    projection.renderTasks(ws);
    expect(read('tasks/in-progress.md')).toContain('T-9');

    tasks.complete('T-9', { outcome: 'done' });
    projection.renderTasks(ws);
    expect(read('tasks/in-progress.md')).not.toContain('T-9');
    expect(read('tasks/done.md')).toContain('T-9');
  });
});
