const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const phase4Blind = require('../phase4-model-results-blind-review.json');
const phase6Blind = require('../phase6/phase6-blind-review.json');
const phase4Export = require('./human-reviews/phase4-user-export.json');
const phase6Export = require('./human-reviews/phase6-user-export.json');

const allowedChoices = new Set(['A_BETTER', 'B_BETTER', 'EQUIVALENT', 'BOTH_ACCEPTABLE', 'BOTH_UNACCEPTABLE']);
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');

function validateExport(label, blind, review, { requireComplete = false } = {}) {
  if (review.evalRunId !== blind.evalRunId) throw new Error(`${label}: EVAL_RUN_ID_MISMATCH`);
  if (!review.reviewedAt || !Number.isFinite(Date.parse(review.reviewedAt))) throw new Error(`${label}: INVALID_REVIEWED_AT`);
  if (!review.decisions || Array.isArray(review.decisions) || typeof review.decisions !== 'object') throw new Error(`${label}: INVALID_DECISIONS`);
  const expected = new Set(blind.cases.map(row => row.caseId));
  const reviewedIds = Object.keys(review.decisions);
  for (const caseId of reviewedIds) {
    if (!expected.has(caseId)) throw new Error(`${label}: UNKNOWN_CASE:${caseId}`);
    const decision = review.decisions[caseId];
    if (!decision || !allowedChoices.has(decision.choice)) throw new Error(`${label}: INVALID_CHOICE:${caseId}`);
    if (decision.note != null && typeof decision.note !== 'string') throw new Error(`${label}: INVALID_NOTE:${caseId}`);
    if (decision.reasons != null && (!Array.isArray(decision.reasons) || decision.reasons.some(reason => typeof reason !== 'string'))) throw new Error(`${label}: INVALID_REASONS:${caseId}`);
  }
  if (review.completed != null && review.completed !== reviewedIds.length) throw new Error(`${label}: COMPLETED_COUNT_MISMATCH`);
  if (requireComplete && reviewedIds.length !== expected.size) throw new Error(`${label}: INCOMPLETE_REVIEW`);
  return { expectedIds: [...expected], reviewedIds, incompleteIds: [...expected].filter(caseId => !review.decisions[caseId]) };
}

function summarize({ phase, blind, review, validation, sourceForChoice }) {
  const counts = { LEGACY: 0, HUGO_V2: 0, BEFORE: 0, AFTER: 0, EQUIVALENT: 0, BOTH_ACCEPTABLE: 0, BOTH_UNACCEPTABLE: 0 };
  const decisions = validation.reviewedIds.map(caseId => {
    const choice = review.decisions[caseId].choice;
    const preferredSource = choice === 'A_BETTER' || choice === 'B_BETTER' ? sourceForChoice(caseId, choice) : choice;
    counts[preferredSource] += 1;
    const note = review.decisions[caseId].note || '';
    return { caseId, choice, preferredSource, noteProvided: note.trim().length > 0, reasonsProvided: (review.decisions[caseId].reasons || []).length > 0 };
  });
  const reviewed = decisions.length;
  return {
    phase,
    evalRunId: blind.evalRunId,
    reviewedAt: review.reviewedAt,
    totalCases: blind.cases.length,
    reviewed,
    skipped: 0,
    incomplete: blind.cases.length - reviewed,
    completionPercent: Number((100 * reviewed / blind.cases.length).toFixed(1)),
    preferenceCounts: counts,
    acceptedWithPreference: counts.LEGACY + counts.HUGO_V2 + counts.BEFORE + counts.AFTER,
    bothAcceptable: counts.BOTH_ACCEPTABLE,
    bothUnacceptable: counts.BOTH_UNACCEPTABLE,
    equivalent: counts.EQUIVALENT,
    correctionsNeeded: counts.BOTH_UNACCEPTABLE,
    notesCaptured: decisions.filter(row => row.noteProvided).length,
    reasonsCaptured: decisions.filter(row => row.reasonsProvided).length,
    reviewerIdentity: 'NOT_CAPTURED_IN_LEGACY_EXPORT',
    incompleteCaseIds: validation.incompleteIds,
    decisions,
  };
}

const phase4Validation = validateExport('PHASE4', phase4Blind, phase4Export, { requireComplete: true });
const phase6Validation = validateExport('PHASE6', phase6Blind, phase6Export);
const phase4Index = new Map(phase4Blind.cases.map((row, index) => [row.caseId, index]));

const phase4 = summarize({
  phase: 'PHASE4', blind: phase4Blind, review: phase4Export, validation: phase4Validation,
  sourceForChoice(caseId, choice) {
    const flip = phase4Index.get(caseId) % 2 === 1;
    const sourceA = flip ? 'HUGO_V2' : 'LEGACY';
    return choice === 'A_BETTER' ? sourceA : sourceA === 'LEGACY' ? 'HUGO_V2' : 'LEGACY';
  },
});
const phase6 = summarize({
  phase: 'PHASE6', blind: phase6Blind, review: phase6Export, validation: phase6Validation,
  sourceForChoice(caseId, choice) {
    const flip = parseInt(hash(caseId).slice(0, 2), 16) % 2 === 1;
    const sourceA = flip ? 'AFTER' : 'BEFORE';
    return choice === 'A_BETTER' ? sourceA : sourceA === 'BEFORE' ? 'AFTER' : 'BEFORE';
  },
});

const totalCases = phase4.totalCases + phase6.totalCases;
const reviewed = phase4.reviewed + phase6.reviewed;
const report = {
  schemaVersion: 'hugo-phase7-human-review-analysis-v1',
  source: 'USER_PROVIDED_LEGACY_EXPORTS',
  validationStatus: 'VALID',
  totalCases,
  reviewed,
  skipped: 0,
  incomplete: totalCases - reviewed,
  completionPercent: Number((100 * reviewed / totalCases).toFixed(1)),
  humanReviewStatus: reviewed === totalCases ? 'COMPLETE' : 'PARTIAL',
  sourceArtifacts: [
    { file: 'human-reviews/phase4-user-export.json', status: 'CURRENT_COMPLETE', sha256: hash(fs.readFileSync(path.join(__dirname, 'human-reviews/phase4-user-export.json'))) },
    { file: 'human-reviews/phase6-user-export-partial.json', status: 'SUPERSEDED_PARTIAL', sha256: hash(fs.readFileSync(path.join(__dirname, 'human-reviews/phase6-user-export-partial.json'))) },
    { file: 'human-reviews/phase6-user-export.json', status: 'CURRENT_COMPLETE', sha256: hash(fs.readFileSync(path.join(__dirname, 'human-reviews/phase6-user-export.json'))) },
  ],
  limitations: [
    'Legacy exports do not capture reviewer identity.',
    'Legacy exports do not capture structured reason codes.',
    'Human preference is evidence for these synthetic pairs and does not by itself establish production generalization.',
  ],
  phases: { PHASE4: phase4, PHASE6: phase6 },
};

fs.writeFileSync(path.join(__dirname, 'phase7-human-review-analysis.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ validationStatus: report.validationStatus, reviewed: report.reviewed, incomplete: report.incomplete,
  phase4: phase4.preferenceCounts, phase6: phase6.preferenceCounts }));
