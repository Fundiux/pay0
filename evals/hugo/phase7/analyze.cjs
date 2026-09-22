const fs = require('node:fs');
const path = require('node:path');
const cases = require('./case-specs.cjs');
const { normalizeProviderError, classifyAppropriateEffect } = require('../../../functions/lib/modules/agent007/hugoCore/evaluationContract');
const main = require('./phase7-real-model-results.json');
const repeats = [require('./phase7-real-model-repeat-a.json'), require('./phase7-real-model-repeat-b.json')];
const median = values => { const rows = values.filter(Number.isFinite).sort((a,b)=>a-b); return rows.length ? rows[Math.floor((rows.length-1)/2)] : null; };
const signal = (text, pattern) => new RegExp(pattern, 'i').test(text || '');
function assess(family) {
  const [before, after, counter] = family.arms;
  const providerError = [before, after, counter].map(arm => normalizeProviderError(arm.modelError)).find(Boolean) || null;
  const beforeAcceptable = signal(before.served, family.requiredPattern) && !signal(before.served, family.forbiddenPattern);
  const afterAcceptable = signal(after.served, family.requiredPattern) && !signal(after.served, family.forbiddenPattern);
  const beforeSignal = signal(before.served, family.requiredPattern), afterSignal = signal(after.served, family.requiredPattern);
  const counterSignal = signal(counter.served, family.requiredPattern), shouldChange = family.expectedEffect === 'CHANGE';
  const counterexampleSafe = shouldChange ? !counterSignal : !signal(counter.served, family.forbiddenPattern);
  const effect = classifyAppropriateEffect({ providerError, shouldChange, beforeAcceptable, afterAcceptable, materiallyChanged: beforeSignal !== afterSignal, counterexampleSafe });
  return { effect, providerError, beforeAcceptable, afterAcceptable, counterexampleSafe, beforeSignal, afterSignal, counterSignal,
    retrieved: after.learningUsage?.includedIds?.length || 0, referenced: after.learningUsage?.referencedByModel?.length || 0,
    includedIds: after.learningUsage?.includedIds || [], retrievalConflict: after.learningUsage?.conflict === true,
    rawAfterAcceptable: signal(after.rawModel, family.requiredPattern) && !signal(after.rawModel, family.forbiddenPattern),
    servedAfterAcceptable: afterAcceptable, fullFlowOutcome: after.fullFlowOutcome };
}
const rows = main.families.map(family => {
  const base = assess(family), repeated = [family, ...repeats.flatMap(run => run.families.filter(row => row.id === family.id))].map(assess);
  const repeatStatus = repeated.length < 3 ? 'NOT_REPEATED' : repeated.some(row => row.providerError) ? 'PROVIDER_ERROR' :
    repeated.every(row => ['APPROPRIATE_CHANGE','APPROPRIATE_STABILITY'].includes(row.effect)) ? 'STABLE_APPROPRIATE' :
    repeated.every(row => ['MISSED_BENEFICIAL_CHANGE','INAPPROPRIATE_CHANGE'].includes(row.effect)) ? 'STABLE_WRONG' : 'UNSTABLE';
  return { caseId: family.id, domain: family.domain, split: family.split, taskClass: family.taskClass, caseType: family.caseType,
    expectedEffect: family.expectedEffect, actionability: family.actionability, classification: base.effect, ...base, runCount: repeated.length, repeatStatus };
});
const allArms = [main, ...repeats].flatMap(run => run.families.flatMap(family => family.arms));
const trueProviderErrors = allArms.map(arm => normalizeProviderError(arm.modelError)).filter(Boolean);
const effectLabels = ['APPROPRIATE_CHANGE','APPROPRIATE_STABILITY','INAPPROPRIATE_CHANGE','MISSED_BENEFICIAL_CHANGE','INCONCLUSIVE','PROVIDER_ERROR'];
const taskLabels = ['MODEL_NOT_REQUIRED','GENERATION_ONLY','STRUCTURED_REASONING','OPEN_REASONING','HUMAN_REQUIRED'];
const domainRows = [...new Set(cases.map(row => row.domain))].map(domain => { const selected = rows.filter(row => row.domain === domain); return { domain, cases: selected.length,
  appropriateEffects: selected.filter(row => row.classification.startsWith('APPROPRIATE_')).length,
  missedBeneficialEffects: selected.filter(row => row.classification === 'MISSED_BENEFICIAL_CHANGE').length,
  negativeTransfer: selected.filter(row => row.classification === 'INAPPROPRIATE_CHANGE').length,
  providerErrors: selected.filter(row => row.classification === 'PROVIDER_ERROR').length, humanReviewStatus: 'AWAITING_HUMAN_REVIEW' }; });
