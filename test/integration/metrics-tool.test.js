const fs = require('fs');
const path = require('path');
const { createClient } = require('../helpers/mcp-client');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('ceo_metrics + ceo_run_cycle over MCP', () => {
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

  it('exposes the full expanded toolset', async () => {
    const res = await client.listTools();
    const names = res.tools.map((t) => t.name);
    for (const t of ['ceo_run_task', 'ceo_run_cycle', 'ceo_metrics', 'ceo_request_approval', 'ceo_resolve_approval', 'ceo_list_approvals']) {
      expect(names).toContain(t);
    }
    expect(names.length).toBe(15);
  });

  it('runs a cycle then reports metrics', async () => {
    await client.callTool('ceo_delegate', { task: { id: 'T-300', title: 'Scope feature' }, agent: 'analyst' });
    const cycle = await client.callTool('ceo_run_cycle', {});
    expect(cycle.content[0].text).toMatch(/ran 1, done 1/);

    const m = await client.callTool('ceo_metrics', {});
    expect(m.content[0].text).toMatch(/CEAuto Metrics/);
    expect(fs.existsSync(path.join(ws, 'reports', 'metrics.md'))).toBe(true);
  });
});
