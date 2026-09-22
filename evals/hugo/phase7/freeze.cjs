const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cases = require('./case-specs.cjs');
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
if (cases.length < 25 || cases.length > 40) throw Error('CASE_COUNT_OUTSIDE_PREREGISTERED_RANGE');
const ids = new Set();
for (const row of cases) {
  if (ids.has(row.id)) throw Error(`DUPLICATE_CASE:${row.id}`); ids.add(row.id);
  for (const key of ['expectedEffect', 'actionability', 'taskClass', 'requiredPattern', 'split']) if (!row[key]) throw Error(`MISSING_${key}:${row.id}`);
  new RegExp(row.requiredPattern, 'i'); new RegExp(row.forbiddenPattern, 'i');
}
const dataset = { schemaVersion: 'hugo-phase7-tournament-dataset-v1', frozen: true, syntheticOnly: true,
  freezePolicy: 'Any semantic change requires a new schemaVersion and digest. HOLDOUT is never used to tune prompts or scoring.',
  cases: cases.map(row => ({ ...row, automaticScoring: { requiredPattern: row.requiredPattern, forbiddenPattern: row.forbiddenPattern,
    effectRule: row.expectedEffect === 'CHANGE' ? 'BEFORE lacks required behavior; AFTER has it; counterexample lacks it' : 'BEFORE and AFTER remain acceptable without forbidden behavior' },
    humanReviewDimensions: ['correctness', 'use of evidence', 'clarity', 'calibration', 'ambiguity', 'experience use'] })) };
const manifest = { schemaVersion: 'hugo-phase7-freeze-manifest-v1', frozenAt: '2026-09-22T18:00:00.000Z',
  datasetDigest: digest(dataset), caseCount: cases.length, splitCounts: Object.fromEntries(['DEVELOPMENT','VALIDATION','HOLDOUT'].map(split => [split, cases.filter(row => row.split === split).length])),
  frozenInputs: { scoring: 'appropriate-effect-v1', promptSemantics: 'hugo-v2', contextPolicy: 'phase6-10k-current-facts-first', retrievalPolicy: 'learning-v1-structured-match', retryPolicy: 'retry RATE_LIMIT/TIMEOUT/SERVICE_UNAVAILABLE twice with 1000ms/2000ms backoff; total latency includes retries', stochasticPolicy: 'one run all cases; three total runs for preregistered model-sensitive subset', reasoningIntent: 'STANDARD_REASONING' },
  holdoutPolicy: 'No prompt or scoring changes after HOLDOUT responses are observed. HOLDOUT case IDs are protected by tests.' };
fs.writeFileSync(path.join(__dirname, 'phase7-tournament-dataset-v1.json'), JSON.stringify(dataset, null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'phase7-tournament-dataset-v1.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
