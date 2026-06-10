/**
 * sources.js — reactive SOURCES that feed the task queue from outside the cron
 * heartbeat (Pillar 4, the deferred half). A source turns an external signal
 * (a changed file, an inbound webhook, an `@role` mention) into a backlog task
 * the scheduler will pick up, and records it on the event bus.
 *
 * The mapping is pure and unit-testable: signal builders + `ingest`. The I/O
 * shells (chokidar file watcher, HTTP receiver) are thin and inject their
 * dependencies so they can be tested without real watching or sockets.
 *
 * Default-off and opt-in (config/settings.yaml → sources.*): new inbound
 * surface, enabled deliberately.
 */

const crypto = require('crypto');
const tasks = require('./tasks');
const events = require('./events');

const DEFAULT_AGENTS = ['researcher', 'coder', 'analyst', 'writer', 'ops', 'security', 'comms'];

// Constant-time string compare so the webhook secret can't be recovered by
// timing a byte-by-byte short-circuit on `!==`.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a));
  const bb = Buffer.from(String(b == null ? '' : b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ── Signal builders (pure) ────────────────────────────────────────────────────

function fromFileChange({ path: filePath, event }, { agent = 'ops' } = {}) {
  return {
    type: 'file',
    title: `File ${event}: ${filePath}`,
    description: `A watched file was ${event}: ${filePath}. Review and act if needed.`,
    agent,
    priority: 'P3',
    payload: { path: filePath, event },
  };
}

function fromWebhook(body = {}, { agent = 'ops', agents = DEFAULT_AGENTS } = {}) {
  const title = body.title || body.event || 'Inbound webhook';
  // An inbound caller may REQUEST an agent, but only a known one — otherwise the
  // configured default is used. Without this, a webhook body could pin work onto
  // any arbitrary/typo'd agent id (the @mention path already validates).
  const requested = body.agent && agents.includes(body.agent) ? body.agent : agent;
  return {
    type: 'webhook',
    title: String(title).slice(0, 200),
    description: String(body.description || JSON.stringify(body)).slice(0, 2000),
    agent: requested,
    priority: body.priority || 'P2',
    payload: body,
  };
}

function parseMentions(text) {
  const out = [];
  const seen = new Set();
  const re = /@([a-z][a-z0-9_-]*)/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const role = m[1].toLowerCase();
    if (!seen.has(role)) {
      seen.add(role);
      out.push(role);
    }
  }
  return out;
}

function mapMentionToAgent(mention, { map = {}, agents = DEFAULT_AGENTS } = {}) {
  const key = String(mention || '').toLowerCase();
  if (map[key]) return map[key];
  return agents.includes(key) ? key : null;
}

/** First resolvable @mention in the text becomes a task; null if none maps. */
function fromMention(text, { from = 'external', map = {}, agents = DEFAULT_AGENTS } = {}) {
  for (const mention of parseMentions(text)) {
    const agent = mapMentionToAgent(mention, { map, agents });
    if (agent) {
      return {
        type: 'mention',
        title: `@${mention} mentioned by ${from}`,
        description: String(text).slice(0, 2000),
        agent,
        priority: 'P2',
        payload: { mention, from },
      };
    }
  }
  return null;
}

// ── Ingestion ─────────────────────────────────────────────────────────────────

/** Turn a signal into a backlog task + a `source.<type>` event. */
function ingest(signal) {
  if (!signal || !signal.agent) return null;
  const task = tasks.create({
    title: signal.title,
    description: signal.description || signal.title,
    agent: signal.agent,
    status: 'backlog',
    priority: signal.priority || 'P2',
  });
  // Canonical task/agent last so an attacker-controlled payload field named
  // `task` or `agent` can't override the real ids in the event log.
  events.emit(`source.${signal.type}`, { ...(signal.payload || {}), task: task.id, agent: signal.agent }, { actor: `source:${signal.type}` });
  return task;
}

// ── I/O shells ────────────────────────────────────────────────────────────────

/**
 * Watch paths and ingest a task on each matching file event. chokidar is lazily
 * required so it isn't loaded unless file-watching is enabled; tests inject a
 * watcher factory to drive it deterministically. Returns a stop handle.
 */
function watchFiles({ paths = [], agent = 'ops', on = ['add', 'change'], debounceMs = 1000 } = {}, deps = {}) {
  if (!paths.length) return { stop: () => {} };
  const factory = deps.watcherFactory || ((p) => require('chokidar').watch(p, { ignoreInitial: true }));
  const watcher = factory(paths);
  // Collapse a burst of events for the same file (editor saves, bulk copies)
  // into one task so a chatty directory can't flood the queue.
  const last = new Map();
  const now = deps.now || (() => Date.now());
  for (const ev of on) {
    watcher.on(ev, (filePath) => {
      try {
        const key = `${ev}:${filePath}`;
        const t = now();
        if (debounceMs > 0 && t - (last.get(key) || 0) < debounceMs) return;
        last.set(key, t);
        ingest(fromFileChange({ path: filePath, event: ev }, { agent }));
      } catch {
        // a source must never crash the watcher
      }
    });
  }
  return { stop: () => { try { watcher.close(); } catch { /* ignore */ } } };
}

/**
 * Build an HTTP route handler for the inbound webhook receiver. A POST body of
 * { text } is scanned for @mentions first (so "@coder fix the build" routes to
 * coder); otherwise the body is ingested as a generic webhook task. Secret-gated.
 */
function webhookHandler({ secret = '', agent = 'ops', map = {}, agents = DEFAULT_AGENTS } = {}) {
  return (req, res, { body }) => {
    if (secret && !safeEqual(req.headers['x-ceauto-secret'], secret)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return;
    }
    let parsed = {};
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }));
      return;
    }
    const signal = (parsed.text && fromMention(parsed.text, { from: 'webhook', map, agents }))
      || fromWebhook(parsed, { agent, agents });
    const task = ingest(signal);
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, task: task && task.id }));
  };
}

module.exports = {
  DEFAULT_AGENTS,
  fromFileChange,
  fromWebhook,
  parseMentions,
  mapMentionToAgent,
  fromMention,
  ingest,
  watchFiles,
  webhookHandler,
};
