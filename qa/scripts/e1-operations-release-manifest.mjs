// Preparation only: this file never deploys, calls production functions or writes business data.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const files = [
  'functions/src/modules/controlCenter/recoveryReviewCallables.ts',
  'functions/src/modules/controlCenter/recovery.ts',
  'src/components/control-center/RecoveryReview.tsx',
  'src/components/control-center/EngineeringControl.tsx',
  'src/services/controlCenter.ts',
  'src/app/mat/usuarios/page.tsx',
  'src/components/NuevaSolicitudModal.tsx',
  'src/app/wallet/dispersiones/page.tsx',
  'src/components/Modal.tsx',
  'functions/src/modules/paymentApplications/complementAutomation.ts',
  'src/services/paymentComplements.ts',
  'src/components/control-center/PaymentComplementFollowup.tsx',
];
const manifest = {
  schemaVersion: 1,
  package: 'e1-operations-efi',
  state: 'PREPARED_NOT_DEPLOYED',
  generatedAt: new Date().toISOString(),
  sourceHead: git('rev-parse', 'HEAD'),
  sourceDirty: Boolean(git('status', '--porcelain')),
  sourceFiles: files.map(file => ({ file, sha256: createHash('sha256').update(readFileSync(join(root, file))).digest('hex') })),
  minimumPackage: {
    scope: 'Core review and MAT integration only; excludes the newer provider-patch UI change unless its existing callable is also updated.',
    region: 'us-central1',
    newFunctions: ['listOperationRecoveryReviews', 'acknowledgeOperationRecoveryReview'],
    hostingRoutes: ['/reportes', '/mat/usuarios'],
    firestoreRulesChanged: false,
    firestoreIndexesChanged: false,
    productionInvocationApproved: false,
  },
  existingDependencies: {
    reads: ['getMatUserHome', 'listClientsCanonical', 'listCompaniesCanonical', 'listAuthorizedRelatedRecords', 'getClientOperationalBalanceSummary', 'listScopedClientDispersions', 'previewClientDispersionPricing'],
    financialActionsReused: ['createSolicitud', 'initSolicitudDocumentUpload', 'finalizeSolicitudDocumentUpload', 'createClientDispersion'],
    otherExistingDispersionPageActions: ['createClientDispersionsMassive', 'previewClientDispersionIq', 'generateClientDispersionIq', 'requestClientDispersionIncident', 'resolveClientDispersionIncident', 'addClientDispersionNota'],
    note: 'The canonical request modal and the entire dispersion page are reused, including their existing authorized user actions. No business or external action is automatically invoked by this package; their backend logic is not replaced.',
  },
  recoveryExtension: {
    existingFunctions: ['queueOperationRecovery', 'reconcileOperationRecovery'],
    requiredToPublishCurrentRecoveryGuards: true,
    automaticInclusion: false,
    gate: 'Compare the deployed source and approve this separate existing-function update; the minimum two-function package does not update these workers.',
  },
  providerPatchExtension: {
    existingFunctions: ['configurePaymentComplementAutomation'],
    frontendFiles: ['src/services/paymentComplements.ts', 'src/components/control-center/PaymentComplementFollowup.tsx'],
    backendBeforeFrontend: true,
    automaticInclusion: false,
    warning: 'A Hosting artifact built from the complete current worktree includes this new provider/enabled request contract. It must not be paired with the old backend setter.',
    gate: 'Freeze and verify the exact existing-function artifact and its deployed baseline before publication.',
  },
  indexContract: {
    collection: 'operationRecoveryJobs',
    filters: [{ field: 'rootId', operator: '==' }, { field: 'status', operator: '==', value: 'NEEDS_REVIEW' }],
    orderBy: [{ field: '__name__', order: 'ASCENDING' }],
    pageSize: 50,
    scanLimit: 51,
    support: 'Automatic ascending rootId/status indexes with index merging and default document-name ordering; no custom sort field.',
    productionExecutionVerified: false,
  },
  exclusions: ['firestore.rules', 'firestore.indexes.json', 'Telegram transport package', 'IQ backend deployment or automatic IQ invocation', 'WhatsApp actions', 'Hugo model/gateway changes'],
  validation: [
    'node qa/scripts/e1-operations-emulator.mjs',
    'node --test qa/scripts/e1-operations-mat.test.cjs qa/scripts/evolution-recovery-mat.test.cjs',
    'node qa/scripts/e1-operations-mat-browser.cjs',
    'Frontend and Functions builds must match the frozen source before publication.',
  ],
  rollback: {
    hosting: 'Restore the recorded previous Hosting release.',
    newFunctions: 'Keep the authorization-restricted endpoints unused or remove them only through the separately approved rollback.',
    recoveryWorkers: 'Restore their recorded previous revision only if the recovery extension was deployed.',
    data: 'Preserve operationRecoveryReviews and audit. Never delete or rewrite operationRecoveryJobs, requests, balances or documents as rollback.',
  },
};
const output = join(root, 'tmp', 'e1-operations-release');
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ state: manifest.state, sourceHead: manifest.sourceHead, sourceDirty: manifest.sourceDirty, output: join(output, 'manifest.json') }));
