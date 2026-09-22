// Full Hugo flow with synthetic tools and the production Gemini adapter. No production data or writes.
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) throw Error('REAL_MODEL_RUN_REQUIRES_NON_EMULATOR_PROCESS');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const admin = require('../../../functions/node_modules/firebase-admin');
const { HugoConversationCore } = require('../../../functions/lib/modules/agent007/hugoCore/conversationCore');
const { HugoToolRouter } = require('../../../functions/lib/modules/agent007/hugoCore/toolRouter');
const { emptyConversationState } = require('../../../functions/lib/modules/agent007/hugoCore/conversationState');
const { buildVerifiedExperience, withCorrection } = require('../../../functions/lib/modules/agent007/hugoCore/experienceBuilder');
const { selectLearningExperiences } = require('../../../functions/lib/modules/agent007/hugoCore/learningStore');
const { normalizeProviderError, shouldRetryProviderError } = require('../../../functions/lib/modules/agent007/hugoCore/evaluationContract');
const { VertexGeminiAdapter } = require('../../../functions/lib/modules/agent007/vertexGeminiAdapter');
const cases = require('./case-specs.cjs');
const rootId = 'phase7-synthetic-root', identity = { uid: 'phase7-reviewer', rootId, role: 'superadmin' };
const at = minute => new Date(Date.UTC(2026, 8, 22, 18, minute)).toISOString();
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

