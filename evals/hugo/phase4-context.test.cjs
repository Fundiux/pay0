const test = require('node:test');
const assert = require('node:assert/strict');
const base = '../../functions/lib/modules/agent007/hugoCore/';
const { HugoConversationCore } = require(base + 'conversationCore');
const { emptyConversationState, resolveConversationReference, advanceConversationState, normalizeConversationState } = require(base + 'conversationState');
const { canStateGlobalTotal, canStateGlobalTotalForMessage, relevantEvidenceBoundaries, buildHugoContextV2 } = require(base + 'contextBuilderV2');
const { checkExhaustiveness } = require(base + 'exhaustivenessPolicy');
const { memoryWritePolicy, memoryApplicable, MEMORY_CONTRACT_VERSION } = require(base + 'memoryContract');
const identity = { uid: 'synthetic-admin', rootId: 'root-a', role: 'superadmin' };
const now = Date.now();
const entity = (folio, turn = 1) => ({ system: 'PAY0', entityType: 'SOLICITUD', entityId: folio.toLowerCase(), folio, rootId: 'root-a', resolvedAt: now, resolvedTurn: turn, source: 'PAY0_EXACT_TOOL', confidence: 1 });
const tool = (name, data, completeness = 'PARTIAL') => ({ sourceSystem: 'PAY0', tool: name, scope: { rootId: 'root-a' }, retrievedAt: new Date(now).toISOString(), completeness,
  evidence: data?.id ? [{ sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: data.id, kind: 'FACT', completeness }] : [], data, trace: { latencyMs: 1, result: 'OK' } });
function router(calls) { return { assertIdentity: () => {}, execute: async request => { calls.push(request); switch (request.name) {
  case 'getSolicitud': return tool(request.name, request.input.folio === 'S99999' ? null : { id: request.input.folio.toLowerCase(), folio: request.input.folio, monto: 120, estado: 'PENDIENTE' }, request.input.folio === 'S99999' ? 'UNKNOWN' : 'COMPLETE');
  case 'getPago': return tool(request.name, { id: request.input.folio.toLowerCase(), folio: request.input.folio, monto: 70, estado: 'APLICADO' }, 'COMPLETE');
  case 'getIqCapabilities': return tool(request.name, {}, 'UNKNOWN');
  default: return tool(request.name, [], 'PARTIAL');
} } }; }
const noMemory = { retrieveMemory: async () => ({ considered: 0, selected: [], legacyObservationsConsidered: 0, legacyObservations: [] }) };

test('completeness semantics cover one/zero/several partial, scoped complete, aggregate complete and unknown', () => {
  const partial = { completeness: 'PARTIAL', scope: 'RECENT_SAMPLE', totalAllowed: false };
  const unknown = { completeness: 'UNKNOWN', scope: 'RECENT_SAMPLE', totalAllowed: false };
  const exact = { completeness: 'COMPLETE', scope: 'EXACT_FOLIO', totalAllowed: false };
  const aggregate = { completeness: 'COMPLETE', scope: 'ROOT_AGGREGATE', totalAllowed: true };
  for (const sample of [[], [{ id: 'p1' }], [{ id: 'p1' }, { id: 'p2' }]]) {
    assert.equal(canStateGlobalTotal([partial]), false, JSON.stringify(sample));
    assert.equal(checkExhaustiveness(`Hay ${sample.length} pagos en total.`, [partial]).allowed, false);
  }
  assert.equal(canStateGlobalTotal([unknown]), false);
  assert.equal(canStateGlobalTotal([exact]), false);
  assert.equal(canStateGlobalTotal([aggregate]), true);
  assert.equal(canStateGlobalTotal(relevantEvidenceBoundaries('¿Cuántos pagos hay?', { pagos: [partial], solicitudes: [aggregate] })), false);
  assert.equal(canStateGlobalTotalForMessage('¿Cuántos pagos y solicitudes hay?', { pagos: [partial], solicitudes: [aggregate] }), false);
  assert.equal(checkExhaustiveness('No hay pagos.', [aggregate]).allowed, true);
});

