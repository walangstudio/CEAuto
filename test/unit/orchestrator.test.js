const fs = require('fs');
const path = require('path');
const memory = require('../../lib/memory');
const orchestrator = require('../../lib/orchestrator');
const { makeMockDispatch } = require('../helpers/mock-llm');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

const WORKFLOW = `---
steps:
  - id: research
    agent: researcher
    task: "Research {{goal}}"
    output_path: reports/research-{{date}}.md
  - id: write
    agent: writer
    task: "Summarise {{results.research}}"
    depends_on: [research]
---
# Test workflow
`;

describe('orchestrator.run', () => {
  let ws;

  beforeEach(() => {
    ws = makeTmpWorkspace({
      'workflows/test.md': WORKFLOW,
      'subagents/researcher.md': 'You are the researcher.',
      'subagents/writer.md': 'You are the writer.',
    });
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
  });

  afterEach(() => {
    memory.close();
    cleanup(ws);
  });

  it('runs steps in order, passes deps as context, writes outputs', async () => {
    const dispatch = makeMockDispatch({
      responder: (agentId, _spec, task) => `[${agentId}] ${task}`,
    });

    const report = await orchestrator.run('test', 'market sizing', {}, ws, memory, { dispatch });

    expect(report).toMatch(/Step: research/);
    expect(report).toMatch(/Step: write/);
    expect(report).toMatch(/Complete/);
    // research output file written
    const files = fs.readdirSync(path.join(ws, 'reports'));
    expect(files.some(f => f.startsWith('research-'))).toBe(true);
    // writer step received researcher output as context (mock echoes the task,
    // which the orchestrator filled from {{results.research}})
    expect(dispatch.calls[1].task).toMatch(/researcher/);
  });

  it('reports a missing workflow gracefully', async () => {
    const report = await orchestrator.run('nope', 'x', {}, ws, memory, { dispatch: makeMockDispatch() });
    expect(report).toMatch(/not found/);
  });

  it('a STOP that lands mid-workflow halts the remaining steps', async () => {
    let calls = 0;
    const dispatch = async () => {
      calls += 1;
      if (calls === 1) {
        fs.mkdirSync(path.join(ws, 'comms'), { recursive: true });
        fs.writeFileSync(path.join(ws, 'comms', 'STOP'), '');
      }
      return { text: 'ok', usage: { input_tokens: 1, output_tokens: 1, model: 'mock-model', provider: 'mock' } };
    };
    const report = await orchestrator.run('test', 'goal', {}, ws, memory, { dispatch });
    expect(calls).toBe(1); // step 2 never dispatched
    expect(report).toMatch(/Halted/);
  });
});
