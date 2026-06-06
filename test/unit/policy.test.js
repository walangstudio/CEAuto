const policy = require('../../lib/policy');

const settings = {
  autonomy: {
    require_approval_for: ['shell_commands', 'external_communications'],
    approval_cost_threshold_usd: 5,
  },
};

describe('policy.requiresApproval', () => {
  beforeEach(() => policy.configure([])); // hermetic: legacy fallback unless a test sets rules
  afterEach(() => policy.resetConfig());

  it('gates strategic decisions', () => {
    expect(policy.requiresApproval({ decision_type: 'strategic' }, settings).required).toBe(true);
  });

  it('allows tactical decisions', () => {
    expect(policy.requiresApproval({ decision_type: 'delegation' }, settings).required).toBe(false);
  });

  it('gates policy-listed action kinds', () => {
    expect(policy.requiresApproval({ kind: 'shell_commands' }, settings).required).toBe(true);
    expect(policy.requiresApproval({ kind: 'file_read' }, settings).required).toBe(false);
  });

  it('gates budget overage and high estimated cost', () => {
    expect(policy.requiresApproval({ budget_overage: true }, settings).required).toBe(true);
    expect(policy.requiresApproval({ est_cost_usd: 9 }, settings).required).toBe(true);
    expect(policy.requiresApproval({ est_cost_usd: 1 }, settings).required).toBe(false);
  });
});

describe('policy-as-code (rules)', () => {
  afterEach(() => policy.resetConfig());

  it('a matching rule wins and carries its quorum', () => {
    policy.configure([
      { match: { decision_type: 'strategic' }, require_approval: true, reason: 'one-way door', quorum: 2 },
    ]);
    const r = policy.requiresApproval({ decision_type: 'strategic' }, {});
    expect(r.required).toBe(true);
    expect(r.quorum).toBe(2);
    expect(r.reason).toBe('one-way door');
  });

  it('kind_in and est_cost_usd_over match', () => {
    policy.configure([
      { match: { kind_in: ['file_deletion', 'shell_commands'] }, require_approval: true },
      { match: { est_cost_usd_over: 50 }, require_approval: true, quorum: 2 },
    ]);
    expect(policy.requiresApproval({ kind: 'file_deletion' }, {}).required).toBe(true);
    expect(policy.requiresApproval({ kind: 'file_read' }, {}).required).toBe(false);
    expect(policy.requiresApproval({ est_cost_usd: 80 }, {}).quorum).toBe(2);
    expect(policy.requiresApproval({ est_cost_usd: 10 }, {}).required).toBe(false);
  });

  it('an explicit allow rule short-circuits the legacy gate', () => {
    policy.configure([{ match: { decision_type: 'strategic' }, require_approval: false }]);
    // legacy would gate strategic; the rule allows it
    expect(policy.requiresApproval({ decision_type: 'strategic' }, {}).required).toBe(false);
  });

  it('falls back to legacy gates when no rule matches', () => {
    policy.configure([{ match: { kind: 'file_deletion' }, require_approval: true }]);
    expect(policy.requiresApproval({ decision_type: 'strategic' }, {}).required).toBe(true); // legacy
  });

  it('a matched rule without an explicit verdict does NOT silently gate', () => {
    // require_approval omitted → not a decision → fall through to legacy (here: allow)
    policy.configure([{ match: { kind: 'logging' } }]);
    expect(policy.requiresApproval({ kind: 'logging' }, {}).required).toBe(false);
  });
});
