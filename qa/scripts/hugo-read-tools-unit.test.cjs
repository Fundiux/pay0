const assert = require('node:assert/strict');
const { test } = require('node:test');
const search = require('../../functions/lib/modules/agent007/hugoReadTools/search');
const { validateHugoReadInput } = require('../../functions/lib/modules/agent007/hugoReadTools/validate');
const { loadReadSnapshot } = require('../../functions/lib/modules/agent007/hugoReadTools/loader');
const { fuzzyScore, normalizeSpokenFolio, mexicoDayRange, findSolicitudes, findPagos, findPeople, getSolicitudDetail, FUZZY_THRESHOLD } = search;

const ts = iso => ({ toMillis: () => Date.parse(iso), toDate: () => new Date(iso) });
const root = 'root-test';
const users = [
  { id: 'u-eb', rootId: root, displayName: 'EBASOR', username: 'EBASOR', email: 'ebasor@example.invalid', role: 'superadmin', active: true },
  { id: 'u-be', rootId: root, displayName: 'BETELL', username: 'BETELL', role: 'operador', active: true },
  { id: 'u-ed', rootId: root, displayName: 'EDGAR RAMIREZ', username: 'edgar', role: 'admin', active: true },
  { id: 'u-sb', rootId: root, displayName: 'SERGIO BASURTO', username: 'sbasurto', role: 'operador', active: true },
];
const clients = [
  { id: 'c-dmr', rootId: root, name: 'DESARROLLO Y CONSTRUCCIONES DMR SA DE CV', active: true },
  { id: 'c-dmi', rootId: root, name: 'DESARROLLOS INMOBILIARIOS MR', active: true },
  { id: 'c-bet', rootId: root, name: 'BETA SOLUCIONES SA DE CV', active: true },
  { id: 'c-del', rootId: root, name: 'CLIENTE BORRADO', isDeleted: true },
];
const companies = [
  { id: 'e-ac', rootId: root, nombre: 'ACIER CAPITAL' },
  { id: 'e-gc', rootId: root, nombre: 'GRUPO CAPITAL SAPI DE CV' },
  { id: 'e-az', rootId: root, nombre: 'AZTECA SERVICIOS' },
];
const sol = (id, extra) => ({ id, rootId: root, currency: 'MXN', status: 'PROCESANDO', companyId: 'e-ac', empresaNombre: 'ACIER CAPITAL', createdBy: 'u-eb', ...extra });
const solicitudes = [
  sol('s1', { folio: 'S1C192UE2', clienteId: 'c-dmr', clienteNombre: 'DESARROLLO Y CONSTRUCCIONES DMR SA DE CV', monto: 1000, createdAt: ts('2026-10-27T05:30:00Z'), tipoFactura: 'PPD', facturaSerie: 'A', facturaFolio: '77', facturaUuid: 'UUID-ABC-1' }),
  sol('s2', { folio: 'S1C192UE3', clienteId: 'c-dmr', clienteNombre: 'DESARROLLO Y CONSTRUCCIONES DMR SA DE CV', monto: 2500.5, createdAt: ts('2026-10-27T06:30:00Z'), status: 'RECHAZADA', motivoRechazo: { label: 'Datos fiscales' }, motivoRechazoDetalle: 'RFC no coincide' }),
  sol('s3', { folio: 'S1C35U1E28', clienteId: 'c-bet', clienteNombre: 'BETA SOLUCIONES SA DE CV', monto: 300, createdAt: new Date('2026-10-28T17:00:00Z'), createdBy: 'u-be', companyId: 'e-gc', empresaNombre: 'GRUPO CAPITAL SAPI DE CV' }),
  sol('s4', { folio: 'S1C19U3E2', clienteNombre: 'CLIENTE SIN ID', monto: 50, createdAt: '2026-09-01T12:00:00Z', createdBy: 'u-ed', status: 'COMPLETADA' }),
  sol('s5', { folio: 'S9C9U9E9', clienteId: 'c-dmr', monto: 999999, createdAt: { _seconds: Date.parse('2026-10-27T12:00:00Z') / 1000 }, isDeleted: true }),
  sol('s6', { folio: 'S9C9U9E8', clienteId: 'c-dmr', monto: 888888, createdAt: ts('2026-10-27T12:00:00Z'), deletedAt: ts('2026-10-28T00:00:00Z') }),
  sol('s7', { folio: 'S1C192UE9', clienteId: 'c-dmr', clienteNombre: 'DESARROLLO Y CONSTRUCCIONES DMR SA DE CV', monto: 10, amount: 999, createdAt: ts('2026-10-20T12:00:00Z'), status: 'RECHAZADA',
    ocClientName: 'DMR', ocClientRfc: 'DMR010101AAA', ocCommercialTotal: 11.6, ocCommercialSubtotal: 10, ocCommercialIva: 1.6, ocCommercialItems: [{ quantity: 2, unit: 'PZA', productCode: '1', description: 'Varilla' }],
    cotizacionAutoGenerateStatus: 'FAILED', cotizacionAutoGenerateStage: 'PDF', cotizacionAutoGenerateLastError: 'timeout', storagePath: 'roots/x/secret.pdf' }),
];
const pagos = [
  { id: 'p1', rootId: root, folio: 'P1C1U1E1', clienteId: 'c-dmr', companyId: 'e-ac', payerName: 'DESARROLLO Y CONSTRUCCIONES DMR', montoTotal: 500, moneda: 'MXN', status: 'CONCILIADO', fechaPago: ts('2026-10-26T18:00:00Z'), reportDateAt: ts('2026-10-01T18:00:00Z'), createdAt: ts('2026-10-27T18:00:00Z'), createdBy: 'u-eb', montoAplicado: 500, montoDisponible: 0 },
  { id: 'p2', rootId: root, folio: 'P1C1U1E2', clienteId: 'c-bet', companyId: 'e-gc', payerName: 'BETA SOLUCIONES', amount: 700, status: 'PENDIENTE', reportDateAt: ts('2026-10-27T18:00:00Z'), createdAt: ts('2026-10-28T18:00:00Z'), createdBy: 'u-be' },
  { id: 'p3', rootId: root, folio: 'P1C1U1E3', clienteNombre: 'OTRO', payerName: 'OTRO', monto: 100, status: 'APLICADO_PARCIAL', createdAt: ts('2026-10-27T19:00:00Z') },
  { id: 'p4', rootId: root, folio: 'P1C1U1E4', payerName: 'BORRADO', montoTotal: 5, status: 'CONCILIADO', createdAt: ts('2026-10-27T19:00:00Z'), isDeleted: true },
];
const snapshot = { solicitudes, pagos, users, clients, companies };

