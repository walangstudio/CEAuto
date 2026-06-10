/**
 * dashboard.js — a read-only local status view (Pillar 7, G2).
 *
 * Pure projection over the same SQLite state the markdown is rendered from: no
 * new state, no writes, no SaaS. `buildState()` is the single data source;
 * `routes()` exposes it as JSON (`GET /api/state`) and a minimal self-refreshing
 * HTML page (`GET /`) for the local HTTP server (lib/http-server.js, 127.0.0.1).
 */

const tasks = require('./tasks');
const org = require('./org');
const approvals = require('./approvals');
const metrics = require('./metrics');
const events = require('./events');
const budget = require('./budget');

function slimTask(t) {
  return {
    id: t.id,
    title: t.title,
    agent: t.agent,
    status: t.status,
    priority: t.priority,
    claimed_by: t.claimed_by || null,
    blocker: t.blocker || null,
    parent_id: t.parent_id || null,
  };
}

function slimApproval(a) {
  return {
    id: a.id,
    kind: a.kind,
    ref_id: a.ref_id,
    summary: a.summary,
    status: a.status,
    quorum: a.quorum || 1,
    approvers: approvals.approverCount(a),
  };
}

/** The full read-only snapshot rendered by the dashboard. */
function buildState() {
  const recent = events.list({ sinceId: Math.max(0, events.lastId() - 100) }).slice(-25).reverse();
  return {
    generated_at: new Date().toISOString(),
    metrics: metrics.snapshot(),
    tasks: tasks.all().map(slimTask),
    org: org.tree({ spentByAgents: budget.spentByAgents }),
    approvals: approvals.list().map(slimApproval),
    // Only known, safe fields — NOT the raw event payload, which for source.*
    // events is attacker-controlled inbound data.
    events: recent.map(e => ({ id: e.id, type: e.type, actor: e.actor, created_at: e.created_at })),
  };
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function routes() {
  return {
    'GET /api/state': (req, res) => {
      try {
        json(res, 200, buildState());
      } catch (e) {
        json(res, 500, { ok: false, error: e.message });
      }
    },
    'GET /': (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(htmlPage());
    },
  };
}

function htmlPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>CEAuto Dashboard</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem; color: #1a1a1a; background: #fafafa; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.05rem; margin-top: 1.5rem; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; background: #fff; }
  th, td { border: 1px solid #e2e2e2; padding: .35rem .6rem; text-align: left; font-size: 13px; }
  th { background: #f0f0f0; }
  .pill { display: inline-block; padding: 0 .5rem; border-radius: 1rem; font-size: 12px; }
  .backlog { background:#eef; } .in-progress { background:#ffe9c7; } .blocked { background:#fdd; } .done { background:#dfd; }
  .muted { color:#888; } .cards { display:flex; gap:1rem; flex-wrap:wrap; }
  .card { background:#fff; border:1px solid #e2e2e2; border-radius:.5rem; padding:.75rem 1rem; min-width:8rem; }
  .card b { font-size:1.3rem; display:block; }
</style>
</head>
<body>
<h1>CEAuto Dashboard <span class="muted" id="ts"></span></h1>
<div class="cards" id="cards"></div>
<h2>Tasks</h2><div id="tasks"></div>
<h2>Approvals</h2><div id="approvals"></div>
<h2>Org &amp; spend</h2><div id="org"></div>
<h2>Recent events</h2><div id="events"></div>
<script>
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function table(cols, rows, cell) {
  if (!rows.length) return '<p class="muted">none</p>';
  const head = '<tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr>';
  const body = rows.map(r => '<tr>' + cell(r).map(c => '<td>' + c + '</td>').join('') + '</tr>').join('');
  return '<table>' + head + body + '</table>';
}
async function load() {
  const s = await (await fetch('api/state')).json();
  document.getElementById('ts').textContent = 'updated ' + new Date(s.generated_at).toLocaleTimeString();
  const m = s.metrics;
  document.getElementById('cards').innerHTML = [
    ['Backlog', m.tasks.backlog], ['In progress', m.tasks['in-progress']], ['Blocked', m.tasks.blocked],
    ['Done', m.tasks.done], ['Spend today', '$' + m.spend_today.usd], ['Approvals pending', m.approvals_pending],
    ['Eval avg', m.eval_avg == null ? 'n/a' : m.eval_avg + '/5'], ['Autonomy', m.paused ? '⏸ paused' : '▶ active'],
  ].map(([k, v]) => '<div class="card"><b>' + esc(v) + '</b>' + esc(k) + '</div>').join('');
  document.getElementById('tasks').innerHTML = table(['ID','Title','Agent','Status','Pri'], s.tasks,
    t => [esc(t.id), esc(t.title), esc(t.agent), '<span class="pill ' + esc(t.status) + '">' + esc(t.status) + '</span>', esc(t.priority)]);
  document.getElementById('approvals').innerHTML = table(['ID','Kind','Ref','Summary','Status','Votes'], s.approvals,
    a => [esc(a.id), esc(a.kind), esc(a.ref_id), esc(a.summary), esc(a.status), a.quorum > 1 ? esc(a.approvers + '/' + a.quorum) : '—']);
  document.getElementById('org').innerHTML = table(['Role','Reports to','Members','Spent today'], s.org,
    o => [esc(o.role), esc(o.reports_to), esc((o.members || []).join(', ')), o.spent ? '$' + esc(o.spent.usd.toFixed(2)) : '—']);
  document.getElementById('events').innerHTML = table(['#','Type','Actor','When'], s.events,
    e => [esc(e.id), esc(e.type), esc(e.actor), esc(e.created_at)]);
}
load(); setInterval(load, 5000);
</script>
</body>
</html>`;
}

module.exports = { buildState, routes, htmlPage };
