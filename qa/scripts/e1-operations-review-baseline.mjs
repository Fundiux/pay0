import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { tokenInMemory, getMetadata, PROJECT, REGION } from '../../scripts/capture-production-baseline.mjs';
const token = tokenInMemory();
const name = 'getControlCenterEngineering';
const resource = await getMetadata(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions/${name}`, token);
assert.equal(resource.state, 'ACTIVE');
const service = await getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}`, token);
const iam = await getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}:getIamPolicy`, token);
const absent = {};
for (const candidate of ['listOperationRecoveryReviews', 'acknowledgeOperationRecoveryReview']) {
  absent[candidate] = (await getMetadata(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions/${candidate}`, token, true)) === null;
  assert(absent[candidate], 'New function already exists: capture its metadata before preparing any update');
}
const dir = path.resolve('.firebase/modular-release/new-recovery-review');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), project: PROJECT, functions: { [name]: { resource, service, iam } }, absent }), { mode: 0o600 });
console.log(JSON.stringify({ template: name, state: resource.state, absent, productionWrites: 0 }));
