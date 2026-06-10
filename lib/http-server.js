/**
 * http-server.js — a tiny local HTTP server with a route table. Local-first:
 * binds 127.0.0.1 by default so it isn't exposed off-box. Hosts the inbound
 * webhook source now (Pillar G1) and the read-only dashboard later (G2) on the
 * same server.
 *
 * Routes are keyed "METHOD /path" → (req, res, { body, query }) => void.
 */

const http = require('http');

const MAX_BODY_DEFAULT = 1 * 1024 * 1024; // 1 MiB request-body cap

function readBody(req, maxBody) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > maxBody) {
        over = true;
        // Drain (don't destroy) the rest of the upload so the socket closes
        // cleanly and the client still receives our 413 response.
        req.resume();
        reject(new Error('request body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks).toString('utf-8')); });
    req.on('error', reject);
  });
}

function start({ host = '127.0.0.1', port = 0, routes = {}, maxBody = MAX_BODY_DEFAULT } = {}) {
  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      res.writeHead(400);
      res.end('bad request');
      return;
    }
    const key = `${req.method} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    let body = '';
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        body = await readBody(req, maxBody);
      } catch (e) {
        res.writeHead(413, { 'content-type': 'application/json', connection: 'close' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
        return;
      }
    }
    try {
      await handler(req, res, { body, query: url.searchParams });
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    }
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        server,
        host,
        port: addr.port,
        stop: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { start, MAX_BODY_DEFAULT };
