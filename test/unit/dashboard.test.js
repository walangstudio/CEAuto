const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const approvals = require('../../lib/approvals');
const dashboard = require('../../lib/dashboard');
const httpServer = require('../../lib/http-server');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('read-only dashboard', () => {
  let ws;
  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
  });
  afterEach(() => {
    memory.close();
    cleanup(ws);
  });

  it('buildState projects tasks, approvals, metrics and events', () => {
    tasks.create({ id: 'T-1', title: 'ship', agent: 'coder', status: 'backlog' });
    approvals.request({ kind: 'decision', ref_id: 'DEC-1', summary: 'pivot', quorum: 2 });

    const s = dashboard.buildState();
    expect(s.tasks.find(t => t.id === 'T-1').agent).toBe('coder');
    expect(s.approvals[0].quorum).toBe(2);
    expect(s.metrics.tasks.backlog).toBe(1);
    expect(Array.isArray(s.events)).toBe(true);
    expect(typeof s.generated_at).toBe('string');
  });

  it('serves /api/state as JSON and / as HTML over the http server', async () => {
    tasks.create({ id: 'T-2', title: 'docs', agent: 'writer', status: 'done' });
    const handle = await httpServer.start({ port: 0, routes: dashboard.routes() });
    try {
      const api = await fetch(`http://127.0.0.1:${handle.port}/api/state`);
      expect(api.headers.get('content-type')).toMatch(/application\/json/);
      const state = await api.json();
      expect(state.tasks.some(t => t.id === 'T-2')).toBe(true);

      const html = await fetch(`http://127.0.0.1:${handle.port}/`);
      expect(html.headers.get('content-type')).toMatch(/text\/html/);
      expect(await html.text()).toMatch(/CEAuto Dashboard/);
    } finally {
      await handle.stop();
    }
  });

  it('escapes quotes too, so a value placed in an attribute (status class) cannot break out', () => {
    const page = dashboard.htmlPage();
    expect(page).toMatch(/replace\(\/\[&<>"'\]/); // esc covers " and ' for attribute context
    expect(page).toContain('&quot;');
    // events are slimmed: the raw, possibly attacker-controlled payload is not exposed
    expect(page).not.toContain('e.payload');
  });
});
