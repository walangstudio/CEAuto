const org = require('../../lib/org');

const ORG = {
  roles: {
    ceo: { budget: { daily_tokens: 1000, daily_usd: 10 }, can_delegate_to: ['eng', 'research'] },
    eng: { reports_to: 'ceo', members: ['coder', 'security'], budget: { daily_tokens: 400 }, can_delegate_to: ['eng'] },
    research: { reports_to: 'ceo', members: ['researcher'], budget: { daily_tokens: 300 } },
    backend: { reports_to: 'eng', members: ['db'] },
  },
};

describe('org graph', () => {
  beforeEach(() => org.configure(ORG));
  afterEach(() => org.resetConfig());

  it('resolves an agent to its role', () => {
    expect(org.roleOf('coder')).toBe('eng');
    expect(org.roleOf('researcher')).toBe('research');
    expect(org.roleOf('nobody')).toBe(null);
  });

  it('walks the reporting line to the root', () => {
    expect(org.ancestorsOf('backend')).toEqual(['backend', 'eng', 'ceo']);
    expect(org.ancestorsOf('research')).toEqual(['research', 'ceo']);
  });

  it('collects every agent in a role subtree', () => {
    // eng + its descendant backend
    expect(org.agentsInRole('eng').sort()).toEqual(['coder', 'db', 'security']);
    expect(org.agentsInRole('ceo').sort()).toEqual(['coder', 'db', 'researcher', 'security']);
  });

  it('enforces delegation authority', () => {
    expect(org.canDelegate('ceo', 'coder')).toBe(true); // ceo -> eng allowed
    expect(org.canDelegate('research', 'coder')).toBe(false); // research can't delegate to eng
    expect(org.canDelegate('eng', 'security')).toBe(true); // eng -> eng
  });

  it('rolls a subtree spend up to ancestor budgets', () => {
    // coder belongs to eng (cap 400) under ceo (cap 1000). Pretend the whole eng
    // subtree has already spent 380 tokens; a 30-token task breaches eng's 400.
    const spentByAgents = (agents) => {
      // eng subtree spend
      if (agents.includes('coder')) return { tokens: 380, usd: 0 };
      return { tokens: 0, usd: 0 };
    };
    const res = org.checkBudgets('coder', 30, { spentByAgents });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/role eng daily token cap/);
  });

  it('passes when under every ancestor budget', () => {
    const spentByAgents = () => ({ tokens: 10, usd: 0 });
    expect(org.checkBudgets('coder', 50, { spentByAgents }).ok).toBe(true);
  });

  it('breaches an ancestor (ceo) even when the immediate role is fine', () => {
    // research cap is 300; ceo cap is 1000. research spent 50 (fine), but the
    // whole ceo subtree spent 990 → a 20-token task breaches ceo.
    const spentByAgents = (agents) => {
      if (agents.length > 1) return { tokens: 990, usd: 0 }; // ceo subtree
      return { tokens: 50, usd: 0 }; // research subtree (just 'researcher')
    };
    const res = org.checkBudgets('researcher', 20, { spentByAgents });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/role ceo daily token cap/);
  });

  it('an agent outside the org is unconstrained', () => {
    expect(org.checkBudgets('freelancer', 1e9, { spentByAgents: () => ({ tokens: 0, usd: 0 }) }).ok).toBe(true);
  });
});
