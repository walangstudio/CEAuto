const path = require('path');
const executors = require('../../lib/executors');
const { makeMockDispatch } = require('../helpers/mock-llm');

const ECHO_SERVER = path.resolve(__dirname, '../fixtures/echo-mcp-server.js');
const NODE = process.execPath;
const NODE_BASE = path.basename(NODE);

describe('executors', () => {
  it('llm executor wraps the injected dispatch', async () => {
    const dispatch = makeMockDispatch({ responder: () => 'hello from llm' });
    const res = await executors.execute(
      'llm',
      { agent: 'researcher', agentSpec: 'spec', task: 'do it', context: '' },
      { dispatch }
    );
    expect(res.text).toBe('hello from llm');
    expect(res.usage.provider).toBe('mock');
  });

  it('unknown executor falls back to llm', async () => {
    const dispatch = makeMockDispatch({ responder: () => 'fallback' });
    const res = await executors.execute('does-not-exist', { agent: 'x', agentSpec: '', task: 't', context: '' }, { dispatch });
    expect(res.text).toBe('fallback');
  });

  it('shell executor runs an allowlisted command and captures stdout', async () => {
    const res = await executors.execute(
      'shell',
      {
        agent: 'ops',
        task: 'payload',
        context: '',
        params: {
          command: NODE,
          args: ['-e', 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write("ran:"+d))'],
        },
      },
      { shellAllowlist: [NODE_BASE] }
    );
    expect(res.text).toBe('ran:payload');
    expect(res.usage.provider).toBe('shell');
  });

  it('shell executor refuses a command not in the allowlist', async () => {
    await expect(
      executors.execute('shell', { agent: 'ops', task: 't', params: { command: NODE, args: ['-e', '0'] } }, { shellAllowlist: [] })
    ).rejects.toThrow(/allowlist/);
  });

  it('mcp-tool executor calls a tool on another MCP server', async () => {
    const res = await executors.execute(
      'mcp-tool',
      {
        agent: 'research-bot',
        task: 'sizing',
        context: 'ctx',
        params: { command: NODE, args: [ECHO_SERVER], tool: 'echo', arguments: { q: 'hi' } },
      },
      {}
    );
    expect(res.text).toMatch(/^echo:/);
    expect(res.text).toContain('"q":"hi"');
    expect(res.usage.provider).toBe('mcp');
    expect(res.usage.model).toBe('echo');
  });
});
