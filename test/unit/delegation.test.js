const { parseDirective } = require('../../lib/delegation');

describe('delegation.parseDirective', () => {
  it('parses a fenced ceauto directive with subtasks', () => {
    const text = 'Here is my plan.\n\n```ceauto\n{ "subtasks": [ { "title": "build API", "agent": "coder" }, { "title": "write docs" } ] }\n```\n';
    const d = parseDirective(text);
    expect(d.subtasks).toHaveLength(2);
    expect(d.subtasks[0]).toMatchObject({ title: 'build API', agent: 'coder' });
    expect(d.subtasks[1].agent).toBeUndefined();
    expect(d.escalate).toBe(null);
  });

  it('parses an escalation', () => {
    const d = parseDirective('```ceauto\n{ "escalate": { "reason": "needs a strategic call" } }\n```');
    expect(d.escalate.reason).toBe('needs a strategic call');
    expect(d.subtasks).toEqual([]);
  });

  it('returns null for normal text with no directive', () => {
    expect(parseDirective('just a normal answer, no directive here')).toBe(null);
  });

  it('returns null for a malformed directive (bad JSON)', () => {
    expect(parseDirective('```ceauto\n{ not json }\n```')).toBe(null);
  });

  it('returns null when the block has neither subtasks nor escalate', () => {
    expect(parseDirective('```ceauto\n{ "notes": "hi" }\n```')).toBe(null);
  });

  it('drops subtasks with no title/description', () => {
    const d = parseDirective('```ceauto\n{ "subtasks": [ { "agent": "coder" }, { "title": "ok" } ] }\n```');
    expect(d.subtasks).toHaveLength(1);
    expect(d.subtasks[0].title).toBe('ok');
  });

  it('handles null/non-string input', () => {
    expect(parseDirective(null)).toBe(null);
    expect(parseDirective(42)).toBe(null);
  });
});
