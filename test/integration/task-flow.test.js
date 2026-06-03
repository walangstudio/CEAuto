const fs = require('fs');
const path = require('path');
const { createClient } = require('../helpers/mcp-client');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('task lifecycle over MCP', () => {
  let ws;
  let client;

  beforeAll(async () => {
    ws = makeTmpWorkspace();
    client = createClient({ workspace: ws });
    await client.init();
  });

  afterAll(async () => {
    await client.close();
    cleanup(ws);
  });

  function read(rel) {
    try {
      return fs.readFileSync(path.join(ws, rel), 'utf-8');
    } catch {
      return '';
    }
  }

  it('delegate -> in-progress, complete -> done (markdown follows SQLite)', async () => {
    await client.callTool('ceo_delegate', {
      task: { id: 'T-100', title: 'Draft launch plan', priority: 'P1' },
      agent: 'writer',
    });
    expect(read('tasks/in-progress.md')).toContain('T-100');
    expect(read('comms/directives.md')).toMatch(/writer/);

    await client.callTool('ceo_complete_task', {
      task_id: 'T-100',
      task_title: 'Draft launch plan',
      outcome: 'Plan shipped',
      agent: 'writer',
    });
    expect(read('tasks/in-progress.md')).not.toContain('T-100');
    expect(read('tasks/done.md')).toContain('Plan shipped');
  });

  it('report_blocker moves a task to blocked', async () => {
    await client.callTool('ceo_delegate', {
      task: { id: 'T-101', title: 'Provision infra' },
      agent: 'ops',
    });
    await client.callTool('ceo_report_blocker', {
      task_id: 'T-101',
      task_title: 'Provision infra',
      reason: 'cloud account pending',
      agent: 'ops',
    });
    expect(read('tasks/blocked.md')).toContain('cloud account pending');
    expect(read('tasks/in-progress.md')).not.toContain('T-101');
  });
});
