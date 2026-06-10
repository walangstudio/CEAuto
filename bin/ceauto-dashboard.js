#!/usr/bin/env node
/**
 * ceauto-dashboard.js — serve the read-only local status page without running
 * the autonomy loop. Binds 127.0.0.1 by default. `npm run dashboard`.
 */

const path = require('path');
const memory = require('../lib/memory');
const httpServer = require('../lib/http-server');
const dashboard = require('../lib/dashboard');

const PKG_ROOT = path.resolve(__dirname, '..');
const WORKSPACE = process.env.CEAUTO_WORKSPACE ? path.resolve(process.env.CEAUTO_WORKSPACE) : PKG_ROOT;

function loadSettings() {
  try {
    const fs = require('fs');
    const yaml = require('js-yaml');
    return yaml.load(fs.readFileSync(path.join(PKG_ROOT, 'config', 'settings.yaml'), 'utf-8')) || {};
  } catch {
    return {};
  }
}

async function main() {
  memory.init(path.join(WORKSPACE, 'db', 'memory.sqlite'));
  const cfg = (loadSettings().dashboard) || {};
  const handle = await httpServer.start({
    host: cfg.host || '127.0.0.1',
    port: cfg.port || 8788,
    routes: dashboard.routes(),
  });
  process.stderr.write(`CEAuto dashboard on http://${handle.host}:${handle.port}/\n`);

  const shutdown = async () => {
    try { await handle.stop(); } catch { /* ignore */ }
    try { memory.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e.message}\n`);
  process.exit(1);
});
