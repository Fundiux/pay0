// Read-only. No apply/enable/create/update commands, no credentials or payloads.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
const args = process.argv.slice(2);
if (args.some(arg => !['--metadata'].includes(arg))) throw new Error('SUPPORTED_OPTIONS: --metadata');
function query(command) {
  const result = spawnSync(process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud', [...command, '--quiet', '--format=json'], { encoding: 'utf8', timeout: 30000, windowsHide: true, shell: process.platform === 'win32' });
  if (result.status !== 0) return { available: false }; // Never forward provider stderr.
  try { return { available: true, data: JSON.parse(result.stdout) }; } catch { return { available: false }; }
}
async function billingPermissions(resource) {
  if (!/^billingAccounts\/[A-Z0-9-]+$/.test(resource || '')) return null;
  // Token stays in child-process memory and Authorization header only. Never
  // return stdout/stderr or include the billing resource/token in diagnostics.
  const credential = spawnSync(process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud', ['auth', 'print-access-token', '--quiet'], { encoding: 'utf8', timeout: 30000, windowsHide: true, shell: process.platform === 'win32' });
  if (credential.status !== 0 || !credential.stdout.trim()) return null;
  try {
    const response = await fetch(`https://cloudbilling.googleapis.com/v1/${resource}:testIamPermissions`, {
      method: 'POST', headers: { authorization: `Bearer ${credential.stdout.trim()}`, 'content-type': 'application/json', 'x-goog-user-project': 'pay-0-system' },
      body: JSON.stringify({ permissions: ['billing.resourceAssociations.create', 'billing.accounts.get'] }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const result = await response.json();
    return Array.isArray(result.permissions) ? result.permissions : [];
  } catch { return null; }
}
const report = { mode: 'DRY_RUN_READ_ONLY', deploy: false, billingLinkPermissionVerified: false, iamNegativeTestsExecuted: false };
let config;
try { config = loadConfig(process.env); report.configValid = true; report.isolatedProject = config.projectId; }
catch { report.configValid = false; }
const manifest = JSON.parse(readFileSync(new URL('../core-manifest.json', import.meta.url), 'utf8'));
report.coreManifest = manifest.schema;
report.coreFiles = Object.keys(manifest.files).length;
if (args.includes('--metadata')) {
  const billing = query(['billing', 'projects', 'describe', 'pay-0-system', '--billing-project=pay-0-system']);
  report.sourceBillingReadable = billing.available;
  report.sourceBillingEnabled = billing.data?.billingEnabled === true;
  if (billing.data?.billingAccountName) report.billingReferenceHash = createHash('sha256').update(billing.data.billingAccountName).digest('hex').slice(0, 16);
  const permissions = await billingPermissions(billing.data?.billingAccountName);
  report.billingPermissionProbeAvailable = permissions !== null;
  report.billingLinkPermissionVerified = permissions?.includes('billing.resourceAssociations.create') === true;
  const project = query(['projects', 'describe', 'pay-0-system']);
  report.sourceProjectReadable = project.available;
  report.sourceParentReported = Boolean(project.data?.parent);
  const orgs = query(['organizations', 'list']);
  report.organizationListReadable = orgs.available;
  report.visibleOrganizationCount = Array.isArray(orgs.data) ? orgs.data.length : null;
  if (config) {
    const target = query(['projects', 'describe', config.projectId]);
    report.targetProjectReadable = target.available;
    report.targetLifecycle = target.data?.lifecycleState || 'UNKNOWN_OR_NOT_VISIBLE';
    if (target.available) {
      const iam = query(['projects', 'get-iam-policy', config.projectId]);
      report.targetProjectIamReadable = iam.available;
      const runtime = `serviceAccount:pay0-sentinel-observer@${config.projectId}.iam.gserviceaccount.com`;
      const grants = (iam.data?.bindings || []).filter(binding => binding.members?.includes(runtime));
      const expected = `resource.name == 'projects/${config.projectId}/databases/sentinel-observation'`;
      report.runtimeScopedWriterBindings = grants.filter(binding => binding.role === `projects/${config.projectId}/roles/sentinelObservationWriter` && binding.condition?.expression === expected).length;
      report.runtimeUnexpectedProjectBindings = grants.filter(binding => binding.role !== `projects/${config.projectId}/roles/sentinelObservationWriter` || binding.condition?.expression !== expected).length;
      report.effectiveIamCertified = false; // Resource/org/group grants require separate review.
    }
  }
}
console.log(JSON.stringify(report, null, 2));
if (!report.configValid) process.exitCode = 2;
