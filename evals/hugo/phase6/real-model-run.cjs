// Real Gemini + real Hugo Core/context/router with synthetic read-only tools and experiences.
// No production Firestore, IQ action, training upload, or deployment.
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
const { VertexGeminiAdapter } = require('../../../functions/lib/modules/agent007/vertexGeminiAdapter');
const cases = require('./cases.cjs');
const rootId = 'phase6-synthetic-root', identity = { uid: 'synthetic-reviewer', rootId, role: 'superadmin' };
const at = minute => new Date(Date.UTC(2026, 8, 22, 12, minute)).toISOString();
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function experience(family) {
  const id = family.id, entityId = `prior_${id}`, isSolicitud = family.entityType === 'SOLICITUD';
  const source = { rootId, experienceId: `learning_${id}`, domain: isSolicitud ? 'SOLICITUDES' : 'PAGOS', taskType: 'REASON', intent: 'EXPLAIN_DELAY', questionClass: 'OPERATIONAL_CAUSE',
    memory: { id: `memory_${id}`, rootId, status: 'CONFIRMED', kind: 'EXPERIENCE', entityReference: { sourceSystem: 'PAY0', entityType: family.entityType, entityId },
      links: { observationId: `observation_${id}`, decisionId: `decision_${id}`, outcomeId: `outcome_${id}` }, createdAt: at(3) },
    observation: { id: `observation_${id}`, rootId, caseId: entityId, source: 'ACTIVITY_LOG', createdAt: at(0) },
    decision: { id: `decision_${id}`, rootId, kind: 'DECISION', status: 'CONFIRMED', entityId, actorUid: identity.uid, decisionType: 'APPROVED', decidedAt: at(1) },
    outcome: { id: `outcome_${id}`, rootId, caseId: entityId, source: 'ACTIVITY_LOG', sourceEvent: isSolicitud ? 'SOLICITUD_COMPLETADA' : 'PAGO_APLICADO_A_SOLICITUD', occurredAt: at(2) },
    features: { entityType: family.entityType, status: family.status, issueCode: family.issueCode }, now: at(3) };
  const verified = buildVerifiedExperience(source);
  return withCorrection(verified, { originalBehavior: 'COPY_PRIOR_ACTION', correctedBehavior: family.expectedBehavior, reasonCode: 'OUTCOME_SUPPORTED_CORRECTION',
    actorUid: identity.uid, correctedAt: at(4), scope: 'ENTITY_TYPE', evidenceReferences: [{ system: 'PAY0', kind: 'OUTCOME', id: source.outcome.id, rootId }] }, family.expectedBehavior);
}
function tool(name, data, completeness, evidence = []) { return { sourceSystem: 'PAY0', tool: name, scope: { rootId }, retrievedAt: at(6), completeness, evidence,
  data, trace: { latencyMs: 0, result: 'OK' } }; }
function makeRouter(family, counterexample) {
  const issueCode = counterexample ? 'UNRELATED_HOLD' : family.issueCode;
  const fact = { id: `current_${family.id}`, folio: family.folio, estado: family.status, monto: 120, issueCode };
  const item = family.entityType === 'SOLICITUD' ? 'getSolicitud' : 'getPago';
  const evidence = [{ entityType: family.entityType, entityId: fact.id, kind: 'FACT', sourceSystem: 'PAY0', completeness: 'COMPLETE' }];
  return new HugoToolRouter(identity, {
    getSolicitud: async () => tool('getSolicitud', item === 'getSolicitud' ? fact : null, item === 'getSolicitud' ? 'COMPLETE' : 'UNKNOWN', item === 'getSolicitud' ? evidence : []),
    getPago: async () => tool('getPago', item === 'getPago' ? fact : null, item === 'getPago' ? 'COMPLETE' : 'UNKNOWN', item === 'getPago' ? evidence : []),
    getPaymentComplementStatus: async () => tool('getPaymentComplementStatus', [], 'PARTIAL'),
    getIqCapabilities: async () => tool('getIqCapabilities', {}, 'UNKNOWN'),
  });
}
const dataStore = { loadConversationState: async () => ({ history: [], memory: { recommendations: [], rules: [] }, recentEntities: [], conversationState: emptyConversationState(rootId) }),
  retrieveMemory: async () => ({ considered: 0, selected: [], legacyObservationsConsidered: 0, legacyObservations: [] }) };