test('active entity resolves implicit follow-ups but ambiguous and stale references do not guess', () => {
  let state = emptyConversationState('root-a');
  const first = resolveConversationReference('¿Qué pasó con S12345?', state, 'root-a', now);
  assert.deepEqual(first.folios, ['S12345']);
  state = advanceConversationState(first, [entity('S12345')], 'root-a');
  assert.deepEqual(resolveConversationReference('¿Y cuánto era?', state, 'root-a', now + 1000).folios, ['S12345']);
  assert.deepEqual(resolveConversationReference('¿Por qué sigue pendiente?', state, 'root-a', now + 2000).folios, ['S12345']);
  assert.equal(resolveConversationReference('Ahora hablemos de IQ', state, 'root-a', now + 3000).reason, 'TOPIC_SHIFT');
  const two = { ...state, recentEntities: [entity('S12345'), entity('S67890')], activeEntity: null };
  assert.match(resolveConversationReference('¿Y el otro?', two, 'root-a', now + 1000).clarification, /S12345.*S67890/);
  assert.deepEqual(resolveConversationReference('¿Cuál tiene mayor monto?', two, 'root-a', now + 1000).folios, ['S12345', 'S67890']);
  assert.equal(resolveConversationReference('¿Y cuánto era?', state, 'root-a', now + 31 * 60000).folios.length, 0);
  assert.equal(normalizeConversationState({ ...state, rootId: 'root-b' }, 'root-a').activeEntity, null);
  assert.equal(resolveConversationReference('¿Y cuánto era?', emptyConversationState('root-a'), 'root-a', now).folios.length, 0);
});

test('Core v2 preserves entity through two turns and blocks partial global totals before model', async () => {
  let state = emptyConversationState('root-a'); const calls = []; let modelCalls = 0;
  const store = { ...noMemory, loadConversationState: async () => ({ history: [], memory: { recommendations: [], rules: [] }, recentEntities: [], conversationState: state }) };
  const model = { generate: async input => { modelCalls++; return { text: input.context.solicitudes.length ? `S12345 está pendiente por ${input.context.solicitudes[0].monto}.` : 'Hay 1 pago en total.', model: 'synthetic', modelVersion: 'v1', promptVersion: input.promptVersion, tokenUsage: null }; } };
  const core = new HugoConversationCore(router(calls), model, store);
  const respond = message => core.respond({ channel: 'WEB', conversationId: 'root-a_synthetic-admin', identity, name: 'Prueba', message, promptVersion: 'hugo-v2' });
  state = (await respond('¿Qué pasó con S12345?')).conversationState;
  const amount = await respond('¿Y cuánto era?'); state = amount.conversationState;
  assert.equal(amount.context.folioConsultado, 'S12345');
  assert(calls.filter(x => x.name === 'getSolicitud' && x.input.folio === 'S12345').length >= 2);
  const why = await respond('¿Por qué sigue pendiente?');
  assert.equal(why.context.folioConsultado, 'S12345');
  const before = modelCalls;
  const total = await respond('¿Cuántos pagos hay en total?');
  assert.equal(total.source, 'POLICY_RESPONSE'); assert.match(total.text, /muestra parcial|insuficiente/i); assert.equal(modelCalls, before);
  const two = { ...state, recentEntities: [entity('S12345', state.turn), entity('S67890', state.turn)], activeEntity: null };
  state = two;
  const ambiguous = await respond('¿Y el otro?');
  assert.equal(ambiguous.source, 'POLICY_RESPONSE'); assert.equal(ambiguous.context.solicitudes.length, 0); assert.equal(modelCalls, before);
});