test('fuzzy matching resolves the real spoken names', () => {
  for (const [spoken, stored] of [['Evasor', 'EBASOR'], ['E-B-A-S-O-R', 'EBASOR'], ['e be a ese o erre', 'EBASOR'], ['ese va sor', 'EBASOR'], ['Basov', 'EBASOR'], ['Betel', 'BETELL'],
    ['Desarrollo y construcciones de MR', 'DESARROLLO Y CONSTRUCCIONES DMR SA DE CV'], ['Desarrollo y construcción de MR', 'DESARROLLO Y CONSTRUCCIONES DMR SA DE CV'], ['DMR', 'DESARROLLO Y CONSTRUCCIONES DMR SA DE CV'],
    ['Acier', 'ACIER CAPITAL'], ['Aser Capital', 'ACIER CAPITAL'], ['ACR Capital', 'ACIER CAPITAL'], ['acíer capital s.a. de c.v.', 'ACIER CAPITAL']]) {
    assert.ok(fuzzyScore(spoken, stored) >= FUZZY_THRESHOLD, `${spoken} -> ${stored} = ${fuzzyScore(spoken, stored)}`);
  }
  for (const [spoken, stored] of [['Evasor', 'BETELL'], ['Betel', 'BETA SOLUCIONES SA DE CV'], ['Basov', 'SERGIO BASURTO'], ['Desarrollo y construcciones de MR', 'DESARROLLOS INMOBILIARIOS MR'],
    ['ACR Capital', 'GRUPO CAPITAL SAPI DE CV'], ['Aser Capital', 'AZTECA SERVICIOS'], ['Pedro', 'EDGAR RAMIREZ'], ['DMR', 'EDGAR RAMIREZ']]) {
    assert.ok(fuzzyScore(spoken, stored) < FUZZY_THRESHOLD, `${spoken} must not match ${stored} = ${fuzzyScore(spoken, stored)}`);
  }
  assert.equal(fuzzyScore('ACIER CAPITAL', 'Acier Capital S.A. de C.V.'), 1);
});

