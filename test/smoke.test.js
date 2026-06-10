const { createClient } = require('./helpers/mcp-client');
const { makeTmpWorkspace, cleanup } = require('./helpers/tmp-workspace');

describe('MCP server smoke', () => {
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

  it('exposes the core CEO tools', async () => {
    const res = await client.listTools();
    const names = res.tools.map((t) => t.name);
    for (const t of [
      'ceo_boot',
      'ceo_delegate',
      'ceo_decide',
      'ceo_generate_standup',
      'ceo_create_directive',
      'ceo_report_blocker',
      'ceo_complete_task',
      'ceo_recall',
      'ceo_workflow',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('boots and returns a standup', async () => {
    const res = await client.callTool('ceo_boot', {});
    const text = res.content[0].text;
    expect(text).toMatch(/Boot Complete/);
    expect(text).toMatch(/Daily Standup/);
  });

  it('records and recalls a decision', async () => {
    await client.callTool('ceo_decide', {
      decision: 'Adopt heartbeat autonomy',
      rationale: 'Move from reactive to self-directed operation',
      persona: 'grove',
      decision_type: 'strategic',
    });
    const res = await client.callTool('ceo_recall', { query: 'heartbeat' });
    expect(res.content[0].text).toMatch(/heartbeat/i);
  });
});
