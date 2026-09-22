const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cases = require('./cases.cjs');
const load = name => JSON.parse(fs.readFileSync(path.join(__dirname, `phase6-real-model-${name}.json`), 'utf8'));
const original = load('results'), retry = load('retry'), retry2 = load('retry2'), checkpoints = load('checkpoints');
const repeats = [load('repeat-a'), load('repeat-b')];
const chosen = [...original.families.slice(0, 5), ...retry.families, ...retry2.families, ...checkpoints.families];
const hash = x => crypto.createHash('sha256').update(String(x)).digest('hex');
const median = values => { const list = values.slice().sort((a, b) => a - b); return list.length ? list[Math.floor((list.length - 1) / 2)] : null; };
const familyRows = [];
for (const family of chosen) {
  const spec = cases.find(x => x.id === family.id);
  if (!spec) throw Error('UNKNOWN_CASE');
  const samples = [family, ...repeats.flatMap(run => run.families.filter(row => row.id === family.id))];
  const pattern = new RegExp(spec.behaviorPattern, 'i');
  const observations = samples.map(sample => {
    const [before, after, counterexample] = sample.arms;
    const sameEvidence = before.currentEvidenceDigest === after.currentEvidenceDigest;
    const sameModelConfig = before.model === after.model && before.provider === after.provider && before.promptVersion === after.promptVersion &&
      before.attempts?.[0]?.outputLimit === after.attempts?.[0]?.outputLimit;
    const retrieved = after.learningUsage?.includedIds?.includes(sample.priorExperienceId) === true;
    const counterExcluded = counterexample.learningUsage?.includedIds?.length === 0;
    const complete = sample.arms.every(arm => arm.modelRaw && !arm.modelError);
    const beforeSignal = pattern.test(before.systemServed), afterSignal = pattern.test(after.systemServed), counterSignal = pattern.test(counterexample.systemServed);
    return { sameEvidence, sameModelConfig, retrieved, counterExcluded, complete, beforeSignal, afterSignal, counterSignal,
      modelErrors: sample.arms.map(arm => arm.modelError).filter(Boolean),
      experienceReferencedById: after.modelRaw?.includes(sample.priorExperienceId) || false,
      experienceReferencedInWords: /experiencia|correcci[oó]n anterior|aprendi/i.test(after.modelRaw || ''),
      before: before.systemServed, after: after.systemServed, counterexample: counterexample.systemServed };
  });
  const valid = observations.filter(row => row.complete && row.sameEvidence && row.sameModelConfig && row.retrieved && row.counterExcluded);
  const positiveSignals = valid.filter(row => !row.beforeSignal && row.afterSignal && !row.counterSignal).length;
  const noEffectSignals = valid.filter(row => row.beforeSignal && row.afterSignal).length;
  const negativeSignals = valid.filter(row => row.beforeSignal && !row.afterSignal).length;
  let classification = 'INCONCLUSIVE';
  if (observations[0].modelErrors.some(x => x === 'MAX_TOKENS')) classification = 'TOKEN_LIMIT_ERROR';
  else if (observations[0].modelErrors.length) classification = 'MODEL_ERROR';
  else if (!observations[0].retrieved || !observations[0].counterExcluded) classification = 'RETRIEVAL_ERROR';
  else if (!observations[0].sameEvidence || !observations[0].sameModelConfig) classification = 'CONTEXT_ERROR';
  else if (valid.length >= 3 && positiveSignals === valid.length) classification = 'POSITIVE_LEARNING_EFFECT';
  else if (valid.length >= 3 && noEffectSignals === valid.length) classification = 'NO_EFFECT';
  else if (valid.length >= 3 && negativeSignals === valid.length) classification = 'NEGATIVE_LEARNING_EFFECT';
  else if (valid.length === 1 && noEffectSignals === 1) classification = 'NO_EFFECT';
  familyRows.push({ caseId: family.id, domain: family.entityType === 'PAGO' ? 'PAGOS' : 'SOLICITUDES', category: family.category,
    expectedBehavior: family.expectedBehavior, expectedExperienceId: family.priorExperienceId, classification, humanReview: 'PENDING',
    runCount: samples.length, validRunCount: valid.length, positiveSignals, noEffectSignals, negativeSignals,
    retrievalCorrect: observations.every(row => row.retrieved && row.counterExcluded), currentFactsConstant: observations.every(row => row.sameEvidence),
    modelConfigConstant: observations.every(row => row.sameModelConfig),
    experienceReferencedById: observations.some(row => row.experienceReferencedById), experienceReferencedInWords: observations.some(row => row.experienceReferencedInWords),
    observations });
}
const arms = chosen.flatMap(row => row.arms), completed = arms.filter(arm => arm.modelRaw && !arm.modelError);
const classifications = Object.fromEntries(['POSITIVE_LEARNING_EFFECT', 'NO_EFFECT', 'NEGATIVE_LEARNING_EFFECT', 'OVERGENERALIZATION', 'INCONCLUSIVE', 'MODEL_ERROR', 'CONTEXT_ERROR', 'RETRIEVAL_ERROR', 'TOKEN_LIMIT_ERROR'].map(x => [x, familyRows.filter(row => row.classification === x).length]));
const report = { schemaVersion: 'hugo-phase6-analysis-v1', syntheticOnly: true, model: 'gemini-2.5-flash', familyCount: familyRows.length,
  modelCompletedArms: completed.length, selectedRunSource: { original: 5, retry: 1, retry2: 2, checkpoints: 2 },
  originalProviderFailureArms: original.families.slice(5).flatMap(row => row.arms).filter(arm => arm.modelError).length,
  classifications, retrieval: { expectedRelevantIncluded: familyRows.filter(row => row.observations[0].retrieved).length,
    expectedCounterexamplesExcluded: familyRows.filter(row => row.observations[0].counterExcluded).length,
    familyDenominator: familyRows.length },
  tokenAndLatency: { completedArms: completed.length, medianInputTokens: median(completed.map(arm => arm.tokenUsage?.input).filter(Number.isFinite)),
    medianOutputTokens: median(completed.map(arm => arm.tokenUsage?.output).filter(Number.isFinite)),
    medianReasoningTokens: median(completed.map(arm => arm.tokenUsage?.reasoning).filter(Number.isFinite)),
    medianElapsedMs: median(completed.map(arm => arm.elapsedMs).filter(Number.isFinite)),
    maxContextChars: Math.max(...completed.map(arm => arm.budget?.totalChars || 0)),
    estimatedProviderCost: null, costReason: 'No versioned provider price contract' },
  humanReviewsCompleted: 0, interpretiveLimit: 'Expected behavior codes preceded the calls; lexical scoring patterns were formalized after response inspection. Positive classification is exploratory. Human semantic preference and production generalization remain unevaluated.', families: familyRows };
