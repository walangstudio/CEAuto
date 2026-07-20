/**
 * codex executor — run a task by spawning the OpenAI Codex CLI non-interactively
 * (`codex exec`, prompt on stdin). The sibling of the claude-code executor.
 *
 * Why both: `claude -p` and `codex exec` bill the operator's SUBSCRIPTION (Claude
 * plan / ChatGPT plan) rather than per-token API credits, so an autonomous loop can
 * run real coding work without an API key at all. Pick whichever plan you have.
 *
 * High blast radius (Codex can run commands and edit files), so it is DEFAULT-OFF:
 * it only runs when config enables it (deps.codex.enabled), and like every executor
 * it still sits behind the runner's budget / approval / veto / STOP gates.
 *
 * `codex exec` reads the prompt from stdin when no PROMPT argument is given, which
 * is exactly how claude-code feeds it — same shape, same hardened child runner.
 *
 * params: { command?='codex', args?=['exec', ...], cwd?, timeoutMs?, outputFormat? }
 *   Sandboxing is Codex's own concern: pass `--sandbox workspace-write` (or
 *   read-only / danger-full-access) through `args` to choose the policy. We do NOT
 *   inject a bypass flag — opt into wider access deliberately.
 *   outputFormat:'json' parses a { result|text, usage } object from stdout. Kept for
 *   parity with claude-code; note no current `codex exec` flag emits that shape
 *   (`--json` is JSONL events), so today it harmlessly falls back to raw text.
 */

const { runChild, basename } = require('./spawn-capture');
const { estimateTokens } = require('../llm-adapter');

// --skip-git-repo-check: the workspace may not be a git repo.
// --color never: keep captured stdout clean of ANSI escapes.
const DEFAULT_ARGS = ['exec', '--skip-git-repo-check', '--color', 'never'];

// Provider API keys are stripped from the child's environment by default. The
// daemon usually has ANTHROPIC_API_KEY / OPENAI_API_KEY set for the `llm` executor,
// and an inherited key can silently flip the CLI from SUBSCRIPTION billing to
// per-token API billing — spend the $0 ledger price would then hide from the USD
// cap. Scrubbing them makes "subscription-billed" true by construction.
// Set `passApiKeys: true` only if you deliberately want an API-backed CLI (and then
// give it real per-1K prices in providers.yaml).
const PROVIDER_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

async function codex(ctx, deps = {}) {
  const cfg = deps.codex || {};
  if (!cfg.enabled) {
    throw new Error('codex executor is disabled — set executors.codex.enabled in config/settings.yaml');
  }

  const params = ctx.params || {};
  const command = params.command || cfg.command || 'codex';
  const args = params.args || cfg.args || DEFAULT_ARGS;
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
    label: `codex executor: "${basename(command)}"`,
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
      provider: 'codex',
    },
  };
}

module.exports = codex;
