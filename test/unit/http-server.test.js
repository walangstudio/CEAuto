const httpServer = require('../../lib/http-server');

describe('http-server router', () => {
  let handle;
  afterEach(async () => {
    if (handle) await handle.stop();
    handle = null;
  });

  it('routes a POST to its handler with the body', async () => {
    handle = await httpServer.start({
      port: 0,
      routes: {
        'POST /echo': (req, res, { body }) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ got: JSON.parse(body) }));
        },
      },
    });
    const r = await fetch(`http://127.0.0.1:${handle.port}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.got.hello).toBe('world');
  });

  it('404s an unknown route', async () => {
    handle = await httpServer.start({ port: 0, routes: {} });
    const r = await fetch(`http://127.0.0.1:${handle.port}/nope`);
    expect(r.status).toBe(404);
  });

  it('rejects a body over the cap with 413', async () => {
    handle = await httpServer.start({
      port: 0,
      maxBody: 16,
      routes: { 'POST /x': (req, res) => { res.writeHead(200); res.end('ok'); } },
    });
    const r = await fetch(`http://127.0.0.1:${handle.port}/x`, {
      method: 'POST',
      body: 'x'.repeat(1000),
    });
    expect(r.status).toBe(413);
  });

  it('binds 127.0.0.1 by default (local-first)', async () => {
    handle = await httpServer.start({ port: 0, routes: {} });
    expect(handle.host).toBe('127.0.0.1');
  });
});
