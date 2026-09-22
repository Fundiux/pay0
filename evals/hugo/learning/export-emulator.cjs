// Explicit emulator-only export. No production credential path or automatic upload.
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || process.env.GCLOUD_PROJECT !== 'demo-pay0') throw Error('EMULATOR_ONLY');
const output = process.argv[2], rootId = process.argv[3], salt = process.env.HUGO_EXPORT_SALT;
if (!output || !rootId || !salt) throw Error('Usage: HUGO_EXPORT_SALT=<secret> node export-emulator.cjs <output-dir> <root-id>');
const admin = require('../../../functions/node_modules/firebase-admin');
const { FirestoreHugoLearningStore } = require('../../../functions/lib/modules/agent007/firestoreHugoLearningStore');
const { exportFromStore, writeExport } = require('./export.cjs');
admin.initializeApp({ projectId: 'demo-pay0' });
(async () => { const prepared = await exportFromStore(new FirestoreHugoLearningStore(admin.firestore()), rootId, { salt }); writeExport(prepared, output);
  console.log(JSON.stringify({ exportId: prepared.manifest.exportId, recordCount: prepared.manifest.recordCount, contentDigest: prepared.manifest.contentDigest })); })().catch(error => { console.error(error.message); process.exitCode = 1; });
