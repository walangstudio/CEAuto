/**
 * llm-adapter.js — Provider abstraction for sub-agent dispatch
 * Supports: Anthropic (Claude), OpenAI (GPT), Google (Gemini), Ollama (local)
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

async function dispatchAnthropic(model, systemPrompt, task, context) {
  const apiKey = getApiKey('anthropic');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: context ? `${context}\n\n---\n\nTask: ${task}` : task }],
  });

  return response.content[0].text;
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
      { role: 'user', content: context ? `${context}\n\n---\n\nTask: ${task}` : task },
    ],
  });

  return response.choices[0].message.content;
}

async function dispatchGoogle(model, systemPrompt, task, context) {
  const apiKey = getApiKey('google');
  if (!apiKey) throw new Error('GOOGLE_API_KEY not set');

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({ model, systemInstruction: systemPrompt });

  const result = await genModel.generateContent(context ? `${context}\n\n---\n\nTask: ${task}` : task);
  return result.response.text();
}

async function dispatchOllama(model, systemPrompt, task, context) {
  const cfg = loadConfig();
  const baseUrl = cfg.providers?.ollama?.base_url || 'http://localhost:11434';

  const body = JSON.stringify({
    model,
    system: systemPrompt,
    prompt: context ? `${context}\n\n---\n\nTask: ${task}` : task,
    stream: false,
  });

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.statusText}`);
  const data = await res.json();
  return data.response;
}

/**
 * Dispatch a task to a sub-agent's LLM
 * @param {string} agentId - agent identifier
 * @param {string} agentSpec - agent system prompt / spec content
 * @param {string} task - task description
 * @param {string} context - additional context
 * @returns {Promise<string>} agent output
 */
async function dispatch(agentId, agentSpec, task, context = '') {
  const cfg = loadConfig();
  const provider = cfg.agent_providers?.[agentId] || cfg.default_provider || 'anthropic';
  const model = getModel(provider, agentId);

  switch (provider) {
    case 'anthropic': return await dispatchAnthropic(model, agentSpec, task, context);
    case 'openai':    return await dispatchOpenAI(model, agentSpec, task, context);
    case 'google':    return await dispatchGoogle(model, agentSpec, task, context);
    case 'ollama':    return await dispatchOllama(model, agentSpec, task, context);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

module.exports = { dispatch };