test('spoken folios normalize to canonical tokens', () => {
  assert.equal(normalizeSpokenFolio('s uno c ciento noventa y dos u e dos'), 'S1C192UE2');
  assert.equal(normalizeSpokenFolio('ese uno ce diecinueve u tres e dos'), 'S1C19U3E2');
  assert.equal(normalizeSpokenFolio('el folio es s1c35u1e28'), 'S1C35U1E28');
  assert.equal(normalizeSpokenFolio('pe uno ce uno u uno e uno'), 'P1C1U1E1');
  assert.equal(normalizeSpokenFolio('uno nueve dos'), '192');
  assert.equal(normalizeSpokenFolio('hola'), null);
});

test('mexico day ranges are inclusive local days via Intl', () => {
  const day = mexicoDayRange('2026-10-27', '2026-10-27');
  assert.equal(new Date(day.fromMs).toISOString(), '2026-10-27T06:00:00.000Z');
  assert.equal(new Date(day.toMs).toISOString(), '2026-10-28T06:00:00.000Z');
  assert.equal(new Date(mexicoDayRange('2020-06-01').fromMs).toISOString(), '2020-06-01T05:00:00.000Z'); // historical DST
  assert.deepEqual(mexicoDayRange(), {});
  assert.throws(() => mexicoDayRange('2026-02-30'), /HUGO_TOOL_INVALID_INPUT/);
});

test('findSolicitudes totals cover all matches while items honor limits, order and deletion', () => {
  const all = findSolicitudes(snapshot, { cliente: 'Desarrollo y construcciones de MR', limite: 1 });
  assert.equal(all.total, 3); assert.equal(all.montoTotal, 3510.5); assert.equal(all.mostrados, 1);
  assert.equal(all.items[0].id, 's2'); assert.equal(all.interpretacion[0].confianza, 'APROXIMADA');
  assert.equal(all.items[0].cliente, 'DESARROLLO Y CONSTRUCCIONES DMR SA DE CV');
  const count = findSolicitudes(snapshot, { cliente: 'DMR', soloConteo: true });
  assert.equal(count.total, 3); assert.deepEqual(count.items, []);
  const byAmount = findSolicitudes(snapshot, { orden: 'MONTO_DESC', limite: 20 });
  assert.equal(byAmount.total, 5); assert.deepEqual(byAmount.items.map(row => row.id), ['s2', 's1', 's3', 's4', 's7']);
  assert.ok(!byAmount.items.some(row => row.id === 's5' || row.id === 's6'));
  const day = findSolicitudes(snapshot, { desde: '2026-10-27', hasta: '2026-10-27' });
  assert.deepEqual(day.items.map(row => row.id), ['s2']); // s1 is 2026-10-26 23:30 in Mexico City
  const first = findSolicitudes(snapshot, { desde: '2026-10-26', hasta: '2026-10-26' }).items[0];
  assert.equal(first.fecha, '2026-10-26'); assert.equal(first.hora, '23:30'); assert.equal(first.metodoPago, 'PPD'); assert.equal(first.factura, 'A-77');
  assert.equal(findSolicitudes(snapshot, { monto: 2500 }).total, 1);
  assert.equal(findSolicitudes(snapshot, { montoMin: 100, montoMax: 1000 }).total, 2);
  assert.equal(findSolicitudes(snapshot, { factura: 'uuid-abc' }).items[0].id, 's1');
  assert.equal(findSolicitudes(snapshot, { creadoPor: 'Evasor' }).total, 3);
  assert.equal(findSolicitudes(snapshot, { creadoPor: 'Betel' }).items[0].id, 's3');
  assert.equal(findSolicitudes(snapshot, { estado: 'rechazadas' }).total, 2);
  assert.equal(findSolicitudes(snapshot, { empresa: 'Aser Capital' }).total, 4);
  assert.equal(findSolicitudes(snapshot, { folio: 's uno c ciento noventa y dos u e dos' }).items[0].id, 's1');
  assert.equal(findSolicitudes(snapshot, { folio: 'S1C192' }).total, 3);
});

