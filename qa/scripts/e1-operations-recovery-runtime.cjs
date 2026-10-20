const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const JSZip = require('../../functions/node_modules/jszip');
(async () => {
  for (const short of ['queue', 'reconcile']) {
    const dir = path.resolve(`.firebase/modular-release/recovery-${short}-5b0db917bd70`);
    const input = JSON.parse(fs.readFileSync(path.join(dir, 'input.json')));
    const runtime = path.join(dir, 'behavior-runtime');
    fs.mkdirSync(runtime, { recursive: true });
    const zip = await JSZip.loadAsync(fs.readFileSync(input.archive));
    for (const entry of Object.values(zip.files)) {
      assert(!entry.name.includes('..') && !entry.name.includes('\\') && !entry.name.startsWith('/') && !entry.name.includes(':'));
      const dest = path.join(runtime, entry.name);
      if (entry.dir) fs.mkdirSync(dest, { recursive: true });
      else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, await entry.async('nodebuffer')); }
    }
    const result = spawnSync('npm', ['ci', '--omit=dev', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: runtime, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true });
    fs.writeFileSync(path.join(dir, 'behavior-install.log'), (result.stdout || '') + (result.stderr || ''));
    assert.equal(result.status, 0, 'Exact archive runtime dependencies failed');
    console.log(JSON.stringify({ group: input.group, runtimePrepared: true }));
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
