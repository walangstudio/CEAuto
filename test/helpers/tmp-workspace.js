const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Create an isolated throwaway workspace directory.
 * @param {Object} seed - map of relative path -> file content to pre-create
 * @returns {string} absolute workspace path
 */
function makeTmpWorkspace(seed = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceauto-test-'));
  for (const [rel, content] of Object.entries(seed)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

function cleanup(dir) {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort — Windows may hold a sqlite handle briefly
  }
}

module.exports = { makeTmpWorkspace, cleanup };