test('ties include every candidate and zero totals always carry sugerencias', () => {
  const tie = findSolicitudes(snapshot, { empresa: 'Capital' });
  assert.equal(tie.total, 5); assert.match(tie.interpretacion[0].entendido, /varias coincidencias/);
  const none = findSolicitudes(snapshot, { cliente: 'Desarrollo y construcciones de MR', creadoPor: 'Betel' });
  assert.equal(none.total, 0); assert.ok(Array.isArray(none.sugerencias));
  const unknown = findSolicitudes(snapshot, { cliente: 'Zapateria Gonzalez' });
  assert.equal(unknown.total, 0); assert.ok(Array.isArray(unknown.sugerencias));
  const near = findPagos(snapshot, { creadoPor: 'zzzz qqqq' });
  assert.equal(near.total, 0); assert.deepEqual(near.sugerencias, []);
  assert.equal(findSolicitudes(snapshot, {}).sugerencias, undefined);
});

test('findPagos filters by fechaPago with fallbacks, conciliado and excludes deleted', () => {
  const day = findPagos(snapshot, { desde: '2026-10-27', hasta: '2026-10-27' });
  assert.deepEqual(day.items.map(row => row.id).sort(), ['p2', 'p3']); // p1 paid 10-26 although registered 10-27
  const reconciled = findPagos(snapshot, { conciliado: true });
  assert.equal(reconciled.total, 2); assert.equal(reconciled.montoTotal, 600);
  const p1 = findPagos(snapshot, { pagador: 'desarrollo y construcciones de mr' }).items[0];
  assert.equal(p1.id, 'p1'); assert.equal(p1.fechaPago, '2026-10-26'); assert.equal(p1.registrado, '2026-10-27'); assert.equal(p1.empresa, 'ACIER CAPITAL'); assert.equal(p1.cliente, 'DESARROLLO Y CONSTRUCCIONES DMR SA DE CV'); assert.equal(p1.creadoPor, 'EBASOR');
  assert.equal(findPagos(snapshot, { limite: 20 }).total, 3);
});

test('getSolicitudDetail returns structured detail with linked pagos and no storage data', () => {
  const detail = getSolicitudDetail({ ...snapshot, aplicaciones: [{ id: 'a1', rootId: root, pagoId: 'p1', solicitudId: 's7', montoAplicado: 5, status: 'APLICADA' }],
    uploads: [{ id: 'up1', rootId: root, solicitudId: 's7', documentType: 'ORDEN_COMPRA', documentTypeLabel: 'Orden de compra', originalName: 'oc.pdf', status: 'READY', active: true, storagePath: 'roots/x/oc.pdf', createdAt: ts('2026-10-20T12:00:00Z') },
      { id: 'up2', rootId: root, solicitudId: 's7', originalName: 'old.pdf', active: false }] }, { folio: 'S1C192UE9' });
  assert.equal(detail.encontrada, true);
  const row = detail.solicitud;
  assert.equal(row.monto, 10); assert.equal(row.oc.total, 11.6); assert.deepEqual(row.oc.partidas, [{ cantidad: 2, descripcion: 'Varilla', importe: null }]);
  assert.deepEqual(row.cotizacionDetalle, { estado: 'FAILED', etapa: 'PDF', ultimoError: 'timeout' });
  assert.deepEqual(row.documentos, [{ tipo: 'Orden de compra', nombre: 'oc.pdf', estado: 'READY', fecha: '2026-10-20' }]);
  assert.deepEqual(row.pagosRelacionados, [{ id: 'p1', folio: 'P1C1U1E1', monto: 5, fechaPago: '2026-10-26', estado: 'CONCILIADO', montoPago: 500, estadoAplicacion: 'APLICADA' }]);
  assert.ok(!JSON.stringify(detail).includes('roots/'));
  assert.equal(getSolicitudDetail(snapshot, { id: 's2' }).solicitud.motivoRechazo, 'Datos fiscales: RFC no coincide');
  const ambiguous = getSolicitudDetail(snapshot, { folio: 'S1C192' });
  assert.equal(ambiguous.encontrada, false); assert.equal(ambiguous.candidatos.length, 3);
  assert.equal(getSolicitudDetail(snapshot, { id: 's5' }).encontrada, false);
});

