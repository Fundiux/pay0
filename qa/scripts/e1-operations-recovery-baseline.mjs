import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { tokenInMemory, getMetadata, PROJECT, REGION } from '../../scripts/capture-production-baseline.mjs';
const token = tokenInMemory();
for (const [name, short] of [['queueOperationRecovery', 'queue'], ['reconcileOperationRecovery', 'reconcile']]) {
  const resource = await getMetadata(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions/${name}`, token);
  assert.equal(resource.state, 'ACTIVE');
  const source = resource.buildConfig?.sourceProvenance?.resolvedStorageSource || resource.buildConfig?.source?.storageSource;
  assert.deepEqual(source, { bucket: 'gcf-v2-sources-751158244178-us-central1', object: `${name}/function-source.zip`, generation: short === 'queue' ? '1791499292054448' : '1791499422598307' }, 'Deployed source drift: review a new base before packaging');
  const service = await getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}`, token);
  const iam = await getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}:getIamPolicy`, token);
  const dir = path.resolve(`.firebase/modular-release/recovery-${short}-5b0db917bd70`);
  const baselineFile = path.join(dir, 'baseline.json');
  const bytes = JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), project: PROJECT, functions: { [name]: { resource, service, iam } } });
  fs.writeFileSync(baselineFile, bytes, { mode: 0o600 });
  const inputFile = path.join(dir, 'input.json');
  const input = JSON.parse(fs.readFileSync(inputFile));
  Object.assign(input, { baselineFile, baselineSha256: crypto.createHash('sha256').update(bytes).digest('hex'), createdAt: new Date().toISOString() });
  fs.writeFileSync(inputFile, JSON.stringify(input, null, 2));
  console.log(JSON.stringify({ function: name, state: resource.state, baselineSha256: input.baselineSha256, productionWrites: 0 }));
}