async function runArm(family, arm, adapter, prior) {
  const counterexample = arm === 'COUNTEREXAMPLE', available = arm === 'BEFORE' ? [] : [prior], router = makeRouter(family, counterexample);
  const learningStore = { retrieve: async query => selectLearningExperiences(available, query) };
  const input = { channel: 'EVAL', conversationId: `${rootId}_${identity.uid}`, identity, name: 'Evaluador',
    message: `¿Por qué ${family.folio} está en ${family.status.toLowerCase()}? Indica qué comprobarías antes de actuar.`, promptVersion: 'hugo-v2' };
  const started = performance.now(), output = await new HugoConversationCore(router, adapter, dataStore, learningStore).respond(input);
  return { arm, elapsedMs: Math.round(performance.now() - started), currentEvidenceDigest: hash({ fact: { folio: family.folio, status: family.status, issueCode: counterexample ? 'UNRELATED_HOLD' : family.issueCode } }),
    model: output.model.model, provider: output.model.provider || null, promptVersion: output.promptVersion, modelError: output.model.error || null,
    modelRaw: output.model.text, systemServed: output.text, systemSource: output.source, responsePolicy: output.responsePolicy || null,
    tokenUsage: output.model.tokenUsage, attempts: output.model.attempts || [], budget: output.budget,
    learningUsage: output.learningUsage || null, contextExperienceIds: (output.context.learningExperiences || []).map(row => row.id),
    tools: output.toolsExecuted.map(row => ({ tool: row.tool, completeness: row.completeness, result: row.trace.result })),
    contextSnapshot: { currentFacts: { solicitudes: output.context.solicitudes, pagos: output.context.pagos }, learningExperiences: output.context.learningExperiences || [],
      memoryCount: output.context.memoriasHistoricas?.length || 0, boundaries: output.context.evidenceBoundaries } };
}
async function main() {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'pay-0-system' });
  await admin.app().options.credential.getAccessToken();
  const adapter = new VertexGeminiAdapter(), from = Math.min(Math.max(Number(process.argv.find(arg => arg.startsWith('--from='))?.split('=')[1] || 0), 0), cases.length - 1);
  const limit = Math.min(Math.max(Number(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1] || cases.length), 1), cases.length - from);
  const suffix = process.argv.find(arg => arg.startsWith('--output='))?.split('=')[1];
  if (suffix && !/^[a-z0-9-]{1,50}$/.test(suffix)) throw Error('INVALID_OUTPUT_SUFFIX');
  const outputPath = path.join(__dirname, suffix ? `phase6-real-model-${suffix}.json` : 'phase6-real-model-results.json');
  const result = { schemaVersion: 'hugo-phase6-real-model-v1', syntheticOnly: true, model: 'gemini-2.5-flash', promptVersion: 'hugo-v2',
    config: { temperature: 0.35, maxOutputTokens: 1200, adapterRetry: 'compact-on-MAX_TOKENS' }, executedAt: new Date().toISOString(), families: [] };
  for (const family of cases.slice(from, from + limit)) {
    const prior = experience(family), arms = [];
    for (const arm of ['BEFORE', 'AFTER', 'COUNTEREXAMPLE']) {
      arms.push(await runArm(family, arm, adapter, prior));
      process.stdout.write(`${family.id} ${arm}: ${arms.at(-1).modelError || 'COMPLETE'}\n`);
    }
    result.families.push({ ...family, priorExperienceId: prior.experienceId, experienceQuality: prior.quality,
      expectedRetrieval: { BEFORE: [], AFTER: [prior.experienceId], COUNTEREXAMPLE: [] }, arms });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
  }
}
main().catch(error => { console.error(`PHASE6_REAL_MODEL_BLOCKED: ${error?.code || error?.message || 'unknown'}`); process.exitCode = 1; });
