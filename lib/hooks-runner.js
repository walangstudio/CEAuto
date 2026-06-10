/**
 * hooks-runner.js — fire lifecycle hooks defined in hooks/hooks.json.
 *
 * Hooks are notification/side-effect callbacks only (they must not mutate task
 * state — projection.js owns that). A hook throwing never breaks the caller.
 */

const fs = require('fs');
const path = require('path');

function loadManifest(pkgRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgRoot, 'hooks', 'hooks.json'), 'utf-8'));
  } catch {
    return { hooks: [] };
  }
}

function fnName(name) {
  const parts = String(name).split('-');
  return parts[0] + parts.slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

async function run(name, context = {}, opts = {}) {
  const pkgRoot = opts.pkgRoot || path.resolve(__dirname, '..');
  const manifest = loadManifest(pkgRoot);
  const entry = (manifest.hooks || []).find(h => h.name === name);
  if (!entry) return null;
  try {
    const mod = require(path.join(pkgRoot, 'hooks', entry.script));
    const fn = mod[fnName(name)] || (typeof mod === 'function' ? mod : null);
    if (!fn) return null;
    return await fn(context);
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { run, fnName };
