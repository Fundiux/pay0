import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Executable contract, independent of archived prose and visual copy. Only
// domain functions and a transaction fake run; this script has no Firebase client.
function compile(source, values = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('exports', ...Object.keys(values), code)(module.exports, ...Object.values(values));
  return module.exports;
}
const domain = compile(fs.readFileSync('functions/src/modules/materiality/domain.ts', 'utf8'));
const expectedRequired = ['ORDEN_COMPRA', 'COTIZACION', 'CONSTANCIA_RECEPCION_SATISFACCION', 'FACTURA_XML', 'FACTURA_PDF', 'COMPROBANTE_PAGO'];
assert.deepEqual([...domain.MATERIALITY_REQUIRED_TYPES], expectedRequired);
assert.equal(domain.normalizeMaterialityDocumentType('COMPROBANTE_DISPERSION'), '');
assert.equal(domain.normalizeMaterialityDocumentType(' contrato_marco '), 'CONTRATO_MARCO');
assert(!domain.MATERIALITY_REQUIRED_TYPES.includes('CONTRATO_MARCO'));

const service = fs.readFileSync('functions/src/modules/materiality/service.ts', 'utf8');
const ast = ts.createSourceFile('service.ts', service, ts.ScriptTarget.Latest, true);
const names = ['isReadyActiveUpload', 'putLatestUploadByType', 'chunkArray', 'getActivePagoUploadsBySolicitud', 'buildCompletedTypes'];
const declarations = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
assert.equal(declarations.length, names.length, 'materiality contract functions must resolve exactly');
const rows = {
  pagoAplicaciones: [
    { id: 'a1', rootId: 'r1', solicitudId: 's1', pagoId: 'p1', status: 'APLICADA', numeroParcialidad: 1 },
    { id: 'a2', rootId: 'r1', solicitudId: 's1', pagoId: 'p1', status: 'APLICADA', numeroParcialidad: 2 },
    { id: 'reversed', rootId: 'r1', solicitudId: 's1', pagoId: 'p2', status: 'REVERSADA' },
    { id: 'foreign', rootId: 'r2', solicitudId: 's1', pagoId: 'p3', status: 'APLICADA' },
  ],
  uploads: [],
};
const receipt = (id, patch = {}) => ({ id, rootId: 'r1', pagoId: 'p1', entityType: 'pagos', active: true, status: 'READY', documentType: 'COMPROBANTE_PAGO', version: 1, ...patch });
rows.uploads = [
  receipt('old'), receipt('new', { version: 2 }),
  receipt('inactive', { active: false, version: 90 }),
  receipt('unready', { status: 'PREPARED', version: 90 }),
  receipt('foreign', { rootId: 'r2', version: 90 }),
  receipt('dispersion', { entityType: 'dispersiones', version: 90 }),
  receipt('reversed', { pagoId: 'p2', version: 90 }),
  receipt('foreign-payment', { pagoId: 'p3', version: 90 }),
  receipt('rep1', { documentType: 'COMPLEMENTO_PAGO_XML', applicationId: 'a1', solicitudId: 's1' }),
  receipt('rep2', { documentType: 'COMPLEMENTO_PAGO_XML', applicationId: 'a2', solicitudId: 's1' }),
  receipt('rep-mismatch', { documentType: 'COMPLEMENTO_PAGO_XML', applicationId: 'a2', solicitudId: 'other', version: 99 }),
];
function query(collection, filters = [], maximum = Infinity) {
  return { collection, filters, maximum,
    where: (key, op, value) => query(collection, [...filters, [key, op, value]], maximum),
    limit: value => query(collection, filters, value),
  };
}
const db = { collection: name => query(name) };
const tx = { async get(q) {
  assert(['uploads', 'pagoAplicaciones'].includes(q.collection));
  return { docs: rows[q.collection].filter(row => q.filters.every(([key, op, value]) => op === '==' ? row[key] === value : value.includes(row[key])))
    .slice(0, q.maximum).map(row => ({ id: row.id, data: () => row })) };
} };
const functions = compile(declarations.map(n => n.getText(ast)).join('\n') + '\nexports.get = getActivePagoUploadsBySolicitud; exports.completed = buildCompletedTypes;', {
  db, cleanText: domain.cleanText, normalizeMaterialityDocumentType: domain.normalizeMaterialityDocumentType,
});
const documents = await functions.get('r1', 's1', tx);
assert.equal(documents.COMPROBANTE_PAGO.id, 'new', 'only latest ready payment receipt from live application qualifies');
assert.equal(documents['COMPLEMENTO_PAGO_XML:a1'].id, 'rep1');
assert.equal(documents['COMPLEMENTO_PAGO_XML:a2'].id, 'rep2', 'partialities must remain distinct');
assert.equal(Object.keys(documents).length, 3, 'foreign, reversed, inactive and dispersion documents must not enter dossier');
assert.deepEqual(await functions.get('r1', 'unrelated', tx), {});
const completed = functions.completed(documents, null);
assert(completed.includes('COMPROBANTE_PAGO'));
assert(!completed.includes('CONTRATO_MARCO'));
assert(!completed.includes('COMPROBANTE_DISPERSION'));
console.log('[OK] Materiality executable contract: required evidence, root isolation, payment origin, partialities and inactive/reversed exclusions; no network.');
