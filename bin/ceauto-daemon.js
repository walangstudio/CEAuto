#!/usr/bin/env node
/**
 * ceauto-daemon.js — the always-on autonomy loop.
 *
 * Acquires a single-instance lock, then runs heartbeat.runCycle on a cron
 * schedule (settings.autonomy.heartbeat_cron). `--once` runs a single cycle and
 * exits (used by `npm run cycle` and the e2e test). Default-off: nothing starts
 * this unless a human runs it. Cost is bounded by the budget caps that landed
 * before this loop existed.
 */

const fs = require('fs');
const path = require('path');
const memory = require('../lib/memory');
const heartbeat = require('../lib/heartbeat');
const lock = require('../lib/lock');
const evaluator = require('../lib/evaluator');
const approvals = require('../lib/approvals');
const hooksRunner = require('../lib/hooks-runner');

const PKG_ROOT = path.resolve(__dirname, '..');
const WORKSPACE = process.env.CEAUTO_WORKSPACE
  ? path.resolve(process.env.CEAUTO_WORKSPACE)
  : PKG_ROOT;

function loadSettings() {
  try {
    const yaml = require('js-yaml');
    return yaml.load(fs.readFileSync(path.join(PKG_ROOT, 'config', 'settings.yaml'), 'utf-8')) || {};
  } catch {
    return {};
  }
}

function buildDeps(settings, pid) {
  return {
    workspace: WORKSPACE,
    pkgRoot: PKG_ROOT,
    sessionId: `daemon-${pid}`,
    settings,
    log: (m) => process.stderr.write(`${m}\n`),
    evaluate: (ctx) => evaluator.selfEval(ctx),
    requestApproval: (task, reason) => {
      approvals.request({ kind: 'budget', ref_id: task.id, summary: reason, detail: { agent: task.agent } });
      approvals.renderApprovals(WORKSPACE);
    },
    hooks: (name, ctx) => hooksRunner.run(name, { workspace: WORKSPACE, ...ctx }, { pkgRoot: PKG_ROOT }),
  };
}

async function main() {
  const once = process.argv.includes('--once');
  memory.init(path.join(WORKSPACE, 'db', 'memory.sqlite'));

  const pid = process.pid;
  if (!lock.acquire(pid)) {
    const h = lock.holder();
    process.stderr.write(`CEAuto daemon: another instance (pid ${h && h.pid}) holds the lock — exiting\n`);
    process.exit(1);
    return;
  }

  const settings = loadSettings();
  const deps = buildDeps(settings, pid);

  const cleanup = () => {
    lock.release(pid);
    try {
      memory.close();
    } catch {
      // already closed
    }
  };

  if (once) {
    const res = await heartbeat.runCycle(deps);
    process.stderr.write(`CEAuto cycle complete: ${JSON.stringify(res.results || [])}\n`);
    cleanup();
    process.exit(0);
    return;
  }

  const cron = require('node-cron');
  const expr = (settings.autonomy && settings.autonomy.heartbeat_cron) || '*/15 * * * *';
  if (!cron.validate(expr)) {
    process.stderr.write(`CEAuto daemon: invalid heartbeat_cron "${expr}"\n`);
    cleanup();
    process.exit(1);
    return;
  }
  process.stderr.write(`CEAuto daemon up (pid ${pid}); heartbeat "${expr}"\n`);

  const job = cron.schedule(expr, async () => {
    lock.refresh(pid);
    try {
      await heartbeat.runCycle(deps);
    } catch (e) {
      process.stderr.write(`cycle error: ${e.message}\n`);
    }
  });

  const shutdown = () => {
    try {
      job.stop();
    } catch {
      // ignore
    }
    cleanup();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e.message}\n`);
  process.exit(1);
});