const expectedRelevant = rows.filter(row => !['EXPERIENCE_SHOULD_BE_IGNORED','MULTIPLE_EXPERIENCES_CONFLICT','DETERMINISTIC_FACT'].includes(row.caseType));
const report = { schemaVersion: 'hugo-phase7-analysis-v1', syntheticOnly: true, preregisteredDatasetDigest: main.preregisteredDatasetDigest,
  familyCount: rows.length, humanReviewStatus: 'AWAITING_HUMAN_REVIEW', humanReviewsCompleted: 0,
  classifications: Object.fromEntries(effectLabels.map(label => [label, rows.filter(row => row.classification === label).length])),
  taskDistribution: Object.fromEntries(taskLabels.map(label => [label, { count: rows.filter(row => row.taskClass === label).length, percent: Number((100 * rows.filter(row => row.taskClass === label).length / rows.length).toFixed(1)) }])),
  retrieval: { expectedRelevant: expectedRelevant.length, retrieved: expectedRelevant.filter(row => row.retrieved > 0).length,
    included: expectedRelevant.filter(row => row.includedIds.length > 0).length, referencedByExplicitId: rows.filter(row => row.referenced > 0).length,
    behaviorallyUsed: rows.filter(row => row.classification === 'APPROPRIATE_CHANGE').length },
  repeats: { cases: rows.filter(row => row.runCount === 3).length, stableAppropriate: rows.filter(row => row.repeatStatus === 'STABLE_APPROPRIATE').length,
    unstable: rows.filter(row => row.repeatStatus === 'UNSTABLE').length, stableWrong: rows.filter(row => row.repeatStatus === 'STABLE_WRONG').length,
    providerError: rows.filter(row => row.repeatStatus === 'PROVIDER_ERROR').length },
  fullFlow: { modelWrongSystemSafe: rows.filter(row => !row.rawAfterAcceptable && row.servedAfterAcceptable).length,
    modelRightSystemRight: rows.filter(row => row.rawAfterAcceptable && row.servedAfterAcceptable).length,
    modelWrongSystemWrong: rows.filter(row => !row.rawAfterAcceptable && !row.servedAfterAcceptable && !row.providerError).length,
    providerFailureGracefulDegradation: allArms.filter(arm => normalizeProviderError(arm.modelError) && arm.source !== 'MODEL_RESPONSE').length },
  providerErrors: Object.fromEntries(['RATE_LIMIT','TIMEOUT','MAX_TOKENS','INVALID_RESPONSE','SERVICE_UNAVAILABLE','AUTH_ERROR','CONTENT_FILTER','UNKNOWN_PROVIDER_ERROR'].map(label => [label, trueProviderErrors.filter(x => x === label).length])),
  tokenAndLatency: { completedGenerativeArms: allArms.filter(arm => arm.rawModel && !normalizeProviderError(arm.modelError)).length,
    medianInputTokens: median(allArms.map(arm => arm.tokenUsage?.input)), medianVisibleOutputTokens: median(allArms.map(arm => arm.tokenUsage?.output)),
    medianReasoningTokens: median(allArms.map(arm => arm.tokenUsage?.reasoning)), medianFullFlowLatencyMs: median(allArms.map(arm => arm.elapsedMs)),
    maxTokensIncidence: trueProviderErrors.filter(x => x === 'MAX_TOKENS').length },
  domains: domainRows, rows };
fs.writeFileSync(path.join(__dirname, 'phase7-analysis.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'phase7-dashboard.json'), JSON.stringify({ schemaVersion: report.schemaVersion, familyCount: report.familyCount,
  classifications: report.classifications, taskDistribution: report.taskDistribution, retrieval: report.retrieval, repeats: report.repeats,
  tokenAndLatency: report.tokenAndLatency, domains: report.domains, humanReviewStatus: report.humanReviewStatus }, null, 2) + '\n');
console.log(JSON.stringify({ classifications: report.classifications, repeats: report.repeats, retrieval: report.retrieval, providerErrors: report.providerErrors }));
