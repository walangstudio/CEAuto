const fs = require('fs');
const path = require('path');
const { createClient } = require('../helpers/mcp-client');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('delegate with execute over MCP (mock provider)', () => {
  let ws;
  let client;

  beforeAll(async () => {
    ws = makeTmpWorkspace();
    client = createClient({ workspace: ws, env: { CEAUTO_MOCK_LLM: '1' } });
    await client.init();
  });

  afterAll(async () => {
    await client.close();
    cleanup(ws);
  });

  it('executes the task and writes a result file', async () => {
    const res = await client.callTool('ceo_delegate', {
      task: { id: 'T-200', title: 'Draft competitor brief', description: 'List 3 competitors' },
      agent: 'researcher',
      execute: true,
    });
    expect(res.content[0].text).toMatch(/Status: done/);
    expect(fs.existsSync(path.join(ws, 'reports', 'tasks', 'T-200.md'))).toBe(true);
    expect(fs.readFileSync(path.join(ws, 'tasks', 'done.md'), 'utf-8')).toContain('T-200');
  });

  it('runs a plan task as a planning step (instruction injected end-to-end)', async () => {
    const res = await client.callTool('ceo_delegate', {
      task: { id: 'T-202', title: 'Launch plan', description: 'Plan the launch', plan: true },
      agent: 'researcher',
      execute: true,
    });
    expect(res.content[0].text).toMatch(/Status: done/);
    // The mock echoes the dispatched task text; PLANNING MODE proves task.plan
    // flowed handleDelegate -> tasks.create -> runner -> the injected instruction.
    const out = fs.readFileSync(path.join(ws, 'reports', 'tasks', 'T-202.md'), 'utf-8');
    expect(out).toMatch(/PLANNING MODE/);
  });

  it('ceo_run_task runs a separately delegated task', async () => {
    await client.callTool('ceo_delegate', {
      task: { id: 'T-201', title: 'Size the market' },
      agent: 'analyst',
    });
    const res = await client.callTool('ceo_run_task', { task_id: 'T-201' });
    expect(res.content[0].text).toMatch(/done/);
    expect(fs.existsSync(path.join(ws, 'reports', 'tasks', 'T-201.md'))).toBe(true);
  });
});
