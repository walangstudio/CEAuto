const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SERVER = path.resolve(__dirname, '../../server.js');

/**
 * Spawn server.js and speak newline-delimited JSON-RPC over stdio
 * (the framing MCP's StdioServerTransport uses).
 */
function createClient({ workspace, env = {} } = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      ...(workspace ? { CEAUTO_WORKSPACE: workspace } : {}),
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map();
  let nextId = 1;
  let stderr = '';

  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });

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
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  function send(obj) {
    child.stdin.write(JSON.stringify(obj) + '\n');
  }

  function request(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ jsonrpc: '2.0', id, method, params });
    });
  }

  function notify(method, params = {}) {
    send({ jsonrpc: '2.0', method, params });
  }

  async function init() {
    const res = await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ceauto-test', version: '0' },
    });
    notify('notifications/initialized');
    return res;
  }

  function listTools() {
    return request('tools/list', {});
  }

  function callTool(name, args = {}) {
    return request('tools/call', { name, arguments: args });
  }

  function close() {
    return new Promise((resolve) => {
      const done = () => resolve(stderr);
      child.on('exit', done);
      try {
        child.stdin.end();
      } catch {
        // already closed
      }
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          // already gone
        }
        resolve(stderr);
      }, 1000);
    });
  }

  return {
    child,
    init,
    listTools,
    callTool,
    request,
    notify,
    close,
    get stderr() {
      return stderr;
    },
  };
}

module.exports = { createClient };
