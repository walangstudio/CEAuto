/**
 * killswitch.js — a single `comms/STOP` file halts ALL dispatch immediately.
 *
 * Checked by every path that can spend: the heartbeat (cycle start + mid-drain),
 * the runner (ceo_run_task / execute:true), and the workflow engine. Distinct from
 * a per-task veto and from a budget pause; works for an unattended/scheduled run
 * where you can't reach the terminal — `touch comms/STOP` to freeze, delete to resume.
 */

const fs = require('fs');
const path = require('path');

function isHalted(workspace) {
  try {
    return fs.existsSync(path.join(workspace || '.', 'comms', 'STOP'));
  } catch {
    return false;
  }
}

module.exports = { isHalted };
