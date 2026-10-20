import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// Real installed consumer exercised through an adapter; no HTTP or Firebase calls.
for (const component of ['hugo-voice-gateway', 'hugo-voice-e2e']) {
  test(`${component}: patched UUID retains Storage and gaxios multipart behavior`, async () => {
    const require = createRequire(new URL(`../../services/${component}/package.json`, import.meta.url));
    const lock = require('./package-lock.json');
    assert.equal(lock.packages['node_modules/@google-cloud/storage'].version, '8.2.0');
    assert.equal(lock.packages['node_modules/uuid'].version, '11.1.1');
    assert.equal(typeof require('firebase-admin/storage').getStorage, 'function');
    const gaxiosPath = require.resolve('gaxios');
    const consumerRequire = createRequire(gaxiosPath);
    assert.equal(consumerRequire('uuid').version(consumerRequire('uuid').v4()), 4);
    assert.match(fs.readFileSync(path.join(path.dirname(gaxiosPath), 'gaxios.js'), 'utf8'), /uuid_1\.v4/);
    const { Gaxios } = require('gaxios');
    let body = '';
    const response = await new Gaxios().request({
      url: 'https://fixture.invalid/upload', method: 'POST',
      multipart: [{ headers: { 'Content-Type': 'text/plain' }, content: 'fixture payload' }],
      adapter: async options => {
        assert.match(options.headers['Content-Type'], /^multipart\/related; boundary=[a-f0-9-]{36}$/);
        for await (const chunk of options.body) body += chunk.toString();
        return { config: options, status: 200, statusText: 'OK', headers: {}, data: 'fixture' };
      },
    });
    assert.equal(response.status, 200);
    assert.ok(body.includes('fixture payload'));
  });
}
