/**
 * mcp-tool executor — the differentiator. Runs a task by calling a tool on
 * ANOTHER MCP server (spawned over stdio), so any MCP server in the ecosystem
 * (mememo, ChatGipite, …) becomes an agent runtime for free. The protocol is
 * the adapter.
 *
 * params: { command, args?, env?, tool, arguments? }
 *   arguments defaults to { task, context }.
 */

const { spawn } = require('child_process');
const readline = require('readline');
const { estimateTokens } = require('../llm-adapter');

async function mcpTool(ctx, _deps = {}) {
  const params = ctx.params || {};
  const { command, args = [], env = {}, tool } = params;
  if (!command || !tool) throw new Error('mcp-tool executor: params.command and params.tool are required');

  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map();
  let nextId = 1;
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (raw) => {
    const line = raw.trim();
    if (!line) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || 'mcp error'));
      else resolve(msg.result);
    }
  });

  function send(obj) {
    child.stdin.write(JSON.stringify(obj) + '\n');
  }
  function request(method, p) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ jsonrpc: '2.0', id, method, params: p });
    });
  }

  try {
    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ceauto', version: '0' },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const toolArgs = params.arguments || { task: ctx.task, context: ctx.context };
    const result = await request('tools/call', { name: tool, arguments: toolArgs });
    const text = (result.content || []).map(c => c.text || '').join('\n');

    return {
      text,
      usage: {
        input_tokens: estimateTokens(`${ctx.task}${ctx.context}`),
        output_tokens: estimateTokens(text),
        model: tool,
        provider: 'mcp',
      },
    };
  } finally {
    try {
      child.stdin.end();
      child.kill();
    } catch {
      // already gone
    }
  }
}

module.exports = mcpTool;
