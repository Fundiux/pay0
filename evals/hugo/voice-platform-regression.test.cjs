const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHugoContextV2 } = require('../../functions/lib/modules/agent007/hugoCore/contextBuilderV2');
const { normalizeConversationState } = require('../../functions/lib/modules/agent007/hugoCore/conversationState');
const { formatVoicePlatformResult } = require('../../functions/lib/modules/agent007/voiceDelegation');

function result(tool, data) { return { sourceSystem: 'PAY0', tool, retrievedAt: new Date().toISOString(), scope: { rootId: 'root-a' }, completeness: 'COMPLETE', evidence: [], data, trace: { latencyMs: 0, result: 'OK' } }; }
async function context(message, data) {
  const calls = [];
  const built = await buildHugoContextV2({ message, rootId: 'root-a', conversationState: normalizeConversationState(null, 'root-a'), router: { execute: async request => { calls.push(request); return result(request.name, data); } } });
  return { calls, built };
}
test('clientes de usuario usa una herramienta de alcance en lugar del muestreo operativo', async () => {
  const { calls, built } = await context('¿Cuántos clientes tiene el usuario Betel?', { matchStatus: 'EXACT', clientCount: 7, user: { displayName: 'Betel' } });
  assert.deepEqual(calls.map(x => x.name), ['countClientsForUser']); assert.equal(calls[0].input.query, 'Betel'); assert.equal(built.context.platformFacts.clientCount.clientCount, 7);
});
test('acceso efectivo y catálogo de sistemas tienen herramientas separadas', async () => {
  assert.deepEqual((await context('¿A qué tienes acceso?', {})).calls.map(x => x.name), ['getAuthorizedCapabilities']);
  assert.deepEqual((await context('¿Cuáles son los sistemas que manejamos?', [])).calls.map(x => x.name), ['getSystemCatalog']);
});
test('variaciones naturales conservan la misma capacidad y no una frase exacta', async () => {
  assert.deepEqual((await context('Dime los clientes asignados a Betel', {})).calls.map(x => x.name), ['countClientsForUser']);
  assert.deepEqual((await context('Que puedes consultar dentro de mi cuenta?', {})).calls.map(x => x.name), ['getAuthorizedCapabilities']);
  assert.deepEqual((await context('Que otras plataformas forman parte de la empresa?', [])).calls.map(x => x.name), ['getSystemCatalog']);
  const colloquial = await context('¿Me puedes decir cuántos usuarios tiene Betel?', { matchStatus: 'EXACT', clientCount: 7 });
  assert.deepEqual(colloquial.calls.map(x => x.name), ['countClientsForUser']);
  assert.equal(colloquial.calls[0].input.query, 'Betel');
});
test('la salida de voz deterministica se deriva del resultado canonico de PAY0', () => {
  assert.equal(formatVoicePlatformResult('countClientsForUser', { matchStatus: 'EXACT', clientCount: 7, user: { displayName: 'Fixture' } }), 'Fixture tiene 7 clientes activos visibles en PAY0.');
  assert.match(formatVoicePlatformResult('getAuthorizedCapabilities', { role: 'superadmin', modules: { clientes: { view: true }, pagos: { view: false } } }), /clientes/);
  assert.match(formatVoicePlatformResult('getSystemCatalog', [{ id: 'PAY0', status: 'CONNECTED', allowed: true }]), /PAY0 \(CONNECTED, permitido\)/);
});
