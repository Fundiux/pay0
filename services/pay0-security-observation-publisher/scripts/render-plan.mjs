import { CANARY } from '../src/config.mjs';
const [image, revision] = process.argv.slice(2);
if (!/^us-central1-docker\.pkg\.dev\/[a-z][a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/.test(image || '') ||
    !new RegExp(`^${CANARY.serviceName}-[a-z0-9-]{1,90}$`).test(revision || '')) throw Error('REVIEWED_IMAGE_DIGEST_AND_REVISION_REQUIRED');
// Offline proposal only. The caller must verify revision against Cloud Run metadata
// after deployment before updating observer allowlist. No API/IAM/apply here.
console.log(JSON.stringify({ status: 'PROPOSED_REQUIRES_CENTRAL_REVIEW', sourceProject: CANARY.projectId,
  service: { name: CANARY.serviceName, region: 'us-central1', image, serviceAccount: CANARY.email,
    invokerIamDisabled: false, invokerMembers: [], minInstances: 0, maxInstances: 1, concurrency: 1,
    cpu: '1', memory: '256Mi', timeoutSeconds: 5,
    env: { PAY0_SOURCE_PROJECT_ID: CANARY.projectId, OBSERVATION_PUBLISHER_MODE: 'DISABLED' },
    startupProbe: { httpGet: { path: '/healthz', port: 8080 } } },
  runtimeIam: { project: CANARY.projectId, customRolePermissions: ['logging.logEntries.create'],
    prohibited: ['roles/editor', 'roles/owner', 'roles/datastore.user', 'roles/secretmanager.secretAccessor', 'roles/iam.serviceAccountTokenCreator'] },
  originCandidate: { projectId: CANARY.projectId, publisherId: CANARY.publisherId,
    logName: 'projects/pay-0-system/logs/pay0_security_observation', serviceName: CANARY.serviceName,
    revisions: [revision], roots: [CANARY.rootId], actors: [CANARY.actorUid] },
  gates: ['No public invoker; assign reviewed operator identity separately', 'Read exact deployed revision metadata before origin registration',
    'Inspect effective runtime IAM including inherited permissions', 'Dry-run Logging first; sink remains disabled',
    'Activate synthetic canary and sink only after central review; no authGuard hook in this release'] }, null, 2));
