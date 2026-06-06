/**
 * shell executor — run a sandboxed command as an "agent". The task + context are
 * fed on stdin; stdout is the result. Gated by an allowlist (empty = block all)
 * so it cannot run arbitrary commands; sensitive use should also sit behind an
 * approval gate (needs_approval / require_approval_for).
 */

const path = require('path');
const { estimateTokens } = require('../llm-adapter');
const { runChild, basename } = require('./spawn-capture');

function hasPathSeparator(cmd) {
  return /[\\/]/.test(String(cmd || ''));
}

// Compare full paths in a platform-correct way: Windows is separator- and
// case-insensitive, so C:\x\node.exe and c:/x/node.exe are the same file.
function samePath(a, b) {
  let x = path.normalize(String(a));
  let y = path.normalize(String(b));
  if (process.platform === 'win32') {
    x = x.toLowerCase();
    y = y.toLowerCase();
  }
  return x === y;
}

async function shell(ctx, deps = {}) {
  const params = ctx.params || {};
  const command = params.command;
  if (!command) throw new Error('shell executor: no command configured');

  // A command with a path (absolute or relative) must be allowlisted by its
  // FULL path — basename-only matching would let "/tmp/evil/node" satisfy a
  // ["node"] allowlist. Bare names are matched by basename (PATH-resolved).
  const allowlist = deps.shellAllowlist || [];
  const allowed = hasPathSeparator(command)
    ? allowlist.some(a => samePath(a, command))
    : allowlist.map(basename).includes(command);
  if (!allowed) {
    throw new Error(`shell executor: "${command}" is not in the allowlist`);
  }

  const args = params.args || [];
  const input = [ctx.context, ctx.task].filter(Boolean).join('\n\n');
  const timeoutMs = params.timeoutMs || 60000;

  const { stdout } = await runChild({
    command,
    args,
    input: params.passInputStdin === false ? undefined : input,
    timeoutMs,
    label: `shell executor: "${basename(command)}"`,
  });

  return {
    text: stdout,
    usage: {
      input_tokens: estimateTokens(input),
      output_tokens: estimateTokens(stdout),
      model: basename(command),
      provider: 'shell',
    },
  };
}

module.exports = shell;
