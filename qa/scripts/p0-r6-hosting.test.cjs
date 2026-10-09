const assert = require('node:assert/strict');
const { test } = require('node:test');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');
test('candidate Next server serves all four restored routes and preserves security headers and public manifest', { timeout: 60000 }, async () => {
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { stdio: 'ignore', windowsHide: true });
  const origin = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { ready = (await fetch(origin + '/manifest.webmanifest')).ok; if (ready) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
    assert(ready, 'local Next server started');
    for (const route of ['/cuenta', '/administracion/recursos-corporativos', '/hugo/evaluation', '/manifest.webmanifest']) {
      const response = await fetch(origin + route); assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('permissions-policy'), 'camera=(), geolocation=(), microphone=(self), payment=(), usb=()');
      if (route.endsWith('.webmanifest')) { const body = await response.json();assert.equal(body.name, 'PAY0');assert.equal(body.lang, 'es-MX'); }
    }
  } finally { child.kill(); }
});