fs.writeFileSync(path.join(__dirname, 'phase6-analysis.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'phase6-dashboard.json'), JSON.stringify({ schemaVersion: report.schemaVersion, syntheticOnly: true,
  familyCount: report.familyCount, classifications: report.classifications, retrieval: report.retrieval, tokenAndLatency: report.tokenAndLatency,
  humanReviewsCompleted: 0, families: familyRows.map(row => ({ caseId: row.caseId, domain: row.domain, classification: row.classification,
    runCount: row.runCount, retrieved: row.retrievalCorrect, referenced: row.experienceReferencedById || row.experienceReferencedInWords })) }, null, 2) + '\n');
const blind = { schemaVersion: 'hugo-phase6-blind-v1', evalRunId: 'phase6-synthetic-gemini-v1', humanReviewStatus: 'PENDING', cases: chosen.map(family => {
  const flip = parseInt(hash(family.id).slice(0, 2), 16) % 2 === 1;
  const [before, after] = family.arms;
  return { caseId: family.id, category: family.category, userInput: `¿Por qué ${family.folio} está en ${family.status.toLowerCase()}? Indica qué comprobarías antes de actuar.`,
    controlledEvidence: { folio: family.folio, status: family.status, issueCode: family.issueCode },
    responseA: flip ? after.systemServed : before.systemServed, responseB: flip ? before.systemServed : after.systemServed };
}) };
fs.writeFileSync(path.join(__dirname, 'phase6-blind-review.json'), JSON.stringify(blind, null, 2) + '\n');
console.log(JSON.stringify({ families: report.familyCount, classifications, completedArms: report.modelCompletedArms, retrieval: report.retrieval }));
