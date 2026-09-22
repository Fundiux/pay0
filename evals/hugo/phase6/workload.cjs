// Deliberately selected synthetic Phase 6 workload, not a production traffic estimate.
const fs = require('node:fs');
const path = require('node:path');
const { HugoConversationCore } = require('../../../functions/lib/modules/agent007/hugoCore/conversationCore');
const { HugoToolRouter } = require('../../../functions/lib/modules/agent007/hugoCore/toolRouter');
const { emptyConversationState, advanceConversationState, resolveConversationReference } = require('../../../functions/lib/modules/agent007/hugoCore/conversationState');
const families = require('./cases.cjs');
const rootId = 'phase6-synthetic-root', identity = { uid: 'reviewer', rootId, role: 'superadmin' };
function router(family) {
  const fact = { id: 'current', folio: family?.folio || 'S61001', estado: family?.status || 'PENDIENTE', monto: 120, issueCode: family?.issueCode || 'DOCUMENT_MISSING' };
  const result = (name, data, completeness) => ({ sourceSystem: 'PAY0', tool: name, scope: { rootId }, retrievedAt: '2026-09-22T12:00:00.000Z', completeness, evidence: [], data, trace: { latencyMs: 0, result: 'OK' } });
  return new HugoToolRouter(identity, {
    getSolicitud: async () => result('getSolicitud', fact.folio.startsWith('S') ? fact : null, fact.folio.startsWith('S') ? 'COMPLETE' : 'UNKNOWN'),
    getPago: async () => result('getPago', fact.folio.startsWith('P') ? fact : null, fact.folio.startsWith('P') ? 'COMPLETE' : 'UNKNOWN'),
    searchSolicitudes: async () => result('searchSolicitudes', [], 'PARTIAL'), searchPagos: async () => result('searchPagos', [], 'PARTIAL'),
    getPaymentComplementStatus: async () => result('getPaymentComplementStatus', [], 'PARTIAL'), getIqCapabilities: async () => result('getIqCapabilities', {}, 'UNKNOWN'),
  });
}
function data(state) { return { loadConversationState: async () => ({ history: [], memory: { recommendations: [], rules: [] }, recentEntities: [], conversationState: state || emptyConversationState(rootId) }),
  retrieveMemory: async () => ({ considered: 0, selected: [], legacyObservationsConsidered: 0, legacyObservations: [] }) }; }
const input = message => ({ channel: 'EVAL', conversationId: `${rootId}_reviewer`, identity, name: 'Prueba', message, promptVersion: 'hugo-v2' });
async function main() {
  const tasks = [];
  for (const family of families) {
    const output = await new HugoConversationCore(router(family), null, data()).respond(input(`¿Por qué ${family.folio} está en ${family.status.toLowerCase()}?`));
    tasks.push({ caseId: family.id, category: 'EXPLANATION', observed: output.responsePolicy || output.model.error,
      safelyResolvedWithoutModel: output.source === 'POLICY_RESPONSE' && output.responsePolicy !== 'LEARNING_RETRIEVAL_UNAVAILABLE', modelNeededByCurrentCore: output.model.error === 'MODEL_UNAVAILABLE' });
  }
  for (const [caseId, message] of [['partial-total', '¿Cuántas solicitudes hay en total?'], ['exact-status', '¿Cuál es el estado de S61001?'], ['exact-amount', '¿Cuánto es el monto de S61001?']]) {
    const output = await new HugoConversationCore(router(), null, data()).respond(input(message));
    tasks.push({ caseId, category: 'DETERMINISTIC', observed: output.responsePolicy, safelyResolvedWithoutModel: output.source === 'POLICY_RESPONSE', modelNeededByCurrentCore: false });
  }
  const now = Date.now(), entity = folio => ({ system: 'PAY0', entityType: 'SOLICITUD', entityId: folio.toLowerCase(), folio, rootId, resolvedAt: now, resolvedTurn: 1, source: 'PAY0_EXACT_TOOL', confidence: 1 });
  const state = advanceConversationState(resolveConversationReference('S61001', emptyConversationState(rootId), rootId, now), [entity('S61001'), entity('S61002')], rootId);
  const ambiguous = await new HugoConversationCore(router(), null, data(state)).respond(input('¿Y el otro?'));
  tasks.push({ caseId: 'ambiguous-reference', category: 'DETERMINISTIC', observed: ambiguous.responsePolicy,
    safelyResolvedWithoutModel: ambiguous.source === 'POLICY_RESPONSE', modelNeededByCurrentCore: false });
  const safe = tasks.filter(row => row.safelyResolvedWithoutModel).length, dependent = tasks.filter(row => row.modelNeededByCurrentCore).length;
  const artifact = { schemaVersion: 'hugo-phase6-workload-v1', syntheticOnly: true, selectionBias: '10 model-focused learning families plus 4 known deterministic safety/fact tasks',
    totalTasks: tasks.length, safelyResolvedWithoutModel: safe, currentlyGenerativeDependent: dependent, humanDecisionCompleted: 0,
    modelNecessityCountsForCurrentCore: { MODEL_REQUIRED: dependent, MODEL_OPTIONAL: 0, MODEL_NOT_REQUIRED: safe },
    modelNecessityPercentForCurrentCore: { MODEL_REQUIRED: Math.round(dependent / tasks.length * 1000) / 10, MODEL_OPTIONAL: 0, MODEL_NOT_REQUIRED: Math.round(safe / tasks.length * 1000) / 10 },
    safeNoModelPercent: Math.round(safe / tasks.length * 1000) / 10, generativeDependentPercent: Math.round(dependent / tasks.length * 1000) / 10,
    tasks, limit: 'This measures current served capability on the selected fixture, not necessity in production or business traffic.' };
  fs.writeFileSync(path.join(__dirname, 'phase6-workload.json'), JSON.stringify(artifact, null, 2) + '\n');
  console.log(JSON.stringify({ totalTasks: tasks.length, safeNoModel: safe, generativeDependent: dependent }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
