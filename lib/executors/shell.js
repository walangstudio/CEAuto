/**
 * shell executor — run a sandboxed command as an "agent". The task + context are
 * fed on stdin; stdout is the result. Gated by an allowlist (empty = block all)
 * so it cannot run arbitrary commands; sensitive use should also sit behind an
 * approval gate (needs_approval / require_approval_for).
 */

const { spawn } = require('child_process');
const path = require('path');
const { estimateTokens } = require('../llm-adapter');

function basename(cmd) {
  return path.basename(String(cmd || ''));
}

async function shell(ctx, deps = {}) {
  const params = ctx.params || {};
  const command = params.command;
  if (!command) throw new Error('shell executor: no command configured');

  const allowlist = (deps.shellAllowlist || []).map(basename);
  if (!allowlist.includes(basename(command))) {
    throw new Error(`shell executor: "${basename(command)}" is not in the allowlist`);
  }

  const args = params.args || [];
  const input = [ctx.context, ctx.task].filter(Boolean).join('\n\n');
  const timeoutMs = params.timeoutMs || 60000;

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', reject);
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* gone */ }
      reject(new Error(`shell executor: timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`shell executor: "${basename(command)}" exited ${code}: ${err.slice(0, 200)}`));
        return;
      }
      resolve({
        text: out,
        usage: {
          input_tokens: estimateTokens(input),
          output_tokens: estimateTokens(out),
          model: basename(command),
          provider: 'shell',
        },
      });
    });
    if (params.passInputStdin !== false) {
      try {
        child.stdin.write(input);
        child.stdin.end();
      } catch {
        // command may not read stdin
      }
    }
  });
}

module.exports = shell;