test('v2 context admits relevant verified experience and bounded legacy observation without treating it as current fact', async () => {
  const calls = [], prior = advanceConversationState(resolveConversationReference('S12345', emptyConversationState('root-a'), 'root-a', now), [entity('S12345')], 'root-a');
  const record = { id: 'experience-1', version: MEMORY_CONTRACT_VERSION, rootId: 'root-a', kind: 'EXPERIENCE', status: 'CONFIRMED', scope: { level: 'ENTITY', rootId: 'root-a', system: 'PAY0', entityType: 'SOLICITUD', entityId: 's12345' },
    entityReference: { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: 's12345' }, content: 'Ayer estaba pendiente; se resolvió tras verificar documento.', source: 'OUTCOME_LINK', sourceSystem: 'HUGO', confidence: 0.8,
    createdAt: '2026-09-21T12:00:00Z', effectiveAt: '2026-09-21T12:00:00Z', lastVerifiedAt: '2026-09-21T13:00:00Z', validUntil: null, supersedes: [] };
  const store = { retrieveMemory: async query => { assert.equal(query.rootId, 'root-a'); return { considered: 1, selected: [{ record, relevanceReason: 'RECENT_OUTCOME', verificationStatus: 'CONFIRMED' }], legacyObservationsConsidered: 1,
    legacyObservations: [{ id: 'observation-1', rootId: 'root-a', caseId: 's12345', sourceEvent: 'SOLICITUD_STATUS_ACTUALIZADO', intent: 'Ver estado', outcome: 'Pendiente ayer', createdAt: '2026-09-21T12:00:00Z', verificationStatus: 'UNVERIFIED_LEGACY', relevanceReason: 'ENTITY_MATCH' }] }; } };
  const built = await buildHugoContextV2({ message: '¿Por qué sigue pendiente?', rootId: 'root-a', conversationState: prior, router: router(calls), dataStore: store, now: now + 1000 });
  assert.equal(built.context.memoriasHistoricas.length, 1); assert.equal(built.context.observacionesHistoricasNoVerificadas.length, 1);
  assert.equal(built.memoryUsage.included, 1); assert.equal(built.memoryUsage.legacyObservationsIncluded, 1);
  assert.equal(built.context.solicitudes[0].estado, 'PENDIENTE');
});

test('memory write and precedence reject partial negative fact, universal rule and stale or superseded memory', () => {
  assert.equal(memoryWritePolicy({ kind: 'FACT', source: 'MODEL', content: 'No hay pagos', evidenceCompleteness: 'PARTIAL' }).allowed, false);
  assert.equal(memoryWritePolicy({ kind: 'RULE', source: 'MODEL', content: 'Siempre usar banco X' }).allowed, false);
  assert.equal(memoryWritePolicy({ kind: 'HYPOTHESIS', source: 'MODEL', content: 'Tal vez viernes' }).initialStatus, 'CANDIDATE');
  const record = { id: 'm1', version: MEMORY_CONTRACT_VERSION, rootId: 'root-a', kind: 'FACT', status: 'CONFIRMED', scope: { level: 'ENTITY', rootId: 'root-a', system: 'PAY0', entityType: 'SOLICITUD', entityId: 's12345' },
    entityReference: { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: 's12345' }, content: 'Ayer estaba pendiente', source: 'PAY0', sourceSystem: 'PAY0', confidence: 1,
    createdAt: '2026-09-21T12:00:00Z', effectiveAt: '2026-09-21T12:00:00Z', lastVerifiedAt: '2026-09-21T12:00:00Z', validUntil: null, supersedes: [] };
  const query = { rootId: 'root-a', entityReferences: [record.entityReference], intent: 'STATUS', now: new Date(now).toISOString() };
  assert.equal(memoryApplicable(record, query), true);
  assert.equal(memoryApplicable({ ...record, rootId: 'root-b' }, query), false);
  assert.equal(memoryApplicable({ ...record, validUntil: new Date(now - 3600000).toISOString() }, query), false);
  assert.equal(memoryApplicable({ ...record, status: 'SUPERSEDED' }, query), false);
});

