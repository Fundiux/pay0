const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const coreDir = join(__dirname, '../../functions/src/modules/agent007/hugoCore');
const lib = join(__dirname, '../../functions/lib/modules/agent007/hugoCore');

test('Hugo Core has no PAY0 persistence or Vertex imports', () => {
  for (const file of readdirSync(coreDir).filter(name => name.endsWith('.ts'))) {
    const source = readFileSync(join(coreDir, file), 'utf8');
    assert.doesNotMatch(source, /from\s+["'][^"']*(pay0Connector|paymentApplications|modules\/iq|firebase-admin|sharedCallables)["']/i, file);
    assert.doesNotMatch(source, /\b(db\.collection|db\.doc|paymentComplementConfigs|iqIntegrationConfigs|paymentComplementRequests)\b/, file);
  }
});

test('Tool Router rejects unknown, unauthorized, malformed and crossed-scope calls', async () => {
  const { HugoToolRouter } = require(join(lib, 'toolRouter'));
  const identity = { uid: 'synthetic-admin', rootId: 'root-a', role: 'superadmin' };
  assert.throws(() => new HugoToolRouter({ ...identity, role: 'cliente' }, {}), /UNAUTHORIZED/);
  const result = { sourceSystem: 'PAY0', tool: 'getSolicitud', scope: { rootId: 'root-a' }, data: null, evidence: [], completeness: 'UNKNOWN', retrievedAt: '2026-09-22T12:00:00Z', trace: { latencyMs: 1, result: 'UNKNOWN' } };
  const router = new HugoToolRouter(identity, { getSolicitud: async () => result });
  assert.throws(() => router.assertIdentity({ ...identity, rootId: 'root-b' }), /IDENTITY_MISMATCH/);
  await assert.rejects(router.execute({ name: 'arbitraryWrite', input: {} }), /UNKNOWN/);
  await assert.rejects(router.execute({ name: 'getPago', input: { folio: 'P12345' } }), /NOT_ALLOWED/);
  await assert.rejects(router.execute({ name: 'getSolicitud', input: { folio: 'bad/path' } }), /INVALID_INPUT/);
  await assert.rejects(router.execute({ name: 'getSolicitud', input: { folio: 'S12345', rootId: 'root-b' } }), /INVALID_INPUT/);
  const crossed = new HugoToolRouter(identity, { getSolicitud: async () => ({ ...result, scope: { rootId: 'root-b' } }) });
  await assert.rejects(crossed.execute({ name: 'getSolicitud', input: { folio: 'S12345' } }), /SCOPE_MISMATCH/);
  assert.equal((await router.execute({ name: 'getSolicitud', input: { folio: 'S12345' } })).completeness, 'UNKNOWN');
});

test('structured conversational reference resolves only a unique matching entity', () => {
  const { requestedFolio } = require(join(lib, 'contextBuilder'));
  const recent = [{ system: 'PAY0', type: 'SOLICITUD', id: 'one', folio: 'S12345' }];
  assert.equal(requestedFolio('¿Y esa solicitud?', recent), 'S12345');
  assert.equal(requestedFolio('¿Y esa solicitud?', [...recent, { ...recent[0], id: 'two', folio: 'S54321' }]), null);
  assert.equal(requestedFolio('¿Y ese pago?', recent), null);
});

test('Core accepts a non-web channel and an injected model without Vertex', async () => {
  const { HugoConversationCore } = require(join(lib, 'conversationCore'));
  const identity = { uid: 'synthetic-admin', rootId: 'root-a', role: 'superadmin' };
  const requested = [];
  const router = { assertIdentity: () => {}, execute: async request => {
    requested.push(request.name);
    return { sourceSystem: 'PAY0', tool: request.name, scope: { rootId: 'root-a' }, retrievedAt: '2026-09-22T12:00:00Z', completeness: 'PARTIAL', evidence: [],
      data: request.name === 'getIqCapabilities' ? { consultaComplemento: 'PAUSADA', solicitudComplemento: 'PAUSADA', complementoFacturama: 'PAUSADO' } : [], trace: { latencyMs: 1, result: 'OK' } };
  } };
  const model = { generate: async () => ({ text: 'Respuesta de prueba', model: 'synthetic', modelVersion: 'v1', promptVersion: 'legacy-v1', tokenUsage: null }) };
  const result = await new HugoConversationCore(router, model).respond({ channel: 'VOICE', conversationId: 'c1', identity, name: 'Prueba', message: 'Hola', history: [], memory: { recommendations: [], rules: [] } });
  assert.equal(result.text, 'Respuesta de prueba');
  assert.equal(result.source, 'MODEL_RESPONSE');
  assert.deepEqual(requested, ['searchSolicitudes', 'searchPagos', 'getPaymentComplementStatus', 'getIqCapabilities']);
});