test('findPeople ranks users, clients and companies and offers low-confidence fallbacks', () => {
  assert.deepEqual(findPeople(snapshot, { texto: 'Evasor' }).coincidencias.map(row => [row.tipo, row.id]), [['USUARIO', 'u-eb']]);
  assert.equal(findPeople(snapshot, { texto: 'Basov', tipo: 'USUARIO' }).coincidencias[0].id, 'u-eb');
  assert.equal(findPeople(snapshot, { texto: 'Acier', tipo: 'EMPRESA' }).coincidencias[0].id, 'e-ac');
  assert.equal(findPeople(snapshot, { texto: 'Desarrollo y construcción de MR', tipo: 'CLIENTE' }).coincidencias[0].id, 'c-dmr');
  assert.ok(!findPeople(snapshot, { texto: 'borrado' }).coincidencias.some(row => row.id === 'c-del'));
  const weak = findPeople(snapshot, { texto: 'Basurtos Sergios Ramirez' }).coincidencias;
  assert.ok(weak.length <= 3);
});

test('validation whitelists keys and types', () => {
  assert.deepEqual(validateHugoReadInput('findSolicitudes', { cliente: '  DMR ', limite: 3, desde: null, folio: '' }), { cliente: 'DMR', limite: 3 });
  for (const bad of [{ rootId: 'x' }, { limite: 21 }, { limite: 1.5 }, { desde: '27/10/2026' }, { desde: '2026-10-28', hasta: '2026-10-27' }, { monto: -1 }, { orden: 'X' }, { cliente: 'x'.repeat(121) }, { soloConteo: 'true' }]) {
    assert.throws(() => validateHugoReadInput('findSolicitudes', bad), /HUGO_TOOL_INVALID_INPUT/, JSON.stringify(bad));
  }
  assert.throws(() => validateHugoReadInput('getSolicitudDetail', {}), /HUGO_TOOL_INVALID_INPUT/);
  assert.throws(() => validateHugoReadInput('getSolicitudDetail', { id: 'a/b' }), /HUGO_TOOL_INVALID_INPUT/);
  assert.throws(() => validateHugoReadInput('findPeople', { texto: 'x', tipo: 'ROOT' }), /HUGO_TOOL_INVALID_INPUT/);
  assert.throws(() => validateHugoReadInput('findPagos', { factura: 'x' }), /HUGO_TOOL_INVALID_INPUT/);
});

test('loader scopes by rootId and fails closed on a foreign row', async () => {
  const calls = [];
  const fakeDb = rows => ({ collection: name => {
    const query = filters => ({ where: (field, op, value) => query([...filters, [field, op, value]]),
      get: async () => { calls.push([name, filters]); return { docs: (rows[name] || []).map(row => ({ id: row.id, data: () => row })) }; } });
    return query([]);
  } });
  const ok = await loadReadSnapshot(fakeDb({ solicitudes: [solicitudes[0]], uploads: [{ id: 'up', rootId: root, solicitudId: 's1' }] }), root, { collections: ['solicitudes'], solicitudIds: ['s1'] });
  assert.equal(ok.solicitudes.length, 1); assert.equal(ok.uploads.length, 1); assert.deepEqual(ok.aplicaciones, []);
  assert.ok(calls.every(([, filters]) => filters.some(([field, op, value]) => field === 'rootId' && op === '==' && value === root)));
  assert.ok(calls.some(([name, filters]) => name === 'pagoAplicaciones' && filters.some(([field]) => field === 'solicitudId')));
  await assert.rejects(loadReadSnapshot(fakeDb({ users: [{ id: 'x', rootId: 'other-root' }] }), root, { collections: ['users'] }), /HUGO_READ_ROOT_MISMATCH/);
  await assert.rejects(loadReadSnapshot(fakeDb({}), 'a/b'), /HUGO_READ_ROOT_MISMATCH/);
});
