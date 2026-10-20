// Synthetic routing/context regression; no providers, datastore writes or credentials.
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const workspace = path.resolve(__dirname, '../..');
const source = process.env.PAY0_CONTEXT_SOURCE === 'true';
if (source) {
  const ts = require('../../functions/node_modules/typescript');
  require.extensions['.ts'] = (module, file) => {
    let text = fs.readFileSync(file, 'utf8');
    if (process.env.PAY0_CONTEXT_BASELINE_COMMIT && /[\\/](contextBuilderV2|conversationState)\.ts$/.test(file)) {
      text = execFileSync('git', ['show', process.env.PAY0_CONTEXT_BASELINE_COMMIT + ':' + path.relative(workspace, file).replaceAll('\\', '/')], { cwd: workspace }).toString();
    }
    module._compile(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  };
}
const base = path.resolve(workspace, process.env.PAY0_CONTEXT_LIB || (source ? 'functions/src/modules/agent007/hugoCore' : 'functions/lib/modules/agent007/hugoCore'));
assert(base.startsWith(workspace + path.sep), 'WORKSPACE_RUNTIME_REQUIRED');
const { buildHugoContextV2 } = require(path.join(base, 'contextBuilderV2' + (source ? '.ts' : '.js')));
const { emptyConversationState } = require(path.join(base, 'conversationState' + (source ? '.ts' : '.js')));
const now = 1792480000000, rootId = 'synthetic-routing-root';
const solicitud = { id: 'solicitud-demo', folio: 'S12345', cliente: 'Cliente Solicitud Demo', clienteId: 'cliente-demo', clienteFuente: 'CLIENT_ROOT_LOOKUP', metodoPago: 'PPD', monto: 123.45, moneda: 'MXN', estado: 'PENDIENTE' };
const pago = { id: 'pago-demo', folio: 'P12345', pagador: 'Banco Sintetico', remitenteDetectado: 'Banco OCR Demo', monto: 20 };
function tool(name, data, completeness = 'COMPLETE') { return { tool: name, data, sourceSystem: 'PAY0', scope: { rootId }, retrievedAt: new Date(now).toISOString(), completeness, evidence: [], trace: { latencyMs: 0, result: 'OK' } }; }
async function turn(message, state = emptyConversationState(rootId), options = {}) {
  const calls = [];
  const result = await buildHugoContextV2({ message, rootId, now, conversationState: state, router: makeRouter(calls, options) });
  return { ...result, calls };
}
function makeRouter(calls, options = {}) {
  const paymentRow = options.paymentClient ? { ...pago, cliente: 'Cliente Pago Demo', clienteId: 'cliente-pago-demo', clienteFuente: 'CLIENT_RECORD' } : pago;
  return { assertIdentity: identity => assert.equal(identity.rootId, rootId), execute: async request => {
    calls.push(request);
    if (request.name === 'getLatestSolicitud') return tool(request.name, { item: options.empty ? null : solicitud, order: { field: 'createdAt', direction: 'desc' } }, options.unknown ? 'UNKNOWN' : 'COMPLETE');
    if (request.name === 'getSolicitud') return tool(request.name, solicitud);
    if (request.name === 'searchReceivedPagos') return tool(request.name, { items: [paymentRow] });
    if (request.name === 'getPagoById' || request.name === 'getPago') return tool(request.name, paymentRow);
    return tool(request.name, []);
  } };
}
test('literal latest client solicitud request selects ordered canonical tool', async () => {
  const r = await turn('dime quien fue el ultimo cliente en hacer una solicitud y que tipo fue ppd o pue y el monto');
  assert.deepEqual(r.calls.map(x => x.name), ['getLatestSolicitud']);
  assert.equal(r.context.platformFacts.latestSolicitud.item.cliente, solicitud.cliente);
  assert.equal(r.conversationState.activeEntity.entityType, 'SOLICITUD');
  assert.equal(r.conversationState.activeEntity.source, 'PAY0_ORDERED_TOOL');
});
test('explicit solicitud supersedes payment even after last payments dialogue', async () => {
  const payments = await turn('muestra los ultimos pagos');
  assert.equal(payments.conversationState.activeEntity.entityType, 'PAGO');
  const r = await turn('y quien fue el ultimo cliente en hacer una solicitud quiero el nombre', payments.conversationState);
  assert.deepEqual(r.calls.map(x => x.name), ['getLatestSolicitud']);
  assert.equal(r.context.pagos.length, 0);
  assert.equal(r.conversationState.activeEntity.folio, solicitud.folio);
  const followup = await turn('¿de qué cliente?', r.conversationState);
  assert.equal(followup.calls[0].name, 'getSolicitud');
  assert.equal(followup.calls.some(x => x.name === 'getPagoById' || x.name === 'searchReceivedPagos'), false);
  assert.equal(followup.context.solicitudes[0].cliente, solicitud.cliente);
  assert.equal(followup.context.solicitudes[0].metodoPago, 'PPD');
});
test('new ordered query wins over ambiguous older solicitud references', async () => {
  const first = await turn('ultima solicitud');
  first.conversationState.recentEntities.push({ ...first.conversationState.activeEntity, entityId: 'older', folio: 'S54321' });
  const r = await turn('y el ultimo cliente que hizo una solicitud', first.conversationState);
  assert.equal(r.clarification, null);
  assert.deepEqual(r.calls.map(x => x.name), ['getLatestSolicitud']);
});
test('empty or unknown ordered results never retain a previous payment', async () => {
  const p = await turn('ultimo pago recibido');
  for (const options of [{ empty: true }, { unknown: true }]) {
    const r = await turn('ultimo cliente en hacer una solicitud', p.conversationState, options);
    assert.equal(r.conversationState.activeEntity, null);
    assert.equal(r.calls.some(x => x.name === 'getPagoById'), false);
  }
});
test('explicit folio remains exact rather than replaced by latest query', async () => {
  const r = await turn('dime el cliente de la ultima solicitud S12345');
  assert.equal(r.calls[0].name, 'getSolicitud');
  assert.equal(r.calls[0].input.folio, 'S12345');
});
test('client followup respects root, expiry and turn bounds', async () => {
  const r = await turn('ultima solicitud');
  for (const state of [{ ...r.conversationState, rootId: 'foreign-root' }, { ...r.conversationState, turn: r.conversationState.turn + 5 }, { ...r.conversationState, activeEntity: { ...r.conversationState.activeEntity, resolvedAt: now - 31 * 60000 } }]) {
    const next = await turn('¿de qué cliente?', state);
    assert.equal(next.calls.some(x => x.name === 'getSolicitud'), false);
  }
});
test('ordinary payment followups preserve payment routing', async () => {
  const p = await turn('ultimo pago recibido');
  const r = await turn('¿quien lo hizo y cual fue el monto?', p.conversationState);
  assert.deepEqual(r.calls.map(x => x.name), ['getPagoById']);
});
test('verified payment client survives context mapping without becoming the payer', async () => {
  const p = await turn('ultimo pago recibido', emptyConversationState(rootId), { paymentClient: true });
  const r = await turn('dame nombre de clientes no folios', p.conversationState, { paymentClient: true });
  assert.deepEqual(r.calls.map(x => x.name), ['getPagoById']);
  assert.equal(r.context.pagos[0].cliente, 'Cliente Pago Demo');
  assert.equal(r.context.pagos[0].clienteId, 'cliente-pago-demo');
  assert.equal(r.context.pagos[0].clienteFuente, 'CLIENT_RECORD');
  assert.notEqual(r.context.pagos[0].cliente, r.context.pagos[0].pagador);
});
test('real Core answers literal transcript and client followup from canonical evidence without model', async () => {
  const { HugoConversationCore } = require(path.join(base, 'conversationCore' + (source ? '.ts' : '.js')));
  let state = emptyConversationState(rootId), modelCalls = 0;
  const calls = [], identity = { uid: 'synthetic-routing-actor', rootId, role: 'superadmin' };
  const store = { loadConversationState: async () => ({ history: [], memory: { recommendations: [], rules: [] }, recentEntities: [], conversationState: state }),
    retrieveMemory: async () => ({ considered: 0, selected: [], legacyObservationsConsidered: 0, legacyObservations: [] }) };
  const core = new HugoConversationCore(makeRouter(calls), { generate: async () => { modelCalls++; throw Error('MODEL_MUST_NOT_RUN'); } }, store);
  const ask = async message => { const result = await core.respond({ identity, channel: 'WEB', conversationId: 'synthetic-conversation', name: 'Prueba', message, promptVersion: 'hugo-v2' }); state = result.conversationState; return result; };
  const first = await ask('dime quien fue el ultimo cliente en hacer una solicitud y que tipo fue ppd o pue y el monto');
  assert.match(first.text, /Cliente Solicitud Demo/); assert.match(first.text, /PPD/); assert.match(first.text, /123[.,]45/);
  await ask('muestra los ultimos pagos');
  const switched = await ask('y quien fue el ultimo cliente en hacer una solicitud quiero el nombre');
  assert.match(switched.text, /Cliente Solicitud Demo/); assert.doesNotMatch(switched.text, /Banco Sintetico/);
  assert.deepEqual(switched.toolsRequested.map(x => x.name), ['getLatestSolicitud']);
  const followup = await ask('¿de qué cliente?');
  assert.match(followup.text, /Cliente Solicitud Demo/); assert.equal(followup.context.folioConsultado, 'S12345');
  await ask('muestra los ultimos pagos');
  const clientNames = await ask('dame nombre de clientes no folios');
  assert.deepEqual(clientNames.toolsRequested.map(x => x.name), ['getPagoById']);
  assert.match(clientNames.text, /nombre de cliente verificado/);
  assert.doesNotMatch(clientNames.text, /Banco Sintetico|Banco OCR Demo/);
  const bankChallenge = await ask('la empresa demo no tiene banca demo de donde sacaste el dato de banca demo?');
  assert.deepEqual(bankChallenge.toolsRequested.map(x => x.name), ['getPagoById']);
  assert.notEqual(bankChallenge.source, 'MODEL_RESPONSE');
  assert.equal(bankChallenge.context.pagos[0].id, 'pago-demo');
  assert.doesNotMatch(bankChallenge.text, /^Veo \d+ solicitudes/);
  assert.equal(modelCalls, 0);
});
