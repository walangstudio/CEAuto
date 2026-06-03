const fs = require('fs');
const path = require('path');
const memory = require('../../lib/memory');
const approvals = require('../../lib/approvals');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('approvals queue', () => {
  let ws;

  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
  });

  afterEach(() => {
    memory.close();
    cleanup(ws);
  });

  it('requests, lists pending, approves', () => {
    const id = approvals.request({ kind: 'decision', ref_id: 'DEC-1', summary: 'pivot' });
    expect(approvals.pending().map(r => r.id)).toContain(id);
    expect(approvals.isApproved('decision', 'DEC-1')).toBe(false);

    approvals.approve(id, 'ceo', 'go');
    expect(approvals.isApproved('decision', 'DEC-1')).toBe(true);
    expect(approvals.pending()).toHaveLength(0);
  });

  it('rejects and does not mark approved', () => {
    const id = approvals.request({ kind: 'budget', ref_id: 'T-9', summary: 'overage' });
    approvals.reject(id, 'ceo', 'too risky');
    expect(approvals.isApproved('budget', 'T-9')).toBe(false);
    expect(approvals.get(id).status).toBe('rejected');
  });

  it('renders the approvals markdown', () => {
    approvals.request({ kind: 'decision', ref_id: 'DEC-2', summary: 'acquire co' });
    approvals.renderApprovals(ws);
    const md = fs.readFileSync(path.join(ws, 'comms', 'approvals.md'), 'utf-8');
    expect(md).toContain('DEC-2');
    expect(md).toContain('pending');
  });
});
