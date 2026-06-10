/**
 * webhook executor (http-webhook) — run a task by POSTing the task envelope to an
 * external worker (n8n / Zapier / a custom service) and awaiting a structured
 * reply. Makes any HTTP endpoint an agent runtime.
 *
 * New outbound attack surface, so it is gated like shell: the target URL's host
 * must be on an allowlist (empty = block all). An optional shared secret is sent
 * as a header so the receiver can authenticate the call.
 *
 * params: { url, method?='POST', headers?, secret?, timeoutMs? }
 * The receiver should reply with JSON { text, usage?:{input_tokens,output_tokens} };
 * a plain-text body is accepted too.
 */

const { estimateTokens } = require('../llm-adapter');

const MAX_RESPONSE = 5 * 1024 * 1024; // 5 MiB cap on the reply body

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function parseTarget(url) {
  try {
    const u = new URL(url);
    return { hostname: u.hostname.toLowerCase(), port: u.port };
  } catch {
    return null;
  }
}

function parseAllowEntry(entry) {
  const s = String(entry).toLowerCase();
  try {
    const u = new URL(s.includes('://') ? s : `http://${s}`);
    return { hostname: u.hostname, port: u.port };
  } catch {
    return null;
  }
}

function isAllowed(url, allowlist) {
  const t = parseTarget(url);
  if (!t) return false;
  // An entry is a bare host, host:port, or full origin. A bare host allows any
  // port on that host; an entry WITH a port pins that exact port. (Comparing the
  // raw host:port would wrongly reject an allowlisted host on a non-default port.)
  return allowlist.some(a => {
    const e = parseAllowEntry(a);
    if (!e || e.hostname !== t.hostname) return false;
    return e.port ? e.port === t.port : true;
  });
}

async function webhook(ctx, deps = {}) {
  const params = ctx.params || {};
  const url = params.url;
  if (!url) throw new Error('webhook executor: params.url is required');

  const allowlist = deps.webhookAllowlist || [];
  if (!isAllowed(url, allowlist)) {
    throw new Error(`webhook executor: host of "${url}" is not in the allowlist`);
  }

  const timeoutMs = params.timeoutMs || 60000;
  const envelope = { agent: ctx.agent, task: ctx.task, context: ctx.context };
  const headers = { 'content-type': 'application/json', ...(params.headers || {}) };
  if (params.secret) headers['x-ceauto-secret'] = params.secret;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: params.method || 'POST',
      headers,
      body: JSON.stringify(envelope),
      signal: controller.signal,
      // Don't follow redirects: an allowlisted endpoint could 3xx the request to
      // an internal/metadata host (SSRF), and only the FIRST url's host is checked.
      redirect: 'error',
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`webhook executor: "${url}" timed out after ${timeoutMs}ms`);
    throw new Error(`webhook executor: request to "${url}" failed: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`webhook executor: "${url}" returned HTTP ${res.status}`);

  const raw = await readCapped(res);
  let text = raw;
  let usage = null;
  try {
    const parsed = JSON.parse(raw);
    text = parsed.text ?? parsed.result ?? raw;
    if (parsed.usage) {
      usage = {
        input_tokens: parsed.usage.input_tokens || 0,
        output_tokens: parsed.usage.output_tokens || 0,
      };
    }
  } catch {
    // plain-text reply
  }

  return {
    text,
    usage: {
      input_tokens: usage?.input_tokens ?? estimateTokens(`${ctx.task || ''}${ctx.context || ''}`),
      output_tokens: usage?.output_tokens ?? estimateTokens(text),
      model: hostnameOf(url),
      provider: 'webhook',
    },
  };
}

async function readCapped(res) {
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) {
    const t = await res.text();
    return t.slice(0, MAX_RESPONSE);
  }
  let size = 0;
  const decoder = new TextDecoder();
  let result = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_RESPONSE) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new Error('webhook executor: response exceeded size cap');
    }
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

module.exports = webhook;
