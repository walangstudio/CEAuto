const policy = require('../../lib/policy');

const settings = {
  autonomy: {
    require_approval_for: ['shell_commands', 'external_communications'],
    approval_cost_threshold_usd: 5,
  },
};

describe('policy.requiresApproval', () => {
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
