/**
 * claude-code executor — run a coding task by spawning a headless Claude Code
 * subagent (`claude -p`, prompt on stdin). Lets CEAuto hand a real implementation
 * task to an agent that can read/edit files and run tools in a working dir.
 *
 * High blast radius (it can change files), so it is DEFAULT-OFF: it only runs
 * when config enables it (deps.claudeCode.enabled), and like every executor it
 * still sits behind the runner's budget / approval / veto gates.
 *
 * params: { command?='claude', args?=['-p'], cwd?, timeoutMs?, outputFormat? }
 *   outputFormat:'json' parses { result, usage } from Claude Code's JSON output.
 */

const { runChild, basename } = require('./spawn-capture');
const { estimateTokens } = require('../llm-adapter');

// Stripped from the child env so `claude -p` bills the SUBSCRIPTION, not the API.
// The daemon usually has these set for the `llm` executor; an inherited key would
// silently flip billing to per-token API spend that the $0 ledger price hides from
// the USD cap. `passApiKeys: true` opts back in (then set real prices).
const PROVIDER_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

async function claudeCode(ctx, deps = {}) {
  const cfg = deps.claudeCode || {};
  if (!cfg.enabled) {
    throw new Error('claude-code executor is disabled — set executors.claude_code.enabled in config/settings.yaml');
  }

  const params = ctx.params || {};
  const command = params.command || cfg.command || 'claude';
  const args = params.args || cfg.args || ['-p'];
  const cwd = params.cwd || cfg.cwd;
  const timeoutMs = params.timeoutMs || cfg.timeoutMs || 180000;
  const outputFormat = params.outputFormat || cfg.outputFormat || null;

  const prompt = [ctx.agentSpec, ctx.context, ctx.task].filter(Boolean).join('\n\n');

  const passApiKeys = params.passApiKeys ?? cfg.passApiKeys ?? false;

  const { stdout } = await runChild({
    command,
    args,
    input: prompt,
    cwd,
    timeoutMs,
    unsetEnv: passApiKeys ? [] : PROVIDER_KEYS,
    label: `claude-code executor: "${basename(command)}"`,
  });

  let text = stdout;
  let usage = null;
  if (outputFormat === 'json') {
    try {
      const parsed = JSON.parse(stdout);
      text = parsed.result ?? parsed.text ?? stdout;
      if (parsed.usage) {
        usage = {
          input_tokens: parsed.usage.input_tokens || 0,
          output_tokens: parsed.usage.output_tokens || 0,
        };
      }
    } catch {
      // not JSON after all — fall back to the raw text + estimate
    }
  }

  return {
    text,
    usage: {
      input_tokens: usage?.input_tokens ?? estimateTokens(prompt),
      output_tokens: usage?.output_tokens ?? estimateTokens(text),
      model: basename(command),
      provider: 'claude-code',
    },
  };
}

module.exports = claudeCode;
