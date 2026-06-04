#!/usr/bin/env node
// Minimal stub MCP server (newline-delimited JSON-RPC) for executor tests.
// Implements initialize + tools/call(name='echo') -> echoes the arguments.

const readline = require('readline');

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (raw) => {
  const line = raw.trim();
  if (!line) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'echo', version: '0' } } });
  } else if (msg.method === 'tools/call') {
    const args = (msg.params && msg.params.arguments) || {};
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + JSON.stringify(args) }] } });
  } else if (msg.id != null) {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
});
