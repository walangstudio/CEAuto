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
const sources = require('../lib/sources');
const httpServer = require('../lib/http-server');

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

/**
 * Start the reactive sources (file-watch + inbound webhook) when enabled. All
 * default-off. Returns an async stop() that tears every started source down.
 */
async function startSources(settings) {
  const cfg = (settings && settings.sources) || {};
  if (!cfg.enabled) return { stop: async () => {} };
  const stoppers = [];

  if (cfg.file_watch && cfg.file_watch.enabled && (cfg.file_watch.paths || []).length) {
    const w = sources.watchFiles({ paths: cfg.file_watch.paths, agent: cfg.file_watch.agent || 'ops' });
    stoppers.push(() => w.stop());
    process.stderr.write(`CEAuto sources: watching ${cfg.file_watch.paths.join(', ')}\n`);
  }

  if (cfg.webhook && cfg.webhook.enabled) {
    const wh = cfg.webhook;
    if (!wh.secret) {
      // Refuse to open an unauthenticated task-injection endpoint, even on
      // localhost. Set sources.webhook.secret to enable the receiver.
      process.stderr.write('CEAuto sources: webhook receiver NOT started — set sources.webhook.secret first\n');
    } else {
      const agents = Object.keys((settings && settings.agents) || {});
      const handle = await httpServer.start({
        host: wh.host || '127.0.0.1',
        port: wh.port || 8787,
        routes: {
          'POST /webhook': sources.webhookHandler({
            secret: wh.secret,
            agent: wh.agent || 'ops',
            map: (cfg.mention && cfg.mention.map) || {},
            ...(agents.length ? { agents } : {}),
          }),
        },
      });
      stoppers.push(() => handle.stop());
      process.stderr.write(`CEAuto sources: webhook receiver on http://${handle.host}:${handle.port}/webhook\n`);
    }
  }

  return {
    stop: async () => {
      for (const s of stoppers) {
        try { await s(); } catch { /* best effort */ }
      }
    },
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
    try {
      const res = await heartbeat.runCycle(deps);
      process.stderr.write(`CEAuto cycle complete: ${JSON.stringify(res.results || [])}\n`);
    } finally {
      cleanup(); // always release the lock, even if the cycle threw
    }
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

  const sourcesHandle = await startSources(settings);

  const job = cron.schedule(expr, async () => {
    try {
      await heartbeat.runCycle(deps);
    } catch (e) {
      process.stderr.write(`cycle error: ${e.message}\n`);
    }
  });

  // Keep the lock fresh on a fixed cadence independent of the heartbeat cron
  // (which may be far longer than the lock TTL). If we lose the lock to another
  // instance, stand down rather than run two daemons concurrently.
  const refreshTimer = setInterval(() => {
    if (!lock.refresh(pid)) {
      process.stderr.write('CEAuto daemon: lost the lock to another instance — shutting down\n');
      shutdown();
    }
  }, 60 * 1000);
  if (refreshTimer.unref) refreshTimer.unref();

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return; // a second signal (or the refresh timer) must not re-enter
    shuttingDown = true;
    try {
      job.stop(); // stop the cron BEFORE awaiting teardown so no new cycle starts
    } catch {
      // ignore
    }
    clearInterval(refreshTimer);
    try {
      await sourcesHandle.stop();
    } catch {
      // best effort
    }
    cleanup();
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e.message}\n`);
  process.exit(1);
});
