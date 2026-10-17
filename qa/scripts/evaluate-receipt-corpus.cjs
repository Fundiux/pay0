const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const { createEvaluationReader } = require('./remediation-ocr-quota.test.cjs');

const fields = new Set(['senderName', 'beneficiaryName', 'sourceBankName', 'destinationBankName', 'bankName', 'amount', 'date', 'time', 'reference', 'concept', 'currency', 'paymentForm', 'payerRfc', 'beneficiaryRfc', 'clabe', 'account', 'destinationAccount', 'amountVerified', 'dateVerified', 'executionConfirmed', 'identityConflict']);
const semanticFields = new Set(['transferAmount', 'executionDate', 'executionTime', 'reference', 'trackingKey', 'folio', 'transactionId', 'senderName', 'beneficiaryName', 'payerRfc', 'beneficiaryRfc', 'sourceAccount', 'destinationAccount', 'sourceBankName', 'destinationBankName', 'bankName', 'concept', 'currency']);
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !['SYNTHETIC', 'REAL_ANONYMIZED'].includes(manifest.kind)) throw Error('Corpus schema/kind required');
  if (manifest.kind === 'REAL_ANONYMIZED' && (manifest.authorization?.approvedForEvaluation !== true || manifest.authorization?.anonymized !== true || !token(manifest.authorization?.reference))) throw Error('Real corpus requires explicit anonymized evaluation authorization reference');
  if (!Array.isArray(manifest.samples) || !manifest.samples.length || manifest.samples.length > 500) throw Error('Corpus requires 1–500 samples');
  const ids = new Set();
  for (const sample of manifest.samples) {
    if (!token(sample.id) || ids.has(sample.id) || !token(sample.bank) || !['PDF_TEXT', 'IMAGE_OCR_TEXT'].includes(sample.format)) throw Error('Sample requires unique opaque id, bank token and extraction format');
    ids.add(sample.id);
    if (typeof sample.text !== 'string' || sample.text.length > 100000 || !sample.text.trim()) throw Error('Bounded extracted text is required');
    if (!sample.expected || !Object.keys(sample.expected).length) throw Error('Reviewed expected fields are required');
    for (const [field, expected] of Object.entries(sample.expected)) {
      if (!(fields.has(field) || field.startsWith('semantic.') && semanticFields.has(field.slice(9)))) throw Error('Unsupported evaluation field');
      if (expected !== null && !['string', 'number', 'boolean'].includes(typeof expected)) throw Error('Expected values must be scalar');
      if (typeof expected === 'number' && !Number.isFinite(expected)) throw Error('Nonfinite expected value');
    }
  }
  return manifest;
}

function evaluate(manifest, reader) {
  validateManifest(manifest);
  const byField = {}, byBankFormat = {}, errors = [], durations = [];
  let exactDocuments = 0, fieldCount = 0, exactFields = 0, reviewRequired = 0;
  for (const sample of manifest.samples) {
    const started = performance.now();
    const parsed = reader.parse(sample.text), semantic = reader.semantic(sample.text, parsed);
    durations.push(performance.now() - started);
    if (semantic.reviewRequired) reviewRequired++;
    let exact = true;
    const group = `${sample.bank}/${sample.format}`;
    byBankFormat[group] ||= { documents: 0, exactDocuments: 0, fields: 0, exactFields: 0 };
    byBankFormat[group].documents++;
    for (const [field, expected] of Object.entries(sample.expected)) {
      const actual = field.startsWith('semantic.') ? semantic.fields[field.slice(9)]?.value ?? null : parsed[field] ?? null;
      const matches = actual === expected;
      byField[field] ||= { total: 0, exact: 0, missing: 0, unexpected: 0, mismatch: 0 };
      byField[field].total++; fieldCount++; byBankFormat[group].fields++;
      if (matches) { byField[field].exact++; exactFields++; byBankFormat[group].exactFields++; }
      else {
        exact = false;
        const reason = actual == null || actual === '' ? 'missing' : expected == null || expected === '' ? 'unexpected' : 'mismatch';
        byField[field][reason]++;
        // No raw text, actual values, expected values, names or account numbers in reports.
        errors.push({ sampleId: sample.id, field, reason });
      }
    }
    if (exact) { exactDocuments++; byBankFormat[group].exactDocuments++; }
  }
  durations.sort((a, b) => a - b);
  return { readerVersion: reader.readerVersion, documents: manifest.samples.length, exactDocuments, exactDocumentRate: exactDocuments / manifest.samples.length, fields: fieldCount, exactFields, exactFieldRate: exactFields / fieldCount, reviewRequired, byField, byBankFormat, errors,
    timing: { stage: 'TEXT_PARSER_ONLY', meanMs: durations.reduce((a, b) => a + b, 0) / durations.length, p95Ms: durations[Math.ceil(durations.length * .95) - 1] } };
}

