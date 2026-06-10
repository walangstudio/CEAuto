const fs = require('fs');
const os = require('os');
const path = require('path');
const org = require('../../lib/org');
const policy = require('../../lib/policy');

/**
 * Create an isolated throwaway workspace directory.
 *
 * Also resets the org singleton to an EMPTY org so tests are hermetic: the
 * runner's role-budget gate becomes a no-op unless a test opts in via
 * org.configure(). Without this, every runner/heartbeat test would silently
 * load the production config/org.yaml and its department caps, coupling
 * unrelated tests to that file.
 * @param {Object} seed - map of relative path -> file content to pre-create
 * @returns {string} absolute workspace path
 */
function makeTmpWorkspace(seed = {}) {
  org.configure({});
  policy.configure([]); // hermetic: no policy-as-code rules unless a test opts in
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceauto-test-'));
  for (const [rel, content] of Object.entries(seed)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

function cleanup(dir) {
  org.resetConfig();
  policy.resetConfig();
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort — Windows may hold a sqlite handle briefly
  }
}

module.exports = { makeTmpWorkspace, cleanup };
