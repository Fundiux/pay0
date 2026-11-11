// Read-only: lists scaling.minInstanceCount / maxInstanceCount of the warm-capacity service set.
// Uses Application Default Credentials (gcloud auth application-default login). It never writes.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config/warm-capacity.json'), 'utf8'));
const require = createRequire(path.join(root, 'functions/package.json'));
const { GoogleAuth } = require('google-auth-library');

const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
const { token } = await client.getAccessToken();
const idOf = service => (service.kind === 'function' ? service.name.toLowerCase() : service.name);
console.log(`window ${config.windowStart}-${config.windowEnd} ${config.timeZone}; warm=${config.warmMinInstances} cold=${config.coldMinInstances}`);
for (const service of config.services) {
  const url = `https://run.googleapis.com/v2/projects/${config.project}/locations/${config.region}/services/${idOf(service)}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) { console.log(`${service.name.padEnd(36)} ERROR HTTP ${response.status}`); continue; }
  const body = await response.json();
  console.log(`${service.name.padEnd(36)} min=${body.scaling?.minInstanceCount ?? 0} max=${body.template?.scaling?.maxInstanceCount ?? '-'} revision=${body.latestReadyRevision?.split('/').pop() ?? '-'}`);
}
