const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const DATASET_VERSION = 'hugo-learning-v1';
const SANITIZATION_VERSION = 'structured-whitelist-v1';
const featureKeys = new Set(['entityType', 'status', 'issueCode', 'bank', 'instrument', 'eventType', 'outcomeType']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const code = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value);
function sanitize(record, salt) {
  if (!record || record.schemaVersion !== DATASET_VERSION || !record.trainingEligibility?.eligible || record.state !== 'VERIFIED' || !record.outcome?.verified) throw Error('EXPORT_INELIGIBLE');
  if (!['TRAIN', 'VALIDATION', 'TEST'].includes(record.split)) throw Error('EXPORT_PROTECTED_SPLIT');
  if (record.protectedCaseIds?.length) throw Error('EXPORT_PROTECTED_CASE');
  if (![record.domain, record.taskType, record.input?.intent, record.input?.questionClass, record.expectedBehavior].every(code)) throw Error('EXPORT_UNSTRUCTURED_VALUE');
  const features = {};
  for (const [key, value] of Object.entries(record.features || {})) {
    if (!featureKeys.has(key) || typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw Error('EXPORT_UNSAFE_FEATURE');
    features[key] = value;
  }
  const pseudonym = value => hash(`${salt}:${value}`).slice(0, 24);
  const references = record.evidenceReferences.map(ref => ({ system: ref.system, kind: ref.kind, id: pseudonym(ref.id) }));
  return { schemaVersion: DATASET_VERSION, datasetVersion: DATASET_VERSION, sourceExperienceId: pseudonym(record.experienceId), sourceRevision: record.revision,
    split: record.split, domain: record.domain, taskType: record.taskType, input: { intent: record.input.intent, questionClass: record.input.questionClass, ambiguity: record.input.ambiguity },
    features, evidenceCompleteness: record.evidenceCompleteness, evidenceReferences: references,
    modelBehavior: record.modelDecision?.behavior || null, correction: record.correction ? { originalBehavior: record.correction.originalBehavior,
      correctedBehavior: record.correction.correctedBehavior, reasonCode: record.correction.reasonCode } : null,
    humanDecisionType: record.humanDecision?.type || null, outcomeType: record.outcome.type, expectedBehavior: record.expectedBehavior,
    provenance: { createdFromMemory: pseudonym(record.createdFrom.memoryId), trace: record.createdFrom.traceId ? pseudonym(record.createdFrom.traceId) : null,
      sourceVersions: record.sourceVersions, verification: record.quality } };
}
function prepare(records, { salt, createdAt = new Date().toISOString(), exportId = `export_${Date.now()}` }) {
  if (typeof salt !== 'string' || salt.length < 16) throw Error('EXPORT_SALT_REQUIRED');
  if (!Array.isArray(records)) throw Error('EXPORT_INPUT_INVALID');
  const selected = [], exclusions = { INELIGIBLE: 0, HOLDOUT: 0, GOLDEN: 0 };
  for (const record of records) {
    if (record.split === 'TRAIN' && record.protectedCaseIds?.length) throw Error('EXPORT_HOLDOUT_CONTAMINATION');
    if (record.split === 'HOLDOUT' || record.split === 'GOLDEN') { exclusions[record.split]++; continue; }
    if (!record.trainingEligibility?.eligible) { exclusions.INELIGIBLE++; continue; }
    selected.push(sanitize(record, salt));
  }
  selected.sort((a, b) => a.sourceExperienceId.localeCompare(b.sourceExperienceId));
  const lines = selected.map(row => JSON.stringify(row) + '\n').join('');
  const counts = Object.fromEntries(['TRAIN', 'VALIDATION', 'TEST'].map(split => [split.toLowerCase() + 'Count', selected.filter(row => row.split === split).length]));
  const manifest = { exportId, datasetVersion: DATASET_VERSION, schemaVersion: DATASET_VERSION, createdAt,
    selectionPolicyVersion: 'learning-eligibility-v1', sanitizationVersion: SANITIZATION_VERSION, recordCount: selected.length,
    ...counts, holdoutExcludedCount: exclusions.HOLDOUT, goldenExcludedCount: exclusions.GOLDEN, ineligibleExcludedCount: exclusions.INELIGIBLE,
    sourceDigest: hash(records.map(row => [row.experienceId, row.revision]).sort().map(JSON.stringify).join('\n')),
    sourceExperienceDigests: selected.map(row => row.sourceExperienceId), contentDigest: hash(lines), formats: ['JSONL'] };
  return { records: selected, lines, manifest };
}
async function exportFromStore(store, rootId, options) { return prepare(await store.list(rootId, 500), options); }
function writeExport(prepared, directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${prepared.manifest.exportId}.jsonl`), prepared.lines);
  fs.writeFileSync(path.join(directory, `${prepared.manifest.exportId}.manifest.json`), JSON.stringify(prepared.manifest, null, 2) + '\n');
}
module.exports = { prepare, sanitize, exportFromStore, writeExport, DATASET_VERSION, SANITIZATION_VERSION };
