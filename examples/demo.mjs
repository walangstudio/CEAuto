#!/usr/bin/env node
// examples/demo.mjs: drive CEAuto end-to-end over MCP, fully offline.
//
// Spawns the real server with CEAUTO_MOCK_LLM=1 (a built-in stub provider), so it
// runs the whole delegate -> heartbeat -> execute -> self-eval -> metrics loop
// without an API key and without spending a cent. State lands in a throwaway
// workspace, never in the repo.
//
//   node examples/demo.mjs [workspaceDir]
//
// Default workspace: <os tmpdir>/ceauto-demo. Pass a path to choose your own.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, '..', 'server.js');
const workspace =
  process.argv[2] || process.env.CEAUTO_WORKSPACE || path.join(os.tmpdir(), 'ceauto-demo');
fs.mkdirSync(workspace, { recursive: true });

const textOf = (res) => (res?.content || []).map((c) => c.text || '').join('').trim();
const step = (t) => console.log(`\n${'='.repeat(66)}\n${t}\n${'='.repeat(66)}`);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, CEAUTO_MOCK_LLM: '1', CEAUTO_WORKSPACE: workspace },
  stderr: 'ignore',
});
const client = new Client({ name: 'ceauto-demo', version: '1.0.0' }, { capabilities: {} });

try {
  await client.connect(transport);
  console.log(`CEAuto demo: offline (mock LLM, zero spend)\nWorkspace: ${workspace}`);

  const { tools } = await client.listTools();
  step(`1. Connected: ${tools.length} tools`);
  console.log(tools.map((t) => t.name).join(', '));

  step('2. ceo_boot: load state, return the standup');
  console.log(textOf(await client.callTool({ name: 'ceo_boot', arguments: {} })));

  step('3. ceo_delegate: queue work for the researcher (no execute, so it waits in the backlog)');
  console.log(
    textOf(
      await client.callTool({
        name: 'ceo_delegate',
        arguments: {
          agent: 'researcher',
          task: {
            title: 'Size the EV home-charging market',
            description: 'Estimate TAM/SAM/SOM for home EV chargers in North America.',
            priority: 'P1',
          },
          success_criteria: 'A defensible TAM/SAM/SOM with stated assumptions.',
        },
      })
    )
  );

  step('4. ceo_run_cycle: the heartbeat claims the task and runs it (offline)');
  console.log(textOf(await client.callTool({ name: 'ceo_run_cycle', arguments: {} })));

  step('5. ceo_metrics: throughput and spend');
  console.log(textOf(await client.callTool({ name: 'ceo_metrics', arguments: {} })));

  step('6. ceo_insights: playbooks, lessons, dispatch policy');
  console.log(textOf(await client.callTool({ name: 'ceo_insights', arguments: {} })));

  step('Done');
  console.log(`Look inside ${workspace}:`);
  console.log('  tasks/done.md          the task, now complete');
  console.log('  reports/tasks/*.md     the agent output');
  console.log('  db/memory.sqlite       tasks, ledger, evals, events');
} finally {
  try {
    await client.close();
  } catch {
    // already down (e.g. connect failed); nothing to close
  }
}
