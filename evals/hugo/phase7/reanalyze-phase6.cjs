// Adds Phase 7 semantics without mutating any Phase 6 artifact.
const fs = require('node:fs');
const path = require('node:path');
const phase6 = require('../phase6/phase6-analysis.json');
const humanReview = require('./phase7-human-review-analysis.json');
const reviewedPhase6 = new Map(humanReview.phases.PHASE6.decisions.map(row => [row.caseId, row]));
const selectedRuns = [
  ...require('../phase6/phase6-real-model-results.json').families.slice(0, 5),
  ...require('../phase6/phase6-real-model-retry.json').families,
  ...require('../phase6/phase6-real-model-retry2.json').families,
  ...require('../phase6/phase6-real-model-checkpoints.json').families,
];
const rows = phase6.families.filter(row => row.classification === 'NO_EFFECT').map(row => {
  const first = row.observations[0];
  const raw = selectedRuns.find(run => run.id === row.caseId)?.arms || [];
  const beforeAlreadyMetCriterion = first.beforeSignal === true;
  return {
    caseId: row.caseId, phase6Original: row.classification, phase7Reanalysis: beforeAlreadyMetCriterion ? 'APPROPRIATE_STABILITY' : 'INCONCLUSIVE',
    actionability: beforeAlreadyMetCriterion ? 'INFORMATIVE_ONLY' : 'AMBIGUOUS',
    likelyReason: beforeAlreadyMetCriterion ? 'EXPERIENCE_ALREADY_KNOWN' : 'INCONCLUSIVE',
    confidence: beforeAlreadyMetCriterion ? 'SUPPORTED_BY_AUTOMATIC_SIGNAL' : 'INSUFFICIENT_EVIDENCE',
    expectedBehavior: row.expectedBehavior, expectedBehaviorPresentBefore: first.beforeSignal, expectedBehaviorPresentAfter: first.afterSignal,
    experienceRetrieved: first.retrieved, experienceReferencedById: first.experienceReferencedById, experienceReferencedInWords: first.experienceReferencedInWords,
    beforeContext: { currentFactsConstant: first.sameEvidence, expectedExperienceIds: [] },
    afterContext: { currentFactsConstant: first.sameEvidence, expectedExperienceIds: [row.expectedExperienceId] },
    experienceAdded: row.expectedExperienceId,
    beforeRaw: raw.find(arm => arm.arm === 'BEFORE')?.modelRaw || null, afterRaw: raw.find(arm => arm.arm === 'AFTER')?.modelRaw || null,
    beforeServed: first.before, afterServed: first.after,
    expectedBehavioralChange: 'No new behavior required because BEFORE already met the preregistered behavior signal.',
    actualBehavioralChange: first.beforeSignal === first.afterSignal ? 'BEHAVIOR_SIGNAL_STABLE' : 'BEHAVIOR_SIGNAL_CHANGED',
    humanReview: reviewedPhase6.has(row.caseId) ? {
      status: 'REVIEWED',
      choice: reviewedPhase6.get(row.caseId).choice,
      preferredSource: reviewedPhase6.get(row.caseId).preferredSource,
    } : { status: 'AWAITING_HUMAN_REVIEW' },
  };
});
const report = { schemaVersion: 'hugo-phase7-phase6-reanalysis-v1', historicalArtifactMutated: false, phase6OriginalPreserved: true,
  semantics: 'APPROPRIATE_EFFECT', humanReviewStatus: rows.every(row => row.humanReview.status === 'REVIEWED') ? 'COMPLETE' : 'PARTIAL', humanReviewsCompleted: rows.filter(row => row.humanReview.status === 'REVIEWED').length,
  humanReviewsPending: rows.filter(row => row.humanReview.status !== 'REVIEWED').length, count: rows.length,
  summary: { appropriateStability: rows.filter(row => row.phase7Reanalysis === 'APPROPRIATE_STABILITY').length,
    missedBeneficialChange: rows.filter(row => row.phase7Reanalysis === 'MISSED_BENEFICIAL_CHANGE').length,
    inconclusive: rows.filter(row => row.phase7Reanalysis === 'INCONCLUSIVE').length }, rows };
fs.writeFileSync(path.join(__dirname, 'phase7-phase6-reanalysis.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary));
