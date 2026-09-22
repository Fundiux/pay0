const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '../../functions/src/modules/agent007');
test('Hugo Core has no concrete Firestore collection or SDK dependency', () => {
  for (const name of fs.readdirSync(path.join(base, 'hugoCore'))) {
    if (!name.endsWith('.ts')) continue;
    const source = fs.readFileSync(path.join(base, 'hugoCore', name), 'utf8');
    assert.doesNotMatch(source, /agent007(?:Conversations|Messages|Observations|Recommendations|LearnedRules|Traces)|firebase-admin|\.collection\(/, name);
  }
});
test('Hugo runtime collection names stay in FirestoreHugoDataStore', () => {
  for (const name of ['callables.ts', 'observer.ts', 'reconciliation.ts', 'traceStore.ts']) {
    const source = fs.readFileSync(path.join(base, name), 'utf8');
    assert.doesNotMatch(source, /agent007(?:Conversations|Messages|Observations|Recommendations|LearnedRules|Traces)/, name);
  }
});
