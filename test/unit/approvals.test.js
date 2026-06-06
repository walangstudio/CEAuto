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

  it('needs a quorum of distinct approvers before it flips to approved', () => {
    const id = approvals.request({ kind: 'decision', ref_id: 'DEC-Q', summary: 'big pivot', quorum: 2 });
    approvals.approve(id, 'alice');
    expect(approvals.get(id).status).toBe('pending'); // 1 of 2
    expect(approvals.isApproved('decision', 'DEC-Q')).toBe(false);

    approvals.approve(id, 'alice'); // same approver re-voting must NOT count twice
    expect(approvals.get(id).status).toBe('pending');

    approvals.approve(id, 'bob'); // 2 of 2 distinct
    expect(approvals.get(id).status).toBe('approved');
    expect(approvals.isApproved('decision', 'DEC-Q')).toBe(true);
  });

  it('a single reject vetoes a quorum approval', () => {
    const id = approvals.request({ kind: 'decision', ref_id: 'DEC-V', summary: 'risky', quorum: 3 });
    approvals.approve(id, 'alice');
    approvals.reject(id, 'bob', 'no');
    expect(approvals.get(id).status).toBe('rejected');
  });

  it('a repeat vote on an already-resolved approval is a no-op (returns null)', () => {
    const id = approvals.request({ kind: 'budget', ref_id: 'T-R', summary: 'hold' });
    expect(approvals.approve(id, 'ceo').status).toBe('approved');
    expect(approvals.approve(id, 'ceo')).toBe(null); // already resolved → no-op
    expect(approvals.get(id).status).toBe('approved');
  });

  it('renders the approvals markdown', () => {
    approvals.request({ kind: 'decision', ref_id: 'DEC-2', summary: 'acquire co' });
    approvals.renderApprovals(ws);
    const md = fs.readFileSync(path.join(ws, 'comms', 'approvals.md'), 'utf-8');
    expect(md).toContain('DEC-2');
    expect(md).toContain('pending');
  });
});
