// Verify the exact diagnostics archive. Review is tested as an INTERNAL store
// method because this artifact intentionally does not export the review callable.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const JSZip = require('../../functions/node_modules/jszip');
const root = path.resolve(__dirname, '../..');
const directory = path.resolve(root, process.env.PAY0_D2_ARTIFACT_DIR || '');
assert.ok(directory.startsWith(path.join(root, '.firebase/modular-release') + path.sep), 'PRIVATE_ARTIFACT_REQUIRED');
assert.match(process.env.PAY0_D2_ARCHIVE_SHA || '', /^[a-f0-9]{64}$/);
assert.match(process.env.GCLOUD_PROJECT || '', /^demo-pay0-e1-/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
const runtime = path.join(directory, 'runtime'), archive = fs.readFileSync(path.join(directory, 'diagnostics-d2.zip'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(archive), process.env.PAY0_D2_ARCHIVE_SHA, 'ARCHIVE_CHANGED');
(async () => {
  const zip = await JSZip.loadAsync(archive);
  async function verifyBytes() {
    for (const entry of Object.values(zip.files)) if (!entry.dir)
      assert.deepEqual(fs.readFileSync(path.join(runtime, entry.name)), await entry.async('nodebuffer'), `RUNTIME_CHANGED:${entry.name}`);
  }
  await verifyBytes();
  const original = fs.readFileSync(path.join(__dirname, 'e1-operations-d2-review-emulator.test.cjs'), 'utf8');
  const marker = "global.fetch = async () => { throw Error('EXTERNAL_PROVIDER_FORBIDDEN'); };";
  assert.ok(original.includes(marker));
  let fixture = original.replace(marker, marker + "\nassert.equal(calls.reviewAgent007LearningRule, undefined, 'Review callable must remain absent');\nconst ArtifactRuleStore = load('./lib/modules/agent007/firestoreHugoLearningRuleStore').FirestoreHugoLearningRuleStore;");
  for (const [action, fields] of [['APPROVE', 'supportingIds: ids'], ['REVOKE', 'ruleId: approved.ruleId']]) {
    const old = `calls.reviewAgent007LearningRule.run({ auth: { uid, token: {} }, data: { action: '${action}', ${fields} } })`;
    assert.equal(fixture.split(old).length, 2, 'EXPECTED_REVIEW_FIXTURE');
    fixture = fixture.replace(old, `new ArtifactRuleStore(db).review({ uid, rootId }, { action: '${action}', ${fields} })`);
  }
  const qa = path.join(directory, 'qa-internal-review'); fs.mkdirSync(qa, { recursive: true });
  const testFile = path.join(qa, 'diagnostics-artifact.test.cjs'); fs.writeFileSync(testFile, fixture);
  const result = spawnSync(process.execPath, ['--test', '--test-timeout=180000', testFile], {
    cwd: root, env: { ...process.env, PAY0_D2_FUNCTIONS_ROOT: runtime }, encoding: 'utf8', windowsHide: true, timeout: 240000, maxBuffer: 5e6,
  });
  fs.writeFileSync(path.join(qa, 'result.log'), (result.stdout || '') + (result.stderr || ''));
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  assert.equal(result.status, 0, 'EXACT_ARTIFACT_TEST_FAILED');
  await verifyBytes();
  const proof = { status: 'PASS', archiveSha256: sha(archive), originalTestSha256: sha(Buffer.from(original)), adaptedTestSha256: sha(Buffer.from(fixture)),
    reviewSurface: 'INTERNAL_STORE_METHOD_ONLY_CALLABLE_ABSENT', diagnosticsSurface: 'REAL_CALLABLE', productionWrites: 0 };
  fs.writeFileSync(path.join(qa, 'proof.json'), JSON.stringify(proof, null, 2)); console.log(JSON.stringify(proof));
})().catch(error => { console.error(error); process.exitCode = 1; });
