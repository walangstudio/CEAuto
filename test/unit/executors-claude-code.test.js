const executors = require('../../lib/executors');

const NODE = process.execPath;
const ECHO = 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write("CC:"+d))';
const JSON_OUT = 'process.stdout.write(JSON.stringify({result:"done",usage:{input_tokens:11,output_tokens:22}}))';

describe('claude-code executor', () => {
  it('is disabled by default (high blast radius)', async () => {
    await expect(
      executors.execute('claude-code', { agent: 'coder', task: 't', context: '', params: { command: NODE, args: ['-e', ECHO] } }, {})
    ).rejects.toThrow(/disabled/);
  });

  it('runs the configured command with the prompt on stdin when enabled', async () => {
    const res = await executors.execute(
      'claude-code',
      { agent: 'coder', agentSpec: 'SPEC', task: 'build feature', context: 'CTX', params: { command: NODE, args: ['-e', ECHO] } },
      { claudeCode: { enabled: true } }
    );
    expect(res.text).toContain('SPEC');
    expect(res.text).toContain('CTX');
    expect(res.text).toContain('build feature');
    expect(res.usage.provider).toBe('claude-code');
  });

  it('parses { result, usage } from JSON output', async () => {
    const res = await executors.execute(
      'claude-code',
      { agent: 'coder', task: 't', context: '', params: { command: NODE, args: ['-e', JSON_OUT], outputFormat: 'json' } },
      { claudeCode: { enabled: true } }
    );
    expect(res.text).toBe('done');
    expect(res.usage.input_tokens).toBe(11);
    expect(res.usage.output_tokens).toBe(22);
  });
});
