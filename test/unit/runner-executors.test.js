const fs = require('fs');
const path = require('path');
const memory = require('../../lib/memory');
const tasks = require('../../lib/tasks');
const budget = require('../../lib/budget');
const runner = require('../../lib/runner');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

const NODE = process.execPath;
const ECHO_SERVER = path.resolve(__dirname, '../fixtures/echo-mcp-server.js');

describe('runner routes tasks through the configured executor', () => {
  let ws;

  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
    budget.configure({
      pricing: { default: { input: 0, output: 0 } },
      budgets: { per_agent_daily_tokens: 1e9, per_session_tokens: 1e9, global_daily_tokens: 1e9, global_daily_usd: 1e9 },
    });
  });

  afterEach(() => {
    budget.resetConfig();
    memory.close();
    cleanup(ws);
  });

  it('runs an agent via the shell executor', async () => {
    tasks.create({ id: 'T-sh', title: 'shell task', agent: 'ops', status: 'in-progress' });
    const settings = {
      autonomy: { self_evaluate: false },
      executors: {
        default: 'llm',
        by_agent: { ops: 'shell' },
        agent_params: {
          ops: { command: NODE, args: ['-e', 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write("shell-ran:"+d.length))'] },
        },
        shell: { allowlist: [NODE] },
      },
    };

    const res = await runner.runTask('T-sh', { workspace: ws, settings });
    expect(res.status).toBe('done');
    const out = fs.readFileSync(path.join(ws, res.resultPath), 'utf-8');
    expect(out).toMatch(/^shell-ran:/);
  });

  it('runs an agent via the mcp-tool executor (another MCP server)', async () => {
    tasks.create({ id: 'T-mcp', title: 'mcp task', description: 'sizing', agent: 'research-bot', status: 'in-progress' });
    const settings = {
      autonomy: { self_evaluate: false },
      executors: {
        default: 'llm',
        by_agent: { 'research-bot': 'mcp-tool' },
        agent_params: {
          'research-bot': { command: NODE, args: [ECHO_SERVER], tool: 'echo' },
        },
      },
    };

    const res = await runner.runTask('T-mcp', { workspace: ws, settings });
    expect(res.status).toBe('done');
    const out = fs.readFileSync(path.join(ws, res.resultPath), 'utf-8');
    expect(out).toMatch(/^echo:/);
  });
});