class EvalRetryAdapter {
  constructor(inner) { this.inner = inner; }
  async generate(input) {
    const calls = [], started = performance.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.inner.generate(input); calls.push({ attempt: attempt + 1, error: result.error || null, attempts: result.attempts || [] });
      if (!shouldRetryProviderError(result.error, attempt, 2)) return { ...result, evalRetry: { calls, totalElapsedMs: Math.round(performance.now() - started) } };
      await wait(1000 * (attempt + 1));
    }
  }
}
function makeExperience(spec, suffix = '', behavior = spec.expectedBehavior, overrides = {}) {
  const id = `${spec.id}${suffix}`, entityId = `prior_${id}`, storageDomain = spec.entityType === 'SOLICITUD' ? 'SOLICITUDES' : 'PAGOS';
  const source = { rootId: overrides.rootId || rootId, experienceId: `p7_learning_${id}`, domain: storageDomain, taskType: 'REASON', intent: 'EXPLAIN_DELAY', questionClass: 'OPERATIONAL_CAUSE',
    memory: { id: `memory_${id}`, rootId: overrides.rootId || rootId, status: 'CONFIRMED', kind: 'EXPERIENCE', entityReference: { sourceSystem: 'PAY0', entityType: spec.entityType, entityId }, links: { observationId: `observation_${id}`, decisionId: `decision_${id}`, outcomeId: `outcome_${id}` }, createdAt: at(3 + (overrides.minute || 0)) },
    observation: { id: `observation_${id}`, rootId: overrides.rootId || rootId, caseId: entityId, source: 'ACTIVITY_LOG', createdAt: at(0 + (overrides.minute || 0)) },
    decision: { id: `decision_${id}`, rootId: overrides.rootId || rootId, kind: 'DECISION', status: 'CONFIRMED', entityId, actorUid: identity.uid, decisionType: 'APPROVED', decidedAt: at(1 + (overrides.minute || 0)) },
    outcome: { id: `outcome_${id}`, rootId: overrides.rootId || rootId, caseId: entityId, source: 'ACTIVITY_LOG', sourceEvent: spec.entityType === 'SOLICITUD' ? 'SOLICITUD_COMPLETADA' : 'PAGO_APLICADO_A_SOLICITUD', occurredAt: at(2 + (overrides.minute || 0)) },
    features: { entityType: spec.entityType, status: spec.status, issueCode: spec.issueCode }, now: at(4 + (overrides.minute || 0)) };
  const verified = buildVerifiedExperience(source);
  return withCorrection(verified, { originalBehavior: 'COPY_PRIOR_ACTION', correctedBehavior: behavior, reasonCode: 'OUTCOME_SUPPORTED_CORRECTION', actorUid: identity.uid,
    correctedAt: at(4 + (overrides.minute || 0)), scope: 'ENTITY_TYPE', evidenceReferences: [{ system: 'PAY0', kind: 'OUTCOME', id: source.outcome.id, rootId: source.rootId }] }, behavior);
}
function availableExperiences(spec) {
  const primary = makeExperience(spec), type = spec.caseType;
  if (type === 'MULTIPLE_EXPERIENCES_AGREE' || type === 'DUPLICATE_EXPERIENCE') return [primary, makeExperience(spec, '_second', spec.expectedBehavior, { minute: 8 })];
  if (type === 'MULTIPLE_EXPERIENCES_CONFLICT') return [primary, makeExperience(spec, '_conflict', 'PROCEED_WITHOUT_REVIEW', { minute: 8 })];
  if (type === 'EXPERIENCE_SHOULD_BE_IGNORED') return [makeExperience(spec, '_foreign', spec.expectedBehavior, { rootId: 'another-synthetic-root' })];
  if (type === 'SUPERSEDED_EXPERIENCE') {
    const old = makeExperience(spec, '_old', 'USE_ORIGINAL_DOCUMENT_CHECK'); old.state = 'SUPERSEDED'; old.supersededById = `p7_learning_${spec.id}_replacement`;
    const replacement = makeExperience(spec, '_replacement', spec.expectedBehavior, { minute: 8 }); replacement.supersedesId = old.experienceId;
    return [old, replacement];
  }
  return [primary];
}
const tool = (name, data, completeness, evidence = []) => ({ sourceSystem: 'PAY0', tool: name, scope: { rootId }, retrievedAt: at(20), completeness, evidence, data, trace: { latencyMs: 0, result: 'OK' } });
function makeRouter(spec, arm) {
  const issueCode = arm === 'COUNTEREXAMPLE' ? spec.counterIssueCode : spec.issueCode, folio = `${spec.entityType === 'SOLICITUD' ? 'S' : 'P'}7${String(cases.indexOf(spec) + 1).padStart(4, '0')}`;
  const fact = { id: `current_${spec.id}`, folio, estado: spec.status, monto: 120, issueCode };
  const evidence = [{ entityType: spec.entityType, entityId: fact.id, kind: 'FACT', sourceSystem: 'PAY0', completeness: 'COMPLETE' }];
  return { folio, router: new HugoToolRouter(identity, {
    getSolicitud: async () => tool('getSolicitud', spec.entityType === 'SOLICITUD' ? fact : null, spec.entityType === 'SOLICITUD' ? 'COMPLETE' : 'UNKNOWN', spec.entityType === 'SOLICITUD' ? evidence : []),
    getPago: async () => tool('getPago', spec.entityType === 'PAGO' ? fact : null, spec.entityType === 'PAGO' ? 'COMPLETE' : 'UNKNOWN', spec.entityType === 'PAGO' ? evidence : []),
    getPaymentComplementStatus: async () => tool('getPaymentComplementStatus', spec.domain === 'PAYMENT_COMPLEMENTS' ? [{ paymentId: fact.id, status: issueCode }] : [], spec.domain === 'PAYMENT_COMPLEMENTS' ? 'COMPLETE' : 'PARTIAL'),
    getIqCapabilities: async () => tool('getIqCapabilities', spec.domain === 'IQ' ? { available: issueCode !== 'IQ_CAPABILITY_UNAVAILABLE', issueCode } : {}, spec.domain === 'IQ' ? 'COMPLETE' : 'UNKNOWN'),
  }) };
}
const dataStore = { loadConversationState: async () => ({ history: [], memory: { recommendations: [], rules: [] }, recentEntities: [], conversationState: emptyConversationState(rootId) }), retrieveMemory: async () => ({ considered: 0, selected: [], legacyObservationsConsidered: 0, legacyObservations: [] }) };
async function runArm(spec, arm, model) {
  const { folio, router } = makeRouter(spec, arm), candidates = arm === 'BEFORE' ? [] : availableExperiences(spec);
  const learningStore = { retrieve: async query => selectLearningExperiences(candidates, query) };
  const exactQuestion = spec.taskClass === 'MODEL_NOT_REQUIRED' ? spec.question : `Por que ${folio} esta en ${spec.status.toLowerCase()}? ${spec.question}`;
  const started = performance.now(), output = await new HugoConversationCore(router, model, dataStore, learningStore).respond({ channel: 'EVAL', conversationId: `${rootId}_${spec.id}`, identity, name: 'Evaluador', message: exactQuestion.includes(folio) ? exactQuestion : `${exactQuestion} Folio ${folio}.`, promptVersion: 'hugo-v2' });
  return { arm, elapsedMs: Math.round(performance.now() - started), currentEvidenceDigest: hash({ folio, status: spec.status, issueCode: arm === 'COUNTEREXAMPLE' ? spec.counterIssueCode : spec.issueCode }),
    rawModel: output.model.text, served: output.text, source: output.source, responsePolicy: output.responsePolicy || null, modelError: output.model.error || null,
    canonicalProviderError: normalizeProviderError(output.model.error), tokenUsage: output.model.tokenUsage, attempts: output.model.attempts || [], evalRetry: output.model.evalRetry || null,
    learningUsage: output.learningUsage || null, budget: output.budget, context: { currentFacts: { solicitudes: output.context.solicitudes, pagos: output.context.pagos }, learningExperiences: output.context.learningExperiences || [], boundaries: output.context.evidenceBoundaries },
    fullFlowOutcome: output.model.error ? (output.source === 'MODEL_RESPONSE' ? 'PROVIDER_FAILURE_UNSAFE' : 'PROVIDER_FAILURE_GRACEFUL_DEGRADATION') : output.source === 'MODEL_RESPONSE' ? 'MODEL_AND_SYSTEM_COMPLETED' : 'SYSTEM_POLICY_OR_DETERMINISTIC' };
}
async function main() {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'pay-0-system' });
  await admin.app().options.credential.getAccessToken();
  const model = new EvalRetryAdapter(new VertexGeminiAdapter());
  const from = Math.max(0, Number(process.argv.find(x => x.startsWith('--from='))?.split('=')[1] || 0));
  const limit = Math.min(Number(process.argv.find(x => x.startsWith('--limit='))?.split('=')[1] || cases.length), cases.length - from);
  const split = process.argv.find(x => x.startsWith('--split='))?.split('=')[1];
  const suffix = process.argv.find(x => x.startsWith('--output='))?.split('=')[1] || 'results';
  if (!/^[a-z0-9-]{1,50}$/.test(suffix)) throw Error('INVALID_OUTPUT_SUFFIX');
  const out = path.join(__dirname, `phase7-real-model-${suffix}.json`), result = { schemaVersion: 'hugo-phase7-real-model-v1', syntheticOnly: true, preregisteredDatasetDigest: require('./phase7-tournament-dataset-v1.manifest.json').datasetDigest,
    model: 'gemini-2.5-flash', config: { temperature: 0.35, maxOutputTokens: 1200, reasoningIntent: 'STANDARD_REASONING', retryPolicy: '2 retries, 1s/2s, retryable provider errors only' }, executedAt: new Date().toISOString(), families: [] };
  const selected = split ? cases.filter(row => row.split === split) : cases.slice(from, from + limit);
  for (const spec of selected) {
    const arms = [];
    for (const arm of ['BEFORE', 'AFTER', 'COUNTEREXAMPLE']) { arms.push(await runArm(spec, arm, model)); process.stdout.write(`${spec.id} ${arm}: ${arms.at(-1).canonicalProviderError || 'COMPLETE'}\n`); }
    result.families.push({ ...spec, arms }); fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  }
}
main().catch(error => { console.error(`PHASE7_REAL_MODEL_BLOCKED:${error?.code || error?.message || 'unknown'}`); process.exitCode = 1; });