// Paired outcomes prevent aggregate gains from hiding a field regression.
function compare(manifest, baseline, candidate) {
  validateManifest(manifest);
  const failed = result => new Set(result.errors.map(error => `${error.sampleId}/${error.field}`));
  const oldErrors = failed(baseline), newErrors = failed(candidate);
  const byBankFormatField = {}, changes = [];
  const totals = { improved: 0, regressed: 0, unchangedCorrect: 0, unchangedIncorrect: 0 };
  for (const sample of manifest.samples) for (const field of Object.keys(sample.expected)) {
    const key = `${sample.id}/${field}`, before = !oldErrors.has(key), after = !newErrors.has(key);
    const outcome = before ? after ? 'unchangedCorrect' : 'regressed' : after ? 'improved' : 'unchangedIncorrect';
    const group = `${sample.bank}/${sample.format}/${field}`;
    byBankFormatField[group] ||= { improved: 0, regressed: 0, unchangedCorrect: 0, unchangedIncorrect: 0 };
    byBankFormatField[group][outcome]++; totals[outcome]++;
    if (before !== after) changes.push({ sampleId: sample.id, bank: sample.bank, format: sample.format, field, outcome });
  }
  return { ...totals, byBankFormatField, changes,
    regressionGate: totals.regressed ? 'FAIL' : 'PASS',
    promotion: 'HUMAN_REVIEW_REQUIRED_NO_AUTOMATIC_PROMOTION',
    productionAccuracy: manifest.kind === 'SYNTHETIC' ? 'NOT_EVALUATED' : 'USER_ATTESTED_EXTRACTED_TEXT_ONLY',
    learning: 'OFFLINE_COMPARISON_ONLY_NO_TRAINING_OR_WRITES' };
}

function sourceIdentity() {
  const sourceFiles = ['functions/src/modules/pagos/receiptPdfCallables.ts', 'functions/src/modules/pagos/receiptSemantics.ts',
    'functions/src/modules/pagos/receiptLearning.ts',
    'qa/scripts/remediation-ocr-quota.test.cjs', 'qa/scripts/evaluate-receipt-corpus.cjs'];
  return { headCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    kind: 'WORKING_TREE_SNAPSHOT',
    files: Object.fromEntries(sourceFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])) };
}

if (require.main === module) {
  const [manifestPath, requestedRef] = process.argv.slice(2);
  if (!manifestPath || !requestedRef || !/^[a-f0-9]{7,40}$/i.test(requestedRef)) throw Error('Usage: node qa/scripts/evaluate-receipt-corpus.cjs <manifest.json> <baseline-commit>');
  if (fs.statSync(manifestPath).size > 2 * 1024 * 1024) throw Error('Manifest exceeds 2 MiB');
  const source = fs.readFileSync(manifestPath);
  const manifest = validateManifest(JSON.parse(source.toString('utf8')));
  const baselineCommit = execFileSync('git', ['rev-parse', '--verify', `${requestedRef}^{commit}`], { encoding: 'utf8' }).trim();
  const candidateSource = sourceIdentity();
  const result = { schemaVersion: 2, candidateSource, corpusKind: manifest.kind, manifestSha256: crypto.createHash('sha256').update(source).digest('hex'), baselineCommit,
    scope: 'Extracted text only. No PDF rendering, OCR provider, live financial operation or model training.',
    realAnonymizedValidation: manifest.kind === 'REAL_ANONYMIZED' ? 'EVALUATED_USER_ATTESTED_CORPUS' : 'NOT_EVALUATED',
    authorizationReference: manifest.kind === 'REAL_ANONYMIZED' ? manifest.authorization.reference : null,
    baseline: evaluate(manifest, createEvaluationReader(baselineCommit)), candidate: evaluate(manifest, createEvaluationReader()) };
  if (JSON.stringify(candidateSource) !== JSON.stringify(sourceIdentity())) throw Error('Candidate source changed during evaluation');
  result.comparison = compare(manifest, result.baseline, result.candidate);
  fs.mkdirSync('output', { recursive: true });
  const output = path.join('output', `receipt-corpus-${manifest.kind.toLowerCase()}.json`);
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, corpusKind: result.corpusKind, realAnonymizedValidation: result.realAnonymizedValidation, baselineExact: result.baseline.exactFields, candidateExact: result.candidate.exactFields, fields: result.candidate.fields, regressionGate: result.comparison.regressionGate, regressed: result.comparison.regressed }));
  if (result.comparison.regressionGate === 'FAIL') process.exitCode = 1;
}
module.exports = { validateManifest, evaluate, compare };
