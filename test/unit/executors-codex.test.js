const executors = require('../../lib/executors');

const NODE = process.execPath;
// stand-in for `codex exec`: echoes back whatever arrived on stdin
const ECHO = 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write("CDX:"+d))';
const JSON_OUT = 'process.stdout.write(JSON.stringify({result:"shipped",usage:{input_tokens:7,output_tokens:9}}))';

describe('codex executor', () => {
  it('is disabled by default (high blast radius)', async () => {
    await expect(
      executors.execute('codex', { agent: 'coder', task: 't', context: '', params: { command: NODE, args: ['-e', ECHO] } }, {})
    ).rejects.toThrow(/disabled/);
  });

  it('runs the configured command with the prompt on stdin when enabled', async () => {
    const res = await executors.execute(
      'codex',
      { agent: 'coder', agentSpec: 'SPEC', task: 'build feature', context: 'CTX', params: { command: NODE, args: ['-e', ECHO] } },
      { codex: { enabled: true } }
    );
    expect(res.text).toContain('SPEC');
    expect(res.text).toContain('CTX');
    expect(res.text).toContain('build feature');
    expect(res.usage.provider).toBe('codex');
  });

  it('parses { result, usage } from JSON output', async () => {
    const res = await executors.execute(
      'codex',
      { agent: 'coder', task: 't', context: '', params: { command: NODE, args: ['-e', JSON_OUT], outputFormat: 'json' } },
      { codex: { enabled: true } }
    );
    expect(res.text).toBe('shipped');
    expect(res.usage.input_tokens).toBe(7);
    expect(res.usage.output_tokens).toBe(9);
  });

  it('is reachable through the runner deps wiring (config-bound, not task-set)', async () => {
    // deps.codex comes from settings.executors.codex — a task cannot enable it
    await expect(
      executors.execute('codex', { agent: 'coder', task: 't', params: {} }, { codex: {} })
    ).rejects.toThrow(/disabled/);
  });

  // The production path: command/args come from settings (deps.codex), not params.
  it('uses cfg.command / cfg.args from settings when params omit them', async () => {
    const res = await executors.execute(
      'codex',
      { agent: 'coder', task: 'from settings', context: '', params: {} },
      { codex: { enabled: true, command: NODE, args: ['-e', ECHO] } }
    );
    expect(res.text).toContain('from settings');
    expect(res.usage.provider).toBe('codex');
  });

  // $0 pricing is only honest if the CLI can't fall back to API billing.
  it('strips provider API keys from the child env (subscription billing by construction)', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
    try {
      const DUMP = 'process.stdout.write(JSON.stringify({a:process.env.ANTHROPIC_API_KEY||null,o:process.env.OPENAI_API_KEY||null}))';
      const res = await executors.execute(
        'codex',
        { agent: 'coder', task: 't', context: '', params: { command: NODE, args: ['-e', DUMP] } },
        { codex: { enabled: true } }
      );
      expect(JSON.parse(res.text)).toEqual({ a: null, o: null });
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('passApiKeys:true opts back in to inheriting the key', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-deliberate';
    try {
      const DUMP = 'process.stdout.write(String(process.env.ANTHROPIC_API_KEY||"none"))';
      const res = await executors.execute(
        'codex',
        { agent: 'coder', task: 't', context: '', params: { command: NODE, args: ['-e', DUMP], passApiKeys: true } },
        { codex: { enabled: true } }
      );
      expect(res.text).toBe('sk-deliberate');
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
