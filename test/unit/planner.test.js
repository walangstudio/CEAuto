const planner = require('../../lib/planner');

describe('planner.buildPlanInstruction', () => {
  it('asks for a ceauto directive within the subtask bound and roster', () => {
    const txt = planner.buildPlanInstruction({ agents: ['coder', 'ops'], maxSubtasks: 3 });
    expect(txt).toMatch(/PLANNING MODE/);
    expect(txt).toMatch(/```ceauto/);
    expect(txt).toMatch(/2[–-]3/); // 2 to maxSubtasks
    expect(txt).toMatch(/coder, ops/);
    expect(txt).toMatch(/Do NOT perform/i);
  });

  it('falls back to the default roster and default bound', () => {
    const txt = planner.buildPlanInstruction();
    expect(txt).toContain('researcher, coder, analyst, writer, ops, security, comms');
    expect(txt).toContain(`2–${planner.DEFAULT_MAX_SUBTASKS}`); // en-dash 2–5
  });
});
