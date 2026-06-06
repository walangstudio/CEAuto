const path = require('path');
const { EventEmitter } = require('events');
const memory = require('../../lib/memory');
const events = require('../../lib/events');
const tasks = require('../../lib/tasks');
const sources = require('../../lib/sources');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('reactive sources', () => {
  let ws;
  beforeEach(() => {
    ws = makeTmpWorkspace();
    memory.init(path.join(ws, 'db', 'memory.sqlite'));
  });
  afterEach(() => {
    memory.close();
    cleanup(ws);
  });

  it('parses @mentions and maps them to agents', () => {
    expect(sources.parseMentions('hey @coder and @Analyst, also @coder again')).toEqual(['coder', 'analyst']);
    expect(sources.mapMentionToAgent('coder')).toBe('coder');
    expect(sources.mapMentionToAgent('nobody')).toBe(null);
    expect(sources.mapMentionToAgent('eng', { map: { eng: 'coder' } })).toBe('coder');
  });

  it('builds a mention signal from the first resolvable @mention', () => {
    const sig = sources.fromMention('please @coder fix the build', { from: 'slack' });
    expect(sig.type).toBe('mention');
    expect(sig.agent).toBe('coder');
    const none = sources.fromMention('no mentions here');
    expect(none).toBe(null);
  });

  it('ingest creates a backlog task and emits a source event', () => {
    const sig = sources.fromWebhook({ title: 'deploy done', description: 'prod deploy finished' }, { agent: 'ops' });
    const task = sources.ingest(sig);
    expect(task.status).toBe('backlog');
    expect(task.agent).toBe('ops');
    expect(tasks.get(task.id).title).toBe('deploy done');
    const evs = events.list().filter(e => e.type === 'source.webhook');
    expect(evs.length).toBe(1);
    expect(evs[0].payload.task).toBe(task.id);
  });

  it('fromWebhook only honors a requested agent that is on the roster', () => {
    expect(sources.fromWebhook({ title: 'x', agent: 'security' }).agent).toBe('security');
    expect(sources.fromWebhook({ title: 'x', agent: 'rogue-agent' }, { agent: 'ops' }).agent).toBe('ops');
  });

  it('canonical task/agent survive a payload that tries to override them', () => {
    const sig = sources.fromWebhook({ title: 'x', task: 'T-FAKE', agent: 'ops' }, { agent: 'ops' });
    const task = sources.ingest(sig);
    const ev = events.list().filter(e => e.type === 'source.webhook').pop();
    expect(ev.payload.task).toBe(task.id);
    expect(ev.payload.task).not.toBe('T-FAKE');
    expect(ev.payload.agent).toBe('ops');
  });

  it('debounces a burst of events for the same file into one task', () => {
    const fakeWatcher = new (require('events').EventEmitter)();
    fakeWatcher.close = () => {};
    let t = 1000;
    const handle = sources.watchFiles(
      { paths: ['/d'], agent: 'ops', debounceMs: 1000 },
      { watcherFactory: () => fakeWatcher, now: () => t }
    );
    fakeWatcher.emit('change', '/d/a.txt'); // ingested
    fakeWatcher.emit('change', '/d/a.txt'); // within window → dropped
    expect(tasks.all().length).toBe(1);
    t = 2500; // past the window
    fakeWatcher.emit('change', '/d/a.txt');
    expect(tasks.all().length).toBe(2);
    handle.stop();
  });

  it('ingest is a no-op for an unroutable signal', () => {
    expect(sources.ingest(null)).toBe(null);
    expect(sources.ingest({ type: 'mention', title: 'x' })).toBe(null); // no agent
  });

  it('watchFiles ingests a task on a file event (injected watcher)', () => {
    const fakeWatcher = new EventEmitter();
    fakeWatcher.close = () => {};
    const handle = sources.watchFiles(
      { paths: ['/data'], agent: 'analyst' },
      { watcherFactory: () => fakeWatcher }
    );
    fakeWatcher.emit('add', '/data/report.csv');
    const created = tasks.all();
    expect(created.length).toBe(1);
    expect(created[0].agent).toBe('analyst');
    expect(created[0].title).toMatch(/File add: \/data\/report\.csv/);
    handle.stop();
  });

  it('webhookHandler routes a mention body to the right agent and enforces the secret', () => {
    const handler = sources.webhookHandler({ secret: 'k', agent: 'ops' });

    const denied = fakeRes();
    handler({ headers: {} }, denied, { body: JSON.stringify({ text: '@coder go' }) });
    expect(denied.statusCode).toBe(401);
    expect(tasks.all().length).toBe(0);

    const ok = fakeRes();
    handler({ headers: { 'x-ceauto-secret': 'k' } }, ok, { body: JSON.stringify({ text: '@coder fix it' }) });
    expect(ok.statusCode).toBe(202);
    const all = tasks.all();
    expect(all.length).toBe(1);
    expect(all[0].agent).toBe('coder');
  });
});

function fakeRes() {
  return {
    statusCode: null,
    body: '',
    writeHead(code) { this.statusCode = code; },
    end(s) { this.body = s || ''; },
  };
}
