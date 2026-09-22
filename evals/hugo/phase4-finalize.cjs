// Re-score stored responses without another model call. Keep raw output immutable.
const fs = require('node:fs');
const path = require('node:path');
const cases = require('./phase4-dataset.cjs');
const file = path.join(__dirname, 'phase4-model-results.json');
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const previous = require('./phase4-summary.json');
const pilotCorrections = require('./phase4-pilot-model-results.json').scoringCorrections;
const corrections = (report.scoringCorrections || []).filter(row => row.reason?.startsWith('Completado and completada'));
for (const result of report.results) {
  const fixture = cases.find(row => row.id === result.caseId);
  if (!fixture) throw Error(`Missing fixture ${result.caseId}`);
  result.fixtureVersion = fixture.fixtureVersion;
  if (result.caseId === 'memory-conflict' && result.criterionChecks.contains === false &&
      /\best[aá] completad[oa]\b/i.test(result.servedResponse || '')) {
    corrections.push({ caseId: result.caseId, promptVersion: result.promptVersion,
      previous: result.responseClassification, current: 'PASS_CRITERIA',
      reason: 'Completado and completada express the same completed status for this solicitud.' });
    result.criterionChecks.contains = true;
    result.responseClassification = 'PASS_CRITERIA';
  }
}
report.scoringRevision = 4;
report.scoringCorrections = corrections;
report.pilotScoringCorrections = pilotCorrections;
report.metadataCorrection = 'The first five fixtureVersion labels were set to phase3-synthetic-v1 after the model run began; only this metadata was corrected. Raw responses and evidence hashes are unchanged.';
const versions = ['legacy-v1', 'hugo-v2'];
const count = (version, classification) => report.results.filter(row => row.promptVersion === version && row.responseClassification === classification).length;
report.byVersion = Object.fromEntries(versions.map(version => [version, {
  evaluated: report.results.filter(row => row.promptVersion === version && row.rawModelResponse).length,
  passCriteria: count(version, 'PASS_CRITERIA'), fail: count(version, 'FAIL'), needsHumanReview: count(version, 'NEEDS_HUMAN_REVIEW'),
}]));
const byCategory = Object.fromEntries([...new Set(cases.map(row => row.category))].map(category => [category,
  Object.fromEntries(versions.map(version => [version, {
    pass: report.results.filter(row => row.category === category && row.promptVersion === version && row.responseClassification === 'PASS_CRITERIA').length,
    fail: report.results.filter(row => row.category === category && row.promptVersion === version && row.responseClassification === 'FAIL').length,
    review: report.results.filter(row => row.category === category && row.promptVersion === version && row.responseClassification === 'NEEDS_HUMAN_REVIEW').length,
  }]))]));
const critical = new Set(['sample-boundary', 'partial-zero', 'partial-several', 'ambiguous-other']);
const summary = { schemaVersion: 1, evalRunId: report.evalRunId, datasetVersion: report.datasetVersion, pairedCases: report.pairedCases,
  legacyPhase3: previous.legacyPhase3, phase4: report.byVersion,
  phase4CriticalFailures: Object.fromEntries(versions.map(version => [version,
    report.results.filter(row => row.promptVersion === version && critical.has(row.caseId) && row.responseClassification === 'FAIL').length])),
  humanReviewsCompleted: 0, humanReviewsPending: cases.length, byCategory };
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'phase4-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ byVersion: report.byVersion, phase4CriticalFailures: summary.phase4CriticalFailures }));
