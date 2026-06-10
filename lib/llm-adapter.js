/**
 * llm-adapter.js — Provider abstraction for sub-agent dispatch.
 * Supports: Anthropic (Claude), OpenAI (GPT), Google (Gemini), Ollama (local).
 *
 * dispatch() returns { text, usage } where usage carries token counts so the
 * budget ledger can account for every call. Providers that omit usage fall back
 * to a character-based estimate.
 */

const fs = require('fs');
const path = require('path');

let config = null;

function loadConfig() {
  if (config) return config;
  try {
    const yaml = require('js-yaml');
    const raw = fs.readFileSync(path.join(__dirname, '../config/providers.yaml'), 'utf-8');
    config = yaml.load(raw);
  } catch {
    config = { default_provider: 'anthropic', providers: {} };
  }
  return config;
}

function getApiKey(provider) {
  const cfg = loadConfig();
  return (
    process.env[`${provider.toUpperCase()}_API_KEY`] ||
    cfg.providers?.[provider]?.api_key ||
    null
  );
}

function getModel(provider, agentId) {
  const cfg = loadConfig();
  return (
    cfg.model_per_agent?.[agentId] ||
    cfg.providers?.[provider]?.default_model ||
    defaultModels[provider] ||
    null
  );
}

const defaultModels = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  google: 'gemini-1.5-pro',
  ollama: 'llama3',
};

function estimateTokens(s) {
  return Math.max(1, Math.ceil(String(s || '').length / 4));
}

function buildPrompt(task, context) {
  return context ? `${context}\n\n---\n\nTask: ${task}` : task;
}

async function dispatchAnthropic(model, systemPrompt, task, context) {
  const apiKey = getApiKey('anthropic');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: buildPrompt(task, context) }],
  });

  const text = response.content.map(b => b.text || '').join('');
  return {
    text,
    usage: {
      input_tokens: response.usage?.input_tokens ?? estimateTokens(`${systemPrompt}${context}${task}`),
      output_tokens: response.usage?.output_tokens ?? estimateTokens(text),
    },
  };
}

async function dispatchOpenAI(model, systemPrompt, task, context) {
  const apiKey = getApiKey('openai');
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const { OpenAI } = require('openai');
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildPrompt(task, context) },
    ],
  });

  const text = response.choices[0].message.content;
  return {
    text,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? estimateTokens(`${systemPrompt}${context}${task}`),
      output_tokens: response.usage?.completion_tokens ?? estimateTokens(text),
    },
  };
}

async function dispatchGoogle(model, systemPrompt, task, context) {
  const apiKey = getApiKey('google');
  if (!apiKey) throw new Error('GOOGLE_API_KEY not set');

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({ model, systemInstruction: systemPrompt });

  const result = await genModel.generateContent(buildPrompt(task, context));
  const text = result.response.text();
  const meta = result.response.usageMetadata || {};
  return {
    text,
    usage: {
      input_tokens: meta.promptTokenCount ?? estimateTokens(`${systemPrompt}${context}${task}`),
      output_tokens: meta.candidatesTokenCount ?? estimateTokens(text),
    },
  };
}

async function dispatchOllama(model, systemPrompt, task, context) {
  const cfg = loadConfig();
  const baseUrl = cfg.providers?.ollama?.base_url || 'http://localhost:11434';

  const body = JSON.stringify({
    model,
    system: systemPrompt,
    prompt: buildPrompt(task, context),
    stream: false,
  });

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.statusText}`);
  const data = await res.json();
  return {
    text: data.response,
    usage: {
      input_tokens: data.prompt_eval_count ?? estimateTokens(`${systemPrompt}${context}${task}`),
      output_tokens: data.eval_count ?? estimateTokens(data.response),
    },
  };
}

/**
 * Dispatch a task to a sub-agent's LLM.
 * @param {{model?:string, provider?:string}} [route] - optional override from the
 *   learned dispatch policy (Pillar 6). When set it wins over the configured
 *   provider/model so the runner can route to the cheapest-that-works pair.
 * @returns {Promise<{text:string, usage:{input_tokens:number, output_tokens:number, model:string, provider:string}}>}
 */
async function dispatch(agentId, agentSpec, task, context = '', route = {}) {
  // Apply a route only when BOTH halves are present: a half-set route (e.g. a
  // model from a legacy ledger row with no provider) must not pair an override
  // model with a config-resolved provider — that sends, say, an Anthropic model
  // to the OpenAI endpoint. Partial → treat as absent and fall back to config.
  const routeComplete = !!(route && route.model && route.provider);
  const overrideModel = routeComplete ? route.model : null;
  const overrideProvider = routeComplete ? route.provider : null;
  // Offline seam: lets the daemon / integration tests run a full cycle with no
  // provider key and zero spend. Never triggers unless explicitly enabled.
  if (process.env.CEAUTO_MOCK_LLM) {
    const text = `[${agentId}] ${String(task).slice(0, 200)}`;
    return {
      text,
      usage: {
        input_tokens: estimateTokens(`${agentSpec}${context}${task}`),
        output_tokens: estimateTokens(text),
        model: overrideModel || 'mock-model',
        provider: overrideProvider || 'mock',
      },
    };
  }

  const cfg = loadConfig();
  const provider = overrideProvider || cfg.agent_providers?.[agentId] || cfg.default_provider || 'anthropic';
  const model = overrideModel || getModel(provider, agentId);

  let result;
  switch (provider) {
    case 'anthropic': result = await dispatchAnthropic(model, agentSpec, task, context); break;
    case 'openai': result = await dispatchOpenAI(model, agentSpec, task, context); break;
    case 'google': result = await dispatchGoogle(model, agentSpec, task, context); break;
    case 'ollama': result = await dispatchOllama(model, agentSpec, task, context); break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  return {
    text: result.text,
    usage: { ...result.usage, model, provider },
  };
}

module.exports = { dispatch, estimateTokens };
