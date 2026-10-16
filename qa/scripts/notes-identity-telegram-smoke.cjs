const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
function loadTs(file) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', 'require', output)(exports, require);
  return exports;
}
const { noteAuthorLabel, isSystemNote } = loadTs('src/lib/notePresentation.ts');
const { recordCreatorLabel } = loadTs('src/lib/recordCreator.ts');
const cases = [
  [{ authorType: 'USER', authorName: 'Ana', createdBy: 'uid-1', origin: 'MANUAL' }, 'Ana'],
  [{ createdByName: 'Ana', createdBy: 'uid-1' }, 'Ana'],
  [{ createdBy: 'uid-1', createdByName: 'uid-1' }, 'Usuario no disponible'],
  [{ createdBy: 'system', createdByName: 'IQ', text: 'Rechazado' }, 'Sistema'],
  [{ createdBy: 'uid-1', createdByName: 'Ana', source: 'IQ', text: 'FOLIO IQ: 123' }, 'Sistema'],
  [{ system: true, createdByName: 'Firebase' }, 'Sistema'],
  [{ authorType: 'USER', origin: 'MANUAL', createdByName: 'Ana', source: 'IQ' }, 'Ana'],
];
for (const [note, expected] of cases) assert.equal(noteAuthorLabel(note), expected);
assert.equal(isSystemNote(cases[4][0]), true);
assert.equal(recordCreatorLabel({ createdBy: 'uid-1', createdByDisplayName: 'uid-1' }), 'No disponible');
assert.equal(recordCreatorLabel({ createdBy: 'uid-1', createdByUsername: 'ana.operaciones' }), 'ana.operaciones');
const { legacyPrompt } = require('../../functions/lib/modules/agent007/hugoCore/legacyPrompt');
assert.match(legacyPrompt('hola', 'Ana', {}, []).system, /Eres María/);
const { buildIqPagoTelegramPreviewH4D64A7: preview } = require('../../functions/lib/modules/iq/pagoTelegramNotifications');
const base = { auth: { uid: 'internal-uid', rootId: 'test-root', role: 'superadmin' }, pagoId: 'internal-payment', pago: { folio: 'P123', monto: 1500, clienteNombre: 'Cliente prueba', empresaNombre: 'Empresa prueba' }, iqId: '12345', source: 'INTERNAL_TECHNICAL_SOURCE' };
for (const event of ['IQ_PAGO_CREADO', 'IQ_PAGO_CONCILIADO', 'IQ_PAGO_RECHAZADO', 'IQ_PAGO_CANCELADO', 'IQ_PAGO_NUEVO_COMPROBANTE', 'IQ_PAGO_MONTO_CORREGIDO']) {
  const result = preview({ ...base, event });
  assert.match(result.text, /P123/); assert.match(result.text, /1,500/); assert.match(result.text, /12345/);
  assert.doesNotMatch(result.text, /internal-uid|INTERNAL_TECHNICAL_SOURCE/);
  if (/RECHAZADO|CANCELADO/.test(event)) assert.match(result.text, /Acción:.*nuevo comprobante/);
  else assert(result.text.length < 380, 'concise routine notification');
}
const rejected = preview({ ...base, event: 'IQ_PAGO_RECHAZADO', pago: { ...base.pago, rejectionReason: 'Cuenta destino no disponible' } });
assert.match(rejected.text, /Motivo: Cuenta destino no disponible/);
// Prevent the routine note producers removed from reappearing; history is untouched.
for (const file of ['solicitudCreationCallables', 'solicitudCreateQueueCallables', 'solicitudReconciliationCallables', 'solicitudInvoiceImportCallables']) {
  const source = fs.readFileSync(path.join('functions/src/modules/iq', file + '.ts'), 'utf8');
  assert.doesNotMatch(source, /collection\("notas"\)/, file + ' must keep routine linkage in structured state');
}
console.log(JSON.stringify({ ok: true, checks: 46, externalActions: 0, suites: ['legacy note presentation', 'creator labels', 'María prompt', 'Telegram concise payloads', 'routine note producer guard'] }));
