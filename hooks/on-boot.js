/**
 * on-boot.js — notification hook fired when the CEO agent boots.
 * Side-effect only (appends to reports/hooks-log.md); state is owned elsewhere.
 */

const { note } = require('../lib/hook-log');

async function onBoot(context = {}) {
  note(context.workspace, 'boot', `files_loaded=${context.filesLoaded ?? '?'}`);
  return { success: true };
}

module.exports = { onBoot };
