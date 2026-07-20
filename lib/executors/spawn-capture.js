/**
 * spawn-capture.js — hardened child-process runner shared by the process-based
 * executors (shell, claude-code).
 *
 * One settle path (a guard that always clears the timer), an internal timeout
 * that kills the child, an output cap that guards against a runaway child OOMing
 * the daemon, and a bounded stderr ring for diagnostics. Resolves { stdout,
 * stderr } on exit 0; rejects on spawn error, non-zero exit, timeout, or cap.
 */

const { spawn } = require('child_process');
const path = require('path');

const MAX_OUTPUT_DEFAULT = 5 * 1024 * 1024; // 5 MiB

function basename(cmd) {
  return path.basename(String(cmd || ''));
}

function runChild({ command, args = [], input, cwd, env, unsetEnv = [], timeoutMs = 60000, maxOutput = MAX_OUTPUT_DEFAULT, label } = {}) {
  const name = label || basename(command);
  // `unsetEnv` REMOVES inherited vars (the spread can only add). Used to strip
  // provider API keys before spawning a subscription-billed CLI.
  const buildEnv = () => {
    if (!env && !unsetEnv.length) return process.env;
    const merged = { ...process.env, ...(env || {}) };
    for (const key of unsetEnv) delete merged[key];
    return merged;
  };
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      cwd: cwd || undefined,
      env: buildEnv(),
    });
    let out = '';
    let err = '';
    let timer;
    let done = false;
    const finish = fn => { if (done) return; done = true; clearTimeout(timer); fn(); };

    // SIGTERM, then escalate to SIGKILL if the child traps the signal and keeps
    // running — otherwise a hung/ignoring child outlives the daemon.
    const kill = () => {
      try { child.kill(); } catch { /* gone */ }
      const k = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 2000);
      if (k.unref) k.unref();
    };

    child.stdout.on('data', d => {
      out += d.toString();
      if (out.length > maxOutput) {
        kill();
        finish(() => reject(new Error(`${name}: exceeded ${maxOutput} bytes of output`)));
      }
    });
    child.stderr.on('data', d => { err = (err + d.toString()).slice(-4096); });
    child.on('error', e => finish(() => reject(e)));
    timer = setTimeout(() => {
      kill();
      finish(() => reject(new Error(`${name}: timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    child.on('close', (code) => {
      if (code !== 0) {
        finish(() => reject(new Error(`${name}: exited ${code}${err ? `: ${err.slice(-200)}` : ''}`)));
        return;
      }
      finish(() => resolve({ stdout: out, stderr: err }));
    });

    // A child that exits without reading stdin emits an async EPIPE on write;
    // swallow it so it can't become an unhandled 'error' that kills the daemon.
    child.stdin.on('error', () => {});
    try {
      if (input != null) child.stdin.write(input);
      child.stdin.end(); // always signal EOF so a child blocking on stdin can't hang
    } catch {
      // command may not accept stdin
    }
  });
}

module.exports = { runChild, basename, MAX_OUTPUT_DEFAULT };