test('current PAY0 fact and contradictory memories are marked without merging their values', async () => {
  const prior = advanceConversationState(resolveConversationReference('S12345', emptyConversationState('root-a'), 'root-a', now), [entity('S12345')], 'root-a');
  const first = { id: 'old', version: MEMORY_CONTRACT_VERSION, rootId: 'root-a', kind: 'FACT', status: 'CONFIRMED', scope: { level: 'ENTITY', rootId: 'root-a', system: 'PAY0', entityType: 'SOLICITUD', entityId: 's12345' },
    entityReference: { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: 's12345' }, claim: { field: 'estado', value: 'PENDIENTE' }, content: 'Ayer pendiente', source: 'PAY0', sourceSystem: 'PAY0', confidence: 1,
    createdAt: '2026-09-21T12:00:00Z', effectiveAt: '2026-09-21T12:00:00Z', lastVerifiedAt: '2026-09-21T12:00:00Z', validUntil: null, supersedes: [] };
  const second = { ...first, id: 'newer', claim: { field: 'estado', value: 'EN_REVISION' }, content: 'Otra memoria dice revisión' };
  const source = router([]);
  const sourceRouter = { execute: async request => request.name === 'getSolicitud' ? tool('getSolicitud', { id: 's12345', folio: 'S12345', monto: 120, estado: 'COMPLETADA' }, 'COMPLETE') : source.execute(request) };
  const memoryStore = { retrieveMemory: async () => ({ considered: 2, selected: [first, second].map(record => ({ record, relevanceReason: 'ENTITY_MATCH', verificationStatus: 'CONFIRMED' })), legacyObservationsConsidered: 0, legacyObservations: [] }) };
  const result = await buildHugoContextV2({ message: 'Ayer estaba pendiente; ¿cómo está ahora?', rootId: 'root-a', conversationState: prior, router: sourceRouter,
    dataStore: memoryStore, now: now + 1000 });
  assert.equal(result.context.solicitudes[0].estado, 'COMPLETADA');
  assert(result.context.memoryConflicts.some(x => x.reason === 'CURRENT_PAY0_FACT_PREVAILS'));
  assert(result.context.memoryConflicts.some(x => x.reason === 'MEMORY_VALUES_CONFLICT'));
  assert.equal(result.context.memoriasHistoricas[0].historical, true);
  const currentOnly = await buildHugoContextV2({ message: '¿Cómo está S12345 ahora?', rootId: 'root-a', conversationState: prior, router: sourceRouter, dataStore: memoryStore, now: now + 1000 });
  assert.equal(currentOnly.context.solicitudes[0].estado, 'COMPLETADA');
  assert.equal(currentOnly.context.memoriasHistoricas.length, 0, 'stale snapshots stay out of current-state prompt');
});

test('context budget admits at most four relevant memories and records selected versus included', async () => {
  const prior = advanceConversationState(resolveConversationReference('S12345', emptyConversationState('root-a'), 'root-a', now), [entity('S12345')], 'root-a');
  const selected = Array.from({ length: 12 }, (_, i) => ({ record: { id: `m${i}`, version: MEMORY_CONTRACT_VERSION, rootId: 'root-a', kind: 'EXPERIENCE', status: 'CONFIRMED', scope: { level: 'ENTITY', rootId: 'root-a', system: 'PAY0', entityType: 'SOLICITUD', entityId: 's12345' },
    entityReference: { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: 's12345' }, content: 'x'.repeat(500), source: 'SYNTHETIC', sourceSystem: 'HUGO', confidence: 0.8, createdAt: new Date(now).toISOString(), effectiveAt: null, lastVerifiedAt: null, validUntil: null, supersedes: [] }, relevanceReason: 'RECENT_OUTCOME', verificationStatus: 'CONFIRMED' }));
  const built = await buildHugoContextV2({ message: '¿Por qué sigue pendiente?', rootId: 'root-a', conversationState: prior, router: router([]),
    dataStore: { retrieveMemory: async () => ({ considered: 12, selected, legacyObservationsConsidered: 0, legacyObservations: [] }) }, now: now + 1000 });
  assert.equal(built.memoryUsage.considered, 12); assert.equal(built.memoryUsage.selected, 12); assert(built.memoryUsage.included <= 4);
  assert(built.composition.approximateTokens <= 2500);
});
