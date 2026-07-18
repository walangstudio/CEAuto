const fs = require('fs');
const path = require('path');
const { createClient } = require('../helpers/mcp-client');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('governance over MCP', () => {
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

  it('strategic decision is gated pending approval', async () => {
    const res = await client.callTool('ceo_decide', {
      decision: 'Acquire competitor',
      rationale: 'consolidate market',
      decision_type: 'strategic',
    });
    expect(res.content[0].text).toMatch(/Pending approval/);

    const list = await client.callTool('ceo_list_approvals', { status: 'pending' });
    expect(list.content[0].text).toMatch(/Acquire competitor/);
  });

  it('tactical decision is in effect immediately', async () => {
    const res = await client.callTool('ceo_decide', {
      decision: 'Reassign T-1 to coder',
      rationale: 'load balancing',
      decision_type: 'delegation',
    });
    expect(res.content[0].text).toMatch(/In effect/);
  });

  it('a vetoed task is blocked, never executed', async () => {
    await client.callTool('ceo_delegate', {
      task: { id: 'T-veto', title: 'Risky deploy' },
      agent: 'ops',
    });
    fs.writeFileSync(path.join(ws, 'comms', 'vetos.md'), '# Vetos\n\n- T-veto: do not deploy on Friday\n');

    const res = await client.callTool('ceo_run_task', { task_id: 'T-veto' });
    expect(res.content[0].text).toMatch(/vetoed/);
    expect(fs.existsSync(path.join(ws, 'reports', 'tasks', 'T-veto.md'))).toBe(false);
  });

  it('approve/resolve flow updates status', async () => {
    await client.callTool('ceo_request_approval', { kind: 'task', ref_id: 'T-x', summary: 'needs sign-off' });
    const pending = await client.callTool('ceo_list_approvals', { status: 'pending' });
    const m = pending.content[0].text.match(/#(\d+) \[pending\] task T-x/);
    expect(m).toBeTruthy();
    const id = Number(m[1]);
    const res = await client.callTool('ceo_resolve_approval', { id, decision: 'approve', by: 'ceo' });
    expect(res.content[0].text).toMatch(/approved/);
  });

  async function pendingIdFor(refId) {
    const pending = await client.callTool('ceo_list_approvals', { status: 'pending' });
    const m = pending.content[0].text.match(new RegExp(`#(\\d+) \\[pending\\] task ${refId}`));
    return m && Number(m[1]);
  }

  it('rejecting a task approval blocks the task (terminal, does not reopen)', async () => {
    await client.callTool('ceo_delegate', { task: { id: 'T-rej2', title: 'gated work' }, agent: 'ops', needs_approval: true });
    await client.callTool('ceo_run_task', { task_id: 'T-rej2' }); // opens the approval
    const id = await pendingIdFor('T-rej2');
    await client.callTool('ceo_resolve_approval', { id, decision: 'reject', by: 'ceo' });
    const res = await client.callTool('ceo_run_task', { task_id: 'T-rej2' });
    expect(res.content[0].text).toMatch(/rejected/i); // terminal, not re-gated
  });

  it('rejecting a stale approval does NOT un-complete a done task', async () => {
    await client.callTool('ceo_delegate', { task: { id: 'T-done1', title: 'work' }, agent: 'ops', needs_approval: true });
    await client.callTool('ceo_run_task', { task_id: 'T-done1' }); // opens the approval
    const id = await pendingIdFor('T-done1');
    await client.callTool('ceo_complete_task', { task_id: 'T-done1' }); // human force-completes
    await client.callTool('ceo_resolve_approval', { id, decision: 'reject', by: 'ceo' }); // stale reject
    const res = await client.callTool('ceo_run_task', { task_id: 'T-done1' });
    expect(res.content[0].text).toMatch(/already done/i); // still done, not flipped to blocked
  });
});
