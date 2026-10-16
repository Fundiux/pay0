// Bounded migration of bundled, reviewed company templates. Dry-run by default.
// Official gcloud credentials stay in memory; plans/backups remain ignored.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const admin = require('../functions/node_modules/firebase-admin');
const { OAuth2Client } = require('../functions/node_modules/google-auth-library');
const { Storage } = require('../functions/node_modules/@google-cloud/storage');
const projectId = 'pay-0-system';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
const option = name => { const at = args.indexOf(name); return at < 0 ? '' : args[at + 1] || ''; };
const archive = path.resolve(__dirname, '../__untracked_archive/corporate-migration');
const revision = snap => snap.exists ? { seconds: snap.updateTime.seconds, nanoseconds: snap.updateTime.nanoseconds } : null;
let stage = 'VALIDATE_ARGUMENTS';
async function main() {
  const rootId = option('--root'), bucket = option('--bucket');
  const applyPath = option('--apply'), outputPath = option('--output');
  if (!rootId || rootId.includes('/') || !/^pay-0-system\.(appspot\.com|firebasestorage\.app)$/.test(bucket) ||
      process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw Error('INVALID_PRODUCTION_ARGUMENTS');
  const planPath = path.resolve(applyPath || outputPath || '.');
  if (!planPath.startsWith(archive + path.sep)) throw Error('IGNORED_PLAN_PATH_REQUIRED');
  stage = 'OFFICIAL_AUTHENTICATION';
  const sdk = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Cloud SDK', 'google-cloud-sdk');
  const token = execFileSync(path.join(sdk, 'platform', 'bundledpython', 'python.exe'),
    [path.join(sdk, 'lib', 'gcloud.py'), 'auth', 'print-access-token', '--quiet'],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 }).trim();
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: token, expiry_date: Date.now() + 45 * 60000 });
  admin.initializeApp({ projectId, storageBucket: bucket });
  const db = admin.firestore(); db.settings({ authClient });
  const storage = new Storage({ projectId, authClient });
  stage = 'VERIFY_BUCKET';
  await storage.bucket(bucket).getMetadata();
  admin.storage().bucket = name => storage.bucket(name || bucket);
  const { isOwnInvoiceIssuerCompany } = require('../functions/lib/modules/facturama/service');
  const { inspectBundledCorporateMigration, migrateBundledCorporateResource } = require('../functions/lib/modules/canonicalCenter/service');
  const { PAY0_CANONICAL_STORAGE: stores } = require('../functions/lib/modules/canonicalCenter/contracts');
  const verify = async item => {
    const resource = (await db.doc(`${stores.resources}/${item.resourceId}`).get()).data();
    const version = resource?.activeVersion ? (await db.doc(`${stores.versions}/${item.resourceId}:${resource.activeVersion}`).get()).data() : null;
    if (!version || version.status !== 'ACTIVE' || version.rootId !== rootId || version.ownCompanyId !== item.companyId ||
        version.contentDigest !== item.contentDigest || version.artifacts?.length !== 2) throw Error('ACTIVE_RESOURCE_READBACK_FAILED');
    for (const artifact of version.artifacts) {
      const prefix = `pay0-canonical/${rootId}/${item.companyId}/DOCUMENT_TEMPLATE/${item.resourceId}/${resource.activeVersion}/`;
      if (!artifact.storagePath.startsWith(prefix)) throw Error('ARTIFACT_SCOPE_INVALID');
      const [bytes] = await storage.bucket(bucket).file(artifact.storagePath).download();
      if (bytes.length !== artifact.sizeBytes || sha(bytes) !== artifact.sha256) throw Error('ARTIFACT_HASH_MISMATCH');
    }
  };
  if (applyPath) {
    stage = 'VALIDATE_PLAN';
    const bytes = fs.readFileSync(planPath), digest = sha(bytes), plan = JSON.parse(bytes);
    if (option('--confirm-sha256') !== digest || plan.projectId !== projectId || plan.rootId !== rootId || plan.bucket !== bucket ||
        plan.revision !== 'ASTRA_CORPORATE_PLAN_V1' || !Array.isArray(plan.items) || plan.items.length > 150) throw Error('REVIEWED_PLAN_REQUIRED');
    // All company revisions are checked before the first mutation.
    for (const company of plan.companies) {
      const current = await db.doc(`companies/${company.id}`).get();
      if (JSON.stringify(revision(current)) !== JSON.stringify(company.revision)) throw Error('COMPANY_CHANGED_REPLAN');
    }
    const backup = { plan, before: [] };
    for (const item of plan.items) {
      const current = await db.doc(`${stores.resources}/${item.resourceId}`).get();
      backup.before.push({ path: current.ref.path, data: current.data() || null, revision: revision(current) });
      if (current.exists && current.get('latestVersion')) {
        const previous = await db.doc(`${stores.versions}/${item.resourceId}:${current.get('latestVersion')}`).get();
        backup.before.push({ path: previous.ref.path, data: previous.data() || null, revision: revision(previous) });
      }
    }
    fs.mkdirSync(archive, { recursive: true });
    const backupPath = path.join(archive, `before-${digest}.json`);
    if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), { flag: 'wx' });
    stage = 'MIGRATE_AND_VERIFY';
    let migrated = 0, preserved = 0;
    for (const item of plan.items) {
      const result = await migrateBundledCorporateResource({ rootId, companyId: item.companyId, use: item.use, expectedDigest: item.contentDigest });
      await verify(item);
      if (result.skipped) preserved++; else migrated++;
    }
    const report = { ok: true, checkedAt: new Date().toISOString(), planSha256: digest, migrated, preserved, verified: plan.items.length, artifactsVerified: plan.items.length * 2, externalFinancialActions: 0 };
    fs.writeFileSync(path.join(archive, `after-${digest}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } else {
    stage = 'READ_BOUNDED_COMPANIES';
    const companies = await db.collection('companies').where('rootId', '==', rootId).limit(101).get();
    if (companies.size > 100) throw Error('COMPANY_COHORT_TOO_LARGE');
    const plan = { revision: 'ASTRA_CORPORATE_PLAN_V1', projectId, bucket, rootId, checkedAt: new Date().toISOString(), companies: [], items: [] };
    let ownCompanies = 0, withoutBundle = 0, managedPreserved = 0;
    for (const company of companies.docs) {
      if (company.get('active') === false || !isOwnInvoiceIssuerCompany(company.data())) continue;
      ownCompanies++;
      const items = await inspectBundledCorporateMigration(rootId, company.id);
      if (!items.length) { withoutBundle++; continue; }
      const eligible = items.filter(item => !item.managed);
      managedPreserved += items.length - eligible.length;
      if (eligible.length) plan.companies.push({ id: company.id, revision: revision(company) });
      plan.items.push(...eligible);
    }
    if (plan.items.length > 150) throw Error('RESOURCE_COHORT_TOO_LARGE');
    const bytes = JSON.stringify(plan, null, 2) + '\n';
    fs.mkdirSync(archive, { recursive: true });
    fs.writeFileSync(planPath, bytes, { flag: 'wx' });
    console.log(JSON.stringify({ ok: true, dryRun: true, companyCount: companies.size, ownCompanies, withoutBundle, managedPreserved, planned: plan.items.length, sha256: sha(bytes), externalFinancialActions: 0 }));
  }
}
main().then(() => process.exit(0)).catch(error => {
  console.error(JSON.stringify({ ok: false, stage, code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'MIGRATION_FAILED_DETAILS_WITHHELD', errorCode: String(error.code || '').replace(/[^A-Za-z0-9_/-]/g, '').slice(0, 80) }));
  process.exitCode = 1;
});
