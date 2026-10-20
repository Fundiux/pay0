const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateManifest } = require('./evaluate-receipt-corpus.cjs');

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fields = new Set(['reference', 'trackingKey', 'folio', 'transactionId', 'transferAmount', 'executionDate', 'executionTime', 'senderName', 'beneficiaryName', 'sourceBankName', 'destinationBankName', 'bankName', 'sourceAccount', 'destinationAccount', 'concept']);
const identifiers = new Set(['reference', 'trackingKey', 'folio', 'transactionId']);
const check = (value, code) => { if (!value) throw Error(code); };

/** Pure offline import. Anonymization and expected values require human review;
 * metadata validation cannot prove that free text contains no personal data. */
function importCorrections(input) {
  check(input?.schemaVersion === 1 && ['SYNTHETIC', 'REAL_ANONYMIZED'].includes(input.kind), 'INPUT_SCHEMA');
  if (input.kind === 'REAL_ANONYMIZED') check(input.authorization?.approvedForEvaluation === true && input.authorization?.anonymized === true && token(input.authorization?.reference), 'AUTHORIZATION_REQUIRED');
  check(Array.isArray(input.samples) && input.samples.length > 0 && input.samples.length <= 500, 'SAMPLE_COUNT');
  const seen = new Set();
  const samples = input.samples.map(sample => {
    const a = sample.analysis, c = sample.correction;
    check(a && c && sha(a.id) && sha(a.contentSha256) && sha(c.id), 'SOURCE_IDENTITY');
    check(typeof a.rootId === 'string' && a.rootId.length > 0 && a.rootId.length <= 128 && a.rootId === c.rootId && a.id === c.analysisId && a.contentSha256 === c.documentFingerprint, 'SOURCE_SCOPE_MISMATCH');
    check(typeof a.readerVersion === 'string' && a.readerVersion.length > 0 && a.readerVersion === c.readerVersion, 'READER_MISMATCH');
    const actorUid = c.humanCorrection?.actorUid;
    check(typeof actorUid === 'string' && actorUid.length > 0 && actorUid.length <= 128, 'CORRECTION_ACTOR_REQUIRED');
    const sourceVersion = a.correctionVersionsByActor && Object.hasOwn(a.correctionVersionsByActor, actorUid) ? a.correctionVersionsByActor[actorUid] : a.correctionVersion;
    check(Number.isSafeInteger(c.version) && c.version > 0 && sourceVersion === c.version, 'CORRECTION_VERSION_MISMATCH');
    check(!seen.has(c.id), 'DUPLICATE_CORRECTION'); seen.add(c.id);
    const to = c.humanCorrection?.correctedField;
    check(fields.has(c.field) && fields.has(to) && (c.field === to || identifiers.has(c.field) && identifiers.has(to)), 'CORRECTION_FIELD');
    check(sample.review?.approved === true && sample.review?.anonymizedTextAndExpectedReviewed === true && token(sample.review?.reference), 'HUMAN_REVIEW_REQUIRED');
    const expected = sample.reviewedExpected;
    check(expected && Object.keys(expected).length === 1 && Object.hasOwn(expected, `semantic.${to}`), 'REVIEWED_EXPECTED_FIELD');
    // Never copy original values, actor identity, root, fingerprints or excerpts.
    return { id: sample.id, bank: sample.bank, format: sample.format, text: sample.text, expected: { ...expected },
      provenance: { kind: 'REVIEWED_RECEIPT_CORRECTION', sourceDigest: digest([a.id, c.id, a.rootId, a.contentSha256, c.version]), reviewReference: sample.review.reference, reviewScope: 'HUMAN_ATTESTED_TEXT_AND_EXPECTED', readerVersion: a.readerVersion, correctionVersion: c.version } };
  });
  const manifest = { schemaVersion: 1, kind: input.kind, ...(input.kind === 'REAL_ANONYMIZED' ? { authorization: { approvedForEvaluation: true, anonymized: true, reference: input.authorization.reference } } : {}), samples };
  validateManifest(manifest);
  return manifest;
}

function writePrivateManifest(manifest, repositoryRoot = path.resolve(__dirname, '../..')) {
  let directory = fs.realpathSync(repositoryRoot);
  for (const name of ['.firebase', 'receipt-corpus']) {
    directory = path.join(directory, name);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
    check(!fs.lstatSync(directory).isSymbolicLink() && fs.lstatSync(directory).isDirectory(), 'PRIVATE_DIRECTORY_REQUIRED');
  }
  const file = path.join(directory, `reviewed-${crypto.randomUUID()}.json`);
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return file;
}

if (require.main === module) {
  try {
    check(process.argv.length === 3, 'USAGE_RECEIPT_CORRECTIONS_TO_CORPUS_INPUT_JSON');
    const file = process.argv[2];
    check(fs.statSync(file).size <= 2 * 1024 * 1024, 'INPUT_SIZE');
    const manifest = importCorrections(JSON.parse(fs.readFileSync(file, 'utf8')));
    const output = writePrivateManifest(manifest);
    console.log(JSON.stringify({ ok: true, output, samples: manifest.samples.length, kind: manifest.kind, anonymization: 'HUMAN_ATTESTED_NOT_AUTOMATICALLY_VERIFIED' }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: /^[A-Z_]+$/.test(error.message) ? error.message : 'IMPORT_FAILED_REDACTED' }));
    process.exitCode = 1;
  }
}
module.exports = { importCorrections, writePrivateManifest };
