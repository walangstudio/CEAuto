const fs = require('fs');
const path = require('path');
const hooksRunner = require('../../lib/hooks-runner');
const { makeTmpWorkspace, cleanup } = require('../helpers/tmp-workspace');

describe('hooks-runner', () => {
  let ws;
  let pkgRoot;

  beforeEach(() => {
    ws = makeTmpWorkspace();
    // A throwaway package root with its own hooks/ manifest + scripts.
    pkgRoot = makeTmpWorkspace({
      'hooks/hooks.json': JSON.stringify({
        hooks: [
          { name: 'on-complete', script: 'on-complete.js' },
          { name: 'on-boom', script: 'on-boom.js' },
        ],
      }),
      'hooks/on-complete.js':
        'const fs=require("fs");const path=require("path");' +
        'module.exports={onComplete:async(c)=>{fs.writeFileSync(path.join(c.workspace,"fired.txt"),c.task.id);return{ok:true};}};',
      'hooks/on-boom.js':
        'module.exports={onBoom:async()=>{throw new Error("kaboom");}};',
    });
  });

  afterEach(() => {
    cleanup(ws);
    cleanup(pkgRoot);
  });

  it('maps hook name to camelCase export', () => {
    expect(hooksRunner.fnName('on-complete')).toBe('onComplete');
    expect(hooksRunner.fnName('on-boot')).toBe('onBoot');
  });

  it('invokes the mapped hook function', async () => {
    const res = await hooksRunner.run('on-complete', { workspace: ws, task: { id: 'T-1' } }, { pkgRoot });
    expect(res).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(ws, 'fired.txt'), 'utf-8')).toBe('T-1');
  });

  it('swallows a throwing hook (never breaks the caller)', async () => {
    const res = await hooksRunner.run('on-boom', { workspace: ws }, { pkgRoot });
    expect(res.error).toMatch(/kaboom/);
  });

  it('returns null for an unknown hook', async () => {
    expect(await hooksRunner.run('on-nope', { workspace: ws }, { pkgRoot })).toBeNull();
  });
});
