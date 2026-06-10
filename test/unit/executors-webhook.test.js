const http = require('http');
const executors = require('../../lib/executors');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ port, host: `127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

describe('webhook (http-webhook) executor', () => {
  it('POSTs the task envelope and parses a structured JSON reply', async () => {
    const srv = await startServer((req, res, body) => {
      const env = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: `worker handled: ${env.task}`, usage: { input_tokens: 5, output_tokens: 7 } }));
    });
    try {
      const res = await executors.execute(
        'webhook',
        { agent: 'ops', task: 'ship it', context: '', params: { url: `http://127.0.0.1:${srv.port}/run` } },
        { webhookAllowlist: [srv.host] }
      );
      expect(res.text).toBe('worker handled: ship it');
      expect(res.usage.provider).toBe('webhook');
      expect(res.usage.input_tokens).toBe(5);
      expect(res.usage.output_tokens).toBe(7);
    } finally {
      await srv.close();
    }
  });

  it('http-webhook alias resolves to the same executor', async () => {
    const srv = await startServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('plain reply');
    });
    try {
      const res = await executors.execute(
        'http-webhook',
        { agent: 'ops', task: 't', context: '', params: { url: `http://127.0.0.1:${srv.port}/` } },
        { webhookAllowlist: [srv.host] }
      );
      expect(res.text).toBe('plain reply');
    } finally {
      await srv.close();
    }
  });

  it('refuses a URL whose host is not allowlisted', async () => {
    await expect(
      executors.execute('webhook', { agent: 'ops', task: 't', params: { url: 'http://evil.example.com/x' } }, { webhookAllowlist: ['worker.internal'] })
    ).rejects.toThrow(/allowlist/);
  });

  it('allows an allowlisted bare host on a non-default port', async () => {
    const srv = await startServer((req, res) => { res.writeHead(200); res.end('ok'); });
    try {
      const res = await executors.execute(
        'webhook',
        { agent: 'ops', task: 't', context: '', params: { url: `http://127.0.0.1:${srv.port}/` } },
        { webhookAllowlist: ['127.0.0.1'] } // bare host → any port
      );
      expect(res.text).toBe('ok');
    } finally {
      await srv.close();
    }
  });

  it('rejects when the allowlist pins a different port', async () => {
    const srv = await startServer((req, res) => { res.writeHead(200); res.end('ok'); });
    try {
      await expect(
        executors.execute(
          'webhook',
          { agent: 'ops', task: 't', params: { url: `http://127.0.0.1:${srv.port}/` } },
          { webhookAllowlist: [`127.0.0.1:${srv.port + 1}`] }
        )
      ).rejects.toThrow(/allowlist/);
    } finally {
      await srv.close();
    }
  });

  it('forwards the shared secret as a header', async () => {
    let seen = null;
    const srv = await startServer((req, res) => {
      seen = req.headers['x-ceauto-secret'];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: 'ok' }));
    });
    try {
      await executors.execute(
        'webhook',
        { agent: 'ops', task: 't', params: { url: `http://127.0.0.1:${srv.port}/`, secret: 's3cr3t' } },
        { webhookAllowlist: [srv.host] }
      );
      expect(seen).toBe('s3cr3t');
    } finally {
      await srv.close();
    }
  });

  it('throws on a non-2xx response', async () => {
    const srv = await startServer((req, res) => {
      res.writeHead(500);
      res.end('boom');
    });
    try {
      await expect(
        executors.execute('webhook', { agent: 'ops', task: 't', params: { url: `http://127.0.0.1:${srv.port}/` } }, { webhookAllowlist: [srv.host] })
      ).rejects.toThrow(/HTTP 500/);
    } finally {
      await srv.close();
    }
  });
});
