// Acceptance suite for Hugo's general read tools (findSolicitudes,
// getSolicitudDetail, findPagos, findPeople). Each numbered case reproduces a
// real failure from voice sessions (24-sep..27-oct-2026) at the tool level:
// the tool call(s) a sensible voice model would make for the utterance, and
// what the result must contain. Pure functions only: no emulator, no network.
//
// Fixture: one synthetic root. Entity names EBASOR, BETELL, ACIER CAPITAL and
// DESARROLLO Y CONSTRUCCIONES DMR already appear in repo tests; every other
// client/company, every amount except 7,540 and every folio is synthetic.
//
// Exit codes: 0 all pass, 1 some FAIL, 2 compiled search.js missing.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.fetch = () => { throw new Error("network disabled in hugo-general-read-tools test"); };

const SEARCH_JS = path.join(__dirname, "../../functions/lib/modules/agent007/hugoReadTools/search.js");
if (!fs.existsSync(SEARCH_JS)) {
  console.error(`Hugo read tools not built yet: ${path.relative(process.cwd(), SEARCH_JS)} does not exist.`);
  console.error("Build the Functions package (functions/: npm run build) and run this script again.");
  process.exit(2);
}
const lib = require(SEARCH_JS);

// ---------------------------------------------------------------------------
// Time helpers (America/Mexico_City is UTC-6 all year since 2022).
// ---------------------------------------------------------------------------
const NOW = new Date("2026-10-27T20:00:00-06:00"); // Tuesday
const at = (day, hm = "12:00") => new Date(`${day}T${hm}:00-06:00`);
const HOY = "2026-10-27";
const AYER = "2026-10-26";
const SEMANA_PASADA = { desde: "2026-10-19", hasta: "2026-10-25" }; // Monday-start weeks
const ESTE_MES = { desde: "2026-10-01", hasta: "2026-10-31" };

function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v === "number") return new Date(v);
  return new Date(v);
}
function mxDay(v) {
  if (v == null) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = toDate(v);
  if (!d || Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}
const inRange = (day, r) => day >= r.desde && day <= r.hasta;
const cents = n => Math.round(Number(n) * 100);
const sum = rows => rows.reduce((acc, row) => acc + cents(row), 0) / 100;
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const ROOT = "root-hugo-synth";

const COMPANIES = [
  { id: "c-acier", nombre: "ACIER CAPITAL" },
  { id: "c-norte", nombre: "GRUPO FINANCIERO NORTENO" },
  { id: "c-lumen", nombre: "LUMEN SERVICIOS INTEGRALES" },
  { id: "c-orbita", nombre: "ORBITA CONSULTORES" },
  { id: "c-vela", nombre: "VELA ADMINISTRADORA" },
].map(row => ({ ...row, rootId: ROOT }));

const CLIENTS = [
  { id: "cl-dmr", name: "DESARROLLO Y CONSTRUCCIONES DMR SA DE CV" },
  { id: "cl-mayab", name: "CONSTRUCCIONES DEL MAYAB SA DE CV" },
  { id: "cl-segur", name: "SEGURENTAS DEL BAJIO SA DE CV" },
  { id: "cl-ocean", name: "OCEAN SPILL SERVICES SA DE CV" },
  { id: "cl-sismo", name: "SERVICIOS SISMICOS DEL GOLFO SA DE CV" },
  { id: "cl-nicol", name: "TRANSPORTES SAN NICOLAS SA DE CV" },
  { id: "cl-alfa", name: "ALFA REFACCIONES INDUSTRIALES SA DE CV" },
  { id: "cl-brisa", name: "BRISA LOGISTICA SA DE CV" },
  { id: "cl-cobre", name: "COBRE Y METALES DEL CENTRO SA DE CV" },
  { id: "cl-pino", name: "PINO VERDE AGRICOLA SPR DE RL" },
].map(row => ({ ...row, razonSocial: row.name, active: true, rootId: ROOT }));

const USERS = [
  { id: "u-ebasor", displayName: "Usuario Ebasor", nombreUsuario: "EBASOR", email: "ebasor@pay0.test", role: "SUPERADMIN", active: true },
  { id: "u-betell", displayName: "Usuario Betell", nombreUsuario: "BETELL", email: "betell@pay0.test", role: "OPERADOR", active: true },
  { id: "u-vtenorio", displayName: "Valeria Tenorio", nombreUsuario: "VTENORIO", email: "vtenorio@pay0.test", role: "OPERADOR", active: true },
  { id: "u-mlopez", displayName: "Mario Lopez", nombreUsuario: "MLOPEZ", email: "mlopez@pay0.test", role: "OPERADOR", active: true },
  { id: "u-jramirez", displayName: "Julia Ramirez", nombreUsuario: "JRAMIREZ", email: "jramirez@pay0.test", role: "CAPTURISTA", active: true },
  { id: "u-gsosa", displayName: "Gerardo Sosa", nombreUsuario: "GSOSA", email: "gsosa@pay0.test", role: "OPERADOR", active: false },
].map(row => ({ ...row, username: row.nombreUsuario, usernameNormalized: row.nombreUsuario.toLowerCase(), rootId: ROOT }));

const companyById = Object.fromEntries(COMPANIES.map(row => [row.id, row]));
const clientById = Object.fromEntries(CLIENTS.map(row => [row.id, row]));
const userById = Object.fromEntries(USERS.map(row => [row.id, row]));

function sol(id, day, hm, cl, co, monto, status, by, extra = {}) {
  const n = Number(id.slice(1));
  const user = userById[by];
  return {
    id, folio: `S9C${100 + n}U${n % 7}E1`, clienteNombre: clientById[cl].name, clienteId: cl,
    empresaNombre: companyById[co].nombre, companyId: co, monto, currency: "MXN", status,
    tipoFactura: "PPD", facturaFolio: String(51000 + n), facturaSerie: "B", facturaUuid: null, facturaFecha: at(day, hm),
    facturaSubtotal: Math.round(monto / 1.16 * 100) / 100, facturaTotal: monto, totalAbonado: status === "PAGADA" ? monto : 0,
    motivoRechazo: status === "RECHAZADA" ? "Documentacion incompleta" : null,
    createdAt: at(day, hm), createdBy: user.id, createdByUsername: user.nombreUsuario, createdByDisplayName: user.displayName,
    cotizacionAutoGenerateStatus: "READY", cotizacionAutoGenerateStage: "DONE",
    rootId: ROOT, isDeleted: false, ...extra,
  };
}

const TARGET_ID = "s16"; // DMR / ACIER CAPITAL / 7,540 / factura Z48207 / 23-oct
const SOLICITUDES = [
  // Today (2026-10-27): 4 live + 1 deleted (the most recent row overall).
  sol("s01", HOY, "09:15", "cl-brisa", "c-acier", 7450, "PENDIENTE", "u-ebasor"),
  sol("s02", HOY, "11:00", "cl-cobre", "c-orbita", 31000, "PROCESANDO", "u-vtenorio"),
  sol("s03", HOY, "13:20", "cl-ocean", "c-vela", 9800, "PROCESANDO", "u-ebasor"),
  sol("s04", HOY, "17:40", "cl-sismo", "c-lumen", 23100.5, "PENDIENTE", "u-betell"),
  sol("s05", HOY, "19:30", "cl-alfa", "c-norte", 7450, "PENDIENTE", "u-ebasor", { isDeleted: true }),
  // Yesterday (2026-10-26). s06 is 23:30 local = 27-oct UTC: must count as yesterday, not today.
  sol("s06", AYER, "23:30", "cl-pino", "c-norte", 5000, "PENDIENTE", "u-mlopez"),
  sol("s08", AYER, "10:00", "cl-alfa", "c-acier", 12345.67, "PROCESANDO", "u-ebasor"),
  sol("s09", AYER, "12:30", "cl-brisa", "c-norte", 6200, "PAGADA", "u-vtenorio"),
  sol("s10", AYER, "15:45", "cl-segur", "c-lumen", 44000, "PENDIENTE", "u-vtenorio"),
  sol("s11", AYER, "16:10", "cl-pino", "c-orbita", 3300, "PROCESANDO", "u-ebasor"),
  // Last week (19..25 oct). s19 at 23:50 local is 26-oct UTC; s20 (18-oct 23:30) is 19-oct UTC.
  sol("s12", "2026-10-19", "10:00", "cl-cobre", "c-vela", 15000, "PAGADA", "u-betell"),
  sol("s13", "2026-10-20", "11:00", "cl-ocean", "c-acier", 21500, "PROCESANDO", "u-ebasor"),
  sol("s14", "2026-10-21", "12:00", "cl-nicol", "c-norte", 8900, "RECHAZADA", "u-betell"),
  sol("s15", "2026-10-22", "09:30", "cl-alfa", "c-lumen", 7540, "PENDIENTE", "u-jramirez"),
  sol("s16", "2026-10-23", "12:15", "cl-dmr", "c-acier", 7540, "PROCESANDO", "u-ebasor", {
    folio: "S7C318UE4", tipoFactura: "PUE", facturaSerie: "Z", facturaFolio: "48207",
    facturaUuid: "0F1E2D3C-4B5A-4968-8776-A5B4C3D2E1F0", facturaFecha: at("2026-10-23", "11:00"),
    facturaSubtotal: 6500, facturaTotal: 7540, totalAbonado: 0,
    cotizacionAutoGenerateStatus: "FAILED_RETRYABLE", cotizacionAutoGenerateStage: "RENDER_PDF",
    ocClientName: "DESARROLLO Y CONSTRUCCIONES DMR SA DE CV", ocClientRfc: "DCD010101AA1",
    ocCommercialSubtotal: 6500, ocCommercialIva: 1040, ocCommercialTotal: 7540,
    ocCommercialItems: [
      { quantity: 10, unit: "PZA", productCode: "30111601", description: "Saco de cemento gris 50 kg" },
      { quantity: 4, unit: "PZA", productCode: "30102403", description: "Varilla corrugada 3/8 x 12 m" },
    ],
  }),
  sol("s17", "2026-10-24", "13:00", "cl-mayab", "c-acier", 7450, "PENDIENTE", "u-mlopez"),
  sol("s18", "2026-10-25", "16:00", "cl-segur", "c-orbita", 52000, "PAGADA", "u-vtenorio"),
  sol("s19", "2026-10-25", "23:50", "cl-brisa", "c-vela", 1000, "PENDIENTE", "u-betell"),
  sol("s20", "2026-10-18", "23:30", "cl-pino", "c-vela", 2000, "PENDIENTE", "u-mlopez"),
  // Earlier October. s26 = same client DMR, same 7,540, different empresa and serie A.
  sol("s21", "2026-10-14", "10:00", "cl-dmr", "c-acier", 12000, "PAGADA", "u-ebasor"),
  sol("s22", "2026-10-02", "11:00", "cl-ocean", "c-norte", 14250, "PAGADA", "u-betell"),
  sol("s23", "2026-10-09", "12:00", "cl-ocean", "c-acier", 7450, "PROCESANDO", "u-vtenorio"),
  sol("s24", "2026-10-01", "00:30", "cl-nicol", "c-lumen", 4400, "PAGADA", "u-jramirez"),
  sol("s25", "2026-09-30", "22:00", "cl-ocean", "c-vela", 6000, "PAGADA", "u-betell"), // 1-oct UTC, but September
  sol("s26", "2026-10-15", "12:00", "cl-dmr", "c-norte", 7540, "PENDIENTE", "u-betell", { folio: "S7C318UF2", facturaSerie: "A", facturaFolio: "48207" }),
  sol("s27", "2026-10-16", "12:00", "cl-cobre", "c-acier", 19999.99, "RECHAZADA", "u-mlopez"),
  sol("s28", "2026-10-12", "12:00", "cl-alfa", "c-orbita", 2750, "PAGADA", "u-vtenorio"),
  sol("s40", "2026-10-05", "12:00", "cl-sismo", "c-acier", 7450, "PROCESANDO", "u-betell"),
  // Deleted duplicate of the target (same client, empresa, amount; folio prefix S7C318UE).
  sol("s39", "2026-10-20", "12:00", "cl-dmr", "c-acier", 7540, "PENDIENTE", "u-ebasor", { folio: "S7C318UE5", isDeleted: true }),
  // September.
  sol("s29", "2026-09-24", "12:00", "cl-nicol", "c-lumen", 33000, "PAGADA", "u-ebasor"),
  sol("s30", "2026-09-15", "12:00", "cl-sismo", "c-norte", 11000, "PAGADA", "u-betell"),
  sol("s31", "2026-09-03", "12:00", "cl-brisa", "c-acier", 7450, "PAGADA", "u-jramirez"),
  sol("s32", "2026-09-28", "12:00", "cl-pino", "c-vela", 8800, "RECHAZADA", "u-mlopez"),
  sol("s33", "2026-09-10", "12:00", "cl-segur", "c-acier", 26000, "PAGADA", "u-vtenorio"),
  sol("s34", "2026-09-19", "12:00", "cl-ocean", "c-orbita", 5500, "PAGADA", "u-ebasor"),
  // August. s07 is the large old rejected one the model confused with "the latest" (case 20).
  sol("s07", "2026-08-31", "12:00", "cl-alfa", "c-acier", 388120.4, "RECHAZADA", "u-betell"),
  sol("s35", "2026-08-20", "12:00", "cl-cobre", "c-norte", 9100, "PAGADA", "u-betell"),
  sol("s36", "2026-08-11", "12:00", "cl-nicol", "c-acier", 17600, "PAGADA", "u-vtenorio"),
  sol("s37", "2026-08-05", "12:00", "cl-alfa", "c-vela", 3900, "PAGADA", "u-mlopez"),
  sol("s38", "2026-08-27", "12:00", "cl-dmr", "c-lumen", 22000, "PAGADA", "u-jramirez"),
];

const CONCILIADOS = new Set(["CONCILIADO", "APLICADO_PARCIAL", "APLICADO_TOTAL"]);
function pago(id, fp, fpHm, cr, crHm, cl, co, monto, status, by) {
  const n = Number(id.slice(1));
  const user = userById[by];
  const aplicado = status === "APLICADO_PARCIAL" ? Math.round(monto * 50) / 100 : CONCILIADOS.has(status) ? monto : 0;
  return {
    id, folio: `P4C${200 + n}U${n % 5}E2`, clienteNombre: clientById[cl].name, clienteId: cl,
    empresaNombre: companyById[co].nombre, companyId: co, payerName: clientById[cl].name,
    montoTotal: monto, moneda: "MXN", status, fechaPago: at(fp, fpHm), createdAt: at(cr, crHm),
    createdBy: user.id, createdByUsername: user.nombreUsuario,
    montoAplicado: aplicado, montoDisponible: Math.round((monto - aplicado) * 100) / 100, rootId: ROOT,
  };
}
const PAGOS = [
  pago("p01", HOY, "12:30", HOY, "13:00", "cl-cobre", "c-orbita", 28640.25, "PENDIENTE", "u-jramirez"),
  pago("p02", "2026-10-23", "10:00", AYER, "18:30", "cl-alfa", "c-lumen", 9150, "PENDIENTE", "u-mlopez"), // received 23, registered 26
  pago("p03", "2026-10-20", "11:00", "2026-10-20", "11:30", "cl-segur", "c-lumen", 44000, "CONCILIADO", "u-betell"),
  pago("p04", "2026-09-10", "12:00", "2026-09-10", "12:00", "cl-segur", "c-acier", 26000, "APLICADO_TOTAL", "u-vtenorio"),
  pago("p05", "2026-09-24", "10:00", "2026-09-24", "10:05", "cl-nicol", "c-lumen", 33000, "APLICADO_TOTAL", "u-ebasor"),
  pago("p06", "2026-09-24", "15:00", "2026-09-24", "15:05", "cl-brisa", "c-acier", 7450, "PENDIENTE", "u-betell"),
  pago("p07", "2026-09-24", "23:30", "2026-09-24", "23:40", "cl-sismo", "c-norte", 11000, "CONCILIADO", "u-jramirez"),
  pago("p08", "2026-09-25", "00:30", "2026-09-25", "00:35", "cl-ocean", "c-orbita", 5500, "CONCILIADO", "u-ebasor"),
  pago("p09", "2026-09-23", "23:00", "2026-09-23", "23:05", "cl-pino", "c-acier", 1200, "APLICADO_PARCIAL", "u-mlopez"),
  pago("p10", "2026-10-22", "12:00", "2026-10-22", "12:10", "cl-ocean", "c-acier", 21500, "POR_CONCILIAR", "u-vtenorio"),
  pago("p11", "2026-10-25", "23:40", "2026-10-25", "23:45", "cl-brisa", "c-vela", 1000, "PENDIENTE", "u-jramirez"),
  pago("p12", "2026-10-18", "23:30", "2026-10-18", "23:35", "cl-pino", "c-vela", 2000, "CONCILIADO", "u-mlopez"),
  pago("p13", AYER, "11:00", AYER, "11:10", "cl-alfa", "c-acier", 12345.67, "CONCILIADO", "u-ebasor"),
  pago("p14", AYER, "14:00", AYER, "14:10", "cl-brisa", "c-norte", 6200, "PENDIENTE", "u-vtenorio"),
  pago("p15", AYER, "16:00", AYER, "16:10", "cl-cobre", "c-orbita", 52000, "APLICADO_PARCIAL", "u-vtenorio"),
  pago("p16", "2026-10-14", "12:00", "2026-10-14", "12:10", "cl-dmr", "c-acier", 12000, "PENDIENTE", "u-jramirez"),
  pago("p17", "2026-10-02", "12:00", "2026-10-02", "12:10", "cl-ocean", "c-norte", 14250, "POR_CONCILIAR", "u-betell"),
  pago("p18", "2026-08-20", "12:00", "2026-08-20", "12:10", "cl-cobre", "c-norte", 9100, "CONCILIADO", "u-betell"),
  pago("p19", "2026-09-03", "12:00", "2026-09-03", "12:10", "cl-brisa", "c-acier", 7450, "APLICADO_TOTAL", "u-jramirez"),
  pago("p20", "2026-10-09", "12:00", "2026-10-09", "12:10", "cl-ocean", "c-acier", 7450, "CONCILIADO", "u-vtenorio"),
];

const UPLOADS = [
  { id: "up1", solicitudId: TARGET_ID, documentType: "ORDEN_COMPRA", documentTypeLabel: "Orden de compra", originalName: "OC-DMR-octubre.xlsx", status: "PROCESSED", active: true, createdAt: at("2026-10-23", "12:20"), rootId: ROOT },
  { id: "up2", solicitudId: TARGET_ID, documentType: "COTIZACION", documentTypeLabel: "Cotizacion", originalName: "cotizacion-borrador.pdf", status: "FAILED", active: true, createdAt: at("2026-10-23", "12:40"), rootId: ROOT },
  { id: "up3", solicitudId: "s13", documentType: "FACTURA_PDF", documentTypeLabel: "Factura PDF", originalName: "factura-s13.pdf", status: "PROCESSED", active: true, createdAt: at("2026-10-20", "11:30"), rootId: ROOT },
];

const BASE = { solicitudes: SOLICITUDES, pagos: PAGOS, users: USERS, clients: CLIENTS, companies: COMPANIES, uploads: UPLOADS, now: NOW };
const DELETED = new Set(SOLICITUDES.filter(row => row.isDeleted).map(row => row.id));
const LIVE_SOLS = SOLICITUDES.filter(row => !row.isDeleted);

// Oracles computed directly from the fixture (independent of the implementation).
const solsWhere = pred => LIVE_SOLS.filter(pred);
const pagosWhere = pred => PAGOS.filter(pred);

// ---------------------------------------------------------------------------
// Tool invocation + generic contract checks
// ---------------------------------------------------------------------------
async function call(tool, input) {
  assert.equal(typeof lib[tool], "function", `search.js no exporta ${tool}`);
  const result = await lib[tool](structuredClone(BASE), input);
  assert.ok(result && typeof result === "object", `${tool} devolvio ${result}`);
  if (tool === "findSolicitudes" || tool === "findPagos") {
    assert.equal(typeof result.total, "number", `${tool}.total no es numero`);
    assert.equal(typeof result.montoTotal, "number", `${tool}.montoTotal no es numero`);
    assert.ok(Array.isArray(result.items), `${tool}.items no es arreglo`);
    assert.equal(result.mostrados, result.items.length, `${tool}.mostrados != items.length`);
    assert.ok(Array.isArray(result.interpretacion), `${tool}.interpretacion no es arreglo`);
    assert.ok(result.filtros && typeof result.filtros === "object", `${tool}.filtros ausente`);
    if (input.soloConteo) assert.equal(result.items.length, 0, `${tool} con soloConteo devolvio items`);
    if (input.limite) assert.ok(result.items.length <= input.limite, `${tool} excedio limite`);
    for (const item of result.items) assert.ok(!DELETED.has(item.id), `${tool} devolvio fila borrada ${item.id}`);
  }
  if (tool === "getSolicitudDetail" && result.solicitud) {
    assert.ok(!DELETED.has(result.solicitud.id), `getSolicitudDetail devolvio fila borrada ${result.solicitud.id}`);
  }
  if (tool === "findPeople") assert.ok(Array.isArray(result.coincidencias), "findPeople.coincidencias no es arreglo");
  return result;
}

function note(result, campo) {
  return (result.interpretacion || []).find(row => norm(row.campo) === norm(campo));
}
function assertApprox(result, campo, expectedName) {
  const n = note(result, campo);
  assert.ok(n, `interpretacion sin nota para "${campo}": ${JSON.stringify(result.interpretacion)}`);
  assert.equal(n.confianza, "APROXIMADA", `"${campo}" debio marcarse APROXIMADA: ${JSON.stringify(n)}`);
  if (expectedName) assert.match(norm(n.entendido), new RegExp(norm(expectedName)), `"${campo}" se entendio como ${JSON.stringify(n.entendido)}`);
  return n;
}
const ids = result => result.items.map(item => item.id);
const sameIds = (result, expected, msg) => assert.deepEqual([...ids(result)].sort(), [...expected].sort(), msg);
const isUser = (value, userId) => {
  const u = userById[userId];
  return [u.id, u.nombreUsuario, u.displayName, u.email].some(x => norm(value).includes(norm(x)));
};
const firstPerson = (result, tipo) => result.coincidencias.find(row => !tipo || row.tipo === tipo);

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const CASES = [];
function caseFn(n, description, fn) { CASES.push({ n, description, fn }); }
function skip(n, description, reason) { CASES.push({ n, description, reason }); }

// ===========================================================================
// A. Datos incompletos
// ===========================================================================
caseFn(1, "Quien hizo la ultima solicitud y de que monto", async () => {
  // findSolicitudes({orden:"RECIENTES", limite:1})
  const r = await call("findSolicitudes", { orden: "RECIENTES", limite: 1 });
  assert.equal(r.total, LIVE_SOLS.length, "total debe contar todas las solicitudes vivas");
  const it = r.items[0];
  assert.equal(it.id, "s04", `la ultima solicitud viva es s04 (s05 esta borrada), llego ${it.id}`);
  assert.match(norm(it.cliente), /servicios sismicos/);
  assert.equal(cents(it.monto), cents(23100.5));
  assert.match(norm(it.estado), /pendiente/);
  assert.equal(mxDay(it.fecha), HOY);
  assert.match(norm(it.empresa), /lumen/);
  assert.ok(isUser(it.creadoPor, "u-betell"), `creadoPor=${it.creadoPor}`);
});

caseFn(2, "Ultimo pago: cliente, fecha y monto", async () => {
  // findPagos({orden:"RECIENTES", limite:1})
  const r = await call("findPagos", { orden: "RECIENTES", limite: 1 });
  assert.equal(r.total, PAGOS.length);
  const it = r.items[0];
  assert.equal(it.id, "p01");
  assert.match(norm(it.cliente), /cobre y metales/);
  assert.equal(mxDay(it.fechaPago), HOY, "debe incluir fechaPago");
  assert.equal(cents(it.monto), cents(28640.25));
  assert.match(norm(it.empresa), /orbita/);
  assert.equal(it.conciliado, false);
});

caseFn(3, "A quien le pago 'Asegurentas' (empresa receptora)", async () => {
  // findPagos({cliente:"Asegurentas", orden:"RECIENTES", limite:5})
  const r = await call("findPagos", { cliente: "Asegurentas", orden: "RECIENTES", limite: 5 });
  sameIds(r, ["p03", "p04"], "pagos de SEGURENTAS DEL BAJIO");
  assert.equal(r.items[0].id, "p03");
  assert.match(norm(r.items[0].empresa), /lumen servicios integrales/, "empresa receptora del ultimo pago");
  assert.match(norm(r.items[1].empresa), /acier capital/);
  assertApprox(r, "cliente", "segurentas");
  const p = await call("findPeople", { texto: "Asegurentas", tipo: "CLIENTE" });
  assert.equal(firstPerson(p, "CLIENTE")?.id, "cl-segur");
});

caseFn(4, "Montos de este mes del cliente 'Ocean Spill' (desglose por cliente)", async () => {
  // findSolicitudes({cliente:"Ocean Spill", desde:"2026-10-01", hasta:"2026-10-31", limite:20})
  const r = await call("findSolicitudes", { cliente: "Ocean Spill", ...ESTE_MES, limite: 20 });
  const expected = solsWhere(s => s.clienteId === "cl-ocean" && inRange(mxDay(s.createdAt), ESTE_MES));
  sameIds(r, expected.map(s => s.id), "solicitudes de Ocean Spill en octubre (s25 es 30-sep local)");
  assert.equal(r.total, 4);
  assert.equal(cents(r.montoTotal), cents(53000));
  for (const it of r.items) assert.match(norm(it.cliente), /ocean spill/);
  // NOTE: the contract has no utilidad/comision field; "utilidades" can only be
  // approximated by monto. See report.
});

caseFn(5, "Los 40 mil eran de todos o solo de un cliente (filtros reflejan alcance)", async () => {
  // findSolicitudes({desde,hasta,soloConteo:true}) vs findSolicitudes({cliente:"Ocean Spill",desde,hasta,soloConteo:true})
  const all = await call("findSolicitudes", { ...ESTE_MES, soloConteo: true });
  const one = await call("findSolicitudes", { cliente: "Ocean Spill", ...ESTE_MES, soloConteo: true });
  const expectedAll = solsWhere(s => inRange(mxDay(s.createdAt), ESTE_MES));
  assert.equal(all.total, expectedAll.length);
  assert.equal(cents(all.montoTotal), cents(sum(expectedAll.map(s => s.monto))));
  assert.ok(one.montoTotal < all.montoTotal);
  assert.ok(!Object.keys(all.filtros).some(k => norm(k) === "cliente") || all.filtros.cliente == null, `filtros generales no deben llevar cliente: ${JSON.stringify(all.filtros)}`);
  assert.ok(one.filtros.cliente != null, `filtros por cliente deben llevar cliente: ${JSON.stringify(one.filtros)}`);
});

// ===========================================================================
// B. Contradicciones entre herramientas
// ===========================================================================
caseFn(6, "Ultimo pago de 'Betel' y luego su monto/empresa por folio: mismo registro", async () => {
  // findPagos({creadoPor:"Betel", orden:"RECIENTES", limite:1}) -> findPagos({folio:<folio>})
  const r = await call("findPagos", { creadoPor: "Betel", orden: "RECIENTES", limite: 1 });
  const first = r.items[0];
  assert.equal(first?.id, "p03", `ultimo pago de BETELL es p03, llego ${first?.id}`);
  assertApprox(r, "creadoPor", "betell");
  const again = await call("findPagos", { folio: first.folio, limite: 1 });
  assert.equal(again.total, 1, "buscar por el folio devuelto debe encontrar exactamente ese pago");
  const it = again.items[0];
  assert.equal(it.id, first.id);
  assert.equal(cents(it.monto), cents(first.monto));
  assert.equal(it.empresa, first.empresa);
  assert.equal(it.cliente, first.cliente);
  assert.match(norm(it.empresa), /lumen/);
  assert.equal(cents(it.monto), cents(44000));
});

// ===========================================================================
// C. Identificar personas y entidades por voz
// ===========================================================================
caseFn(7, "Usuario 'Evasor' / 'E-B-A-S-O-R' / 'ese va sor' -> EBASOR", async () => {
  for (const texto of ["Evasor", "E-B-A-S-O-R", "Basov", "ese va sor", "ebasor@pay0.test"]) {
    const p = await call("findPeople", { texto, tipo: "USUARIO" });
    assert.equal(firstPerson(p, "USUARIO")?.id, "u-ebasor", `"${texto}" debio resolver a EBASOR: ${JSON.stringify(p.coincidencias.slice(0, 3))}`);
  }
  const betel = await call("findPeople", { texto: "Betel", tipo: "USUARIO" });
  assert.equal(firstPerson(betel, "USUARIO")?.id, "u-betell");
  // findPagos({creadoPor:"Evasor", orden:"RECIENTES", limite:1})
  const r = await call("findPagos", { creadoPor: "Evasor", orden: "RECIENTES", limite: 1 });
  assert.equal(r.items[0]?.id, "p13", "ultimo pago capturado por EBASOR");
  assert.equal(r.total, pagosWhere(p => p.createdBy === "u-ebasor").length);
  assertApprox(r, "creadoPor", "ebasor");
  const exact = await call("findPagos", { creadoPor: "EBASOR", soloConteo: true });
  assert.equal(note(exact, "creadoPor")?.confianza, "EXACTA", "username exacto debe ser EXACTA");
  // Negative: clearly unrelated names do not match anyone.
  const none = await call("findPeople", { texto: "Zacarias Quintanilla", tipo: "USUARIO" });
  assert.equal(none.coincidencias.length, 0, `nombre ajeno no debe coincidir: ${JSON.stringify(none.coincidencias)}`);
  if (typeof lib.fuzzyScore === "function") {
    assert.ok(lib.fuzzyScore("Evasor", "EBASOR") > lib.fuzzyScore("Evasor", "BETELL"), "fuzzyScore Evasor: EBASOR > BETELL");
    assert.ok(lib.fuzzyScore("Betel", "BETELL") > lib.fuzzyScore("Betel", "EBASOR"), "fuzzyScore Betel: BETELL > EBASOR");
  } else assert.fail("search.js no exporta fuzzyScore");
});

caseFn(8, "Solicitudes creadas por 'Basov' vs las de 'Betel' (creador, no dashboard)", async () => {
  // findSolicitudes({creadoPor:"Basov", limite:20}) and findSolicitudes({creadoPor:"Betel", limite:20})
  const a = await call("findSolicitudes", { creadoPor: "Basov", limite: 20 });
  const b = await call("findSolicitudes", { creadoPor: "Betel", limite: 20 });
  const expA = solsWhere(s => s.createdBy === "u-ebasor");
  const expB = solsWhere(s => s.createdBy === "u-betell");
  sameIds(a, expA.map(s => s.id), "solicitudes de EBASOR");
  sameIds(b, expB.map(s => s.id), "solicitudes de BETELL");
  for (const it of a.items) assert.ok(isUser(it.creadoPor, "u-ebasor"), `creadoPor=${it.creadoPor}`);
  for (const it of b.items) assert.ok(isUser(it.creadoPor, "u-betell"), `creadoPor=${it.creadoPor}`);
  assert.equal(ids(a).filter(id => ids(b).includes(id)).length, 0, "creadores no deben mezclarse");
  assertApprox(a, "creadoPor", "ebasor");
});

// ===========================================================================
// D. Filtros: fecha, monto, conteo
// ===========================================================================
caseFn(9, "Movimientos de la semana pasada (lista, no solo el ultimo)", async () => {
  // findSolicitudes({desde:"2026-10-19",hasta:"2026-10-25",limite:20}) + findPagos(same)
  const s = await call("findSolicitudes", { ...SEMANA_PASADA, limite: 20 });
  const expS = solsWhere(x => inRange(mxDay(x.createdAt), SEMANA_PASADA));
  sameIds(s, expS.map(x => x.id), "solicitudes 19..25 oct (s19 23:50 incluida, s20 18-oct excluida)");
  assert.equal(s.total, 8);
  for (const it of s.items) assert.ok(inRange(mxDay(it.fecha), SEMANA_PASADA), `fecha fuera de rango ${it.fecha}`);
  const p = await call("findPagos", { ...SEMANA_PASADA, limite: 20 });
  sameIds(p, ["p02", "p03", "p10", "p11"], "pagos con fechaPago 19..25 oct (p02 registrado el 26 cuenta por fechaPago)");
  for (const it of p.items) assert.ok(inRange(mxDay(it.fechaPago), SEMANA_PASADA));
});

caseFn(10, "Pagos recibidos el 24 de septiembre (filtro por dia, hora Mexico)", async () => {
  // findPagos({desde:"2026-09-24", hasta:"2026-09-24", limite:20})
  const r = await call("findPagos", { desde: "2026-09-24", hasta: "2026-09-24", limite: 20 });
  sameIds(r, ["p05", "p06", "p07"], "p07 23:30 local incluido; p08 (25 00:30) y p09 (23 23:00) excluidos");
  assert.equal(r.total, 3);
  assert.equal(cents(r.montoTotal), cents(33000 + 7450 + 11000));
  for (const it of r.items) assert.equal(mxDay(it.fechaPago), "2026-09-24");
});

caseFn(11, "Conteo de solicitudes y pagos de ayer por usuario ebasor y 'vten'", async () => {
  // 4 calls: find{Solicitudes,Pagos}({creadoPor, desde:AYER, hasta:AYER, soloConteo:true})
  const day = { desde: AYER, hasta: AYER };
  const expect = {
    ebasor: { sol: solsWhere(s => s.createdBy === "u-ebasor" && mxDay(s.createdAt) === AYER).length, pag: pagosWhere(p => p.createdBy === "u-ebasor" && mxDay(p.fechaPago) === AYER).length },
    vten: { sol: solsWhere(s => s.createdBy === "u-vtenorio" && mxDay(s.createdAt) === AYER).length, pag: pagosWhere(p => p.createdBy === "u-vtenorio" && mxDay(p.fechaPago) === AYER).length },
  };
  assert.deepEqual(expect, { ebasor: { sol: 2, pag: 1 }, vten: { sol: 2, pag: 2 } }, "fixture sanity");
  for (const who of ["ebasor", "vten"]) {
    const s = await call("findSolicitudes", { creadoPor: who, ...day, soloConteo: true });
    const p = await call("findPagos", { creadoPor: who, ...day, soloConteo: true });
    assert.equal(s.total, expect[who].sol, `solicitudes de ayer por ${who}`);
    assert.equal(p.total, expect[who].pag, `pagos de ayer por ${who}`);
  }
  const vten = await call("findPeople", { texto: "vten", tipo: "USUARIO" });
  assert.equal(firstPerson(vten, "USUARIO")?.id, "u-vtenorio");
});

caseFn(12, "Cuantas solicitudes de 7,450 pesos (no confundir con 7,540)", async () => {
  // findSolicitudes({monto:7450, soloConteo:true})
  const r = await call("findSolicitudes", { monto: 7450, soloConteo: true });
  const exp = solsWhere(s => s.monto === 7450);
  assert.equal(exp.length, 5, "fixture sanity");
  assert.equal(r.total, 5, "5 vivas; s05 borrada no cuenta; 7,540 no cuenta");
  assert.equal(cents(r.montoTotal), cents(5 * 7450));
  const list = await call("findSolicitudes", { monto: 7450, limite: 20 });
  for (const it of list.items) assert.equal(cents(it.monto), cents(7450));
});

caseFn(13, "Cuantas solicitudes hubo hoy (total completo aunque limite sea 1)", async () => {
  // findSolicitudes({desde:HOY, hasta:HOY, soloConteo:true}) and limite:1
  const r = await call("findSolicitudes", { desde: HOY, hasta: HOY, soloConteo: true });
  assert.equal(r.total, 4, "s01..s04; s05 borrada y s06 (26-oct 23:30 local) no cuentan");
  const small = await call("findSolicitudes", { desde: HOY, hasta: HOY, limite: 1 });
  assert.equal(small.total, 4, "total no es una muestra");
  assert.equal(small.mostrados, 1);
  assert.equal(cents(small.montoTotal), cents(7450 + 31000 + 9800 + 23100.5));
});

caseFn(14, "Pagos pendientes de conciliar: todos, no solo los ultimos 5", async () => {
  // findPagos({conciliado:false, limite:5})
  const r = await call("findPagos", { conciliado: false, limite: 5 });
  const exp = pagosWhere(p => !CONCILIADOS.has(p.status));
  assert.equal(exp.length, 8, "fixture sanity");
  assert.equal(r.total, 8);
  assert.equal(r.items.length, 5);
  assert.equal(cents(r.montoTotal), cents(sum(exp.map(p => p.montoTotal))));
  for (const it of r.items) assert.equal(it.conciliado, false);
  const yes = await call("findPagos", { conciliado: true, soloConteo: true });
  assert.equal(yes.total, PAGOS.length - 8, "APLICADO_PARCIAL/APLICADO_TOTAL/CONCILIADO cuentan como conciliado");
});

// ===========================================================================
// E. Buscar una solicitud por descripcion humana
// ===========================================================================
caseFn(15, "Cliente 'Desarrollo y construcciones de MR', proveedor 'Aser Capital', 7,540: como va su cotizacion", async () => {
  // findSolicitudes({cliente:"Desarrollo y construcciones de MR", empresa:"Aser Capital", monto:7540})
  const r = await call("findSolicitudes", { cliente: "Desarrollo y construcciones de MR", empresa: "Aser Capital", monto: 7540 });
  assert.equal(r.total, 1, `debe ser exactamente s16 (s26 es otra empresa, s15 otro cliente, s39 borrada); llego ${JSON.stringify(ids(r))}`);
  const it = r.items[0];
  assert.equal(it.id, TARGET_ID);
  assert.equal(it.cotizacion, "FAILED_RETRYABLE", "estado de cotizacion en el item");
  assert.match(norm(it.cliente), /dmr/);
  assert.match(norm(it.empresa), /acier capital/);
  assertApprox(r, "cliente", "dmr");
  assertApprox(r, "empresa", "acier capital");
  // Other spoken variants of the same entities.
  for (const [cliente, empresa] of [["Desarrollo y construccion de MR", "Acier"], ["DMR", "ACR Capital"], ["desarrollo y construcciones DMR", "ACIER Capital"]]) {
    const v = await call("findSolicitudes", { cliente, empresa, monto: 7540 });
    assert.deepEqual(ids(v), [TARGET_ID], `variante cliente="${cliente}" empresa="${empresa}"`);
  }
  // Without amount: all live DMR+ACIER rows, never the unrelated CONSTRUCCIONES DEL MAYAB.
  const noAmount = await call("findSolicitudes", { cliente: "Desarrollo y construcciones de MR", empresa: "Aser Capital", limite: 20 });
  sameIds(noAmount, ["s16", "s21"], "DMR + ACIER sin monto");
  // Negative: unrelated name -> total 0 with sugerencias, not an error.
  const none = await call("findSolicitudes", { cliente: "Zacarias Quintanilla Hermanos", limite: 5 });
  assert.equal(none.total, 0);
  assert.equal(none.items.length, 0);
  assert.ok(Array.isArray(none.sugerencias), "total 0 debe traer sugerencias (arreglo)");
  // Deleted duplicate is unreachable by id too.
  const del = await call("getSolicitudDetail", { id: "s39" });
  assert.equal(del.encontrada, false, "solicitud borrada no debe encontrarse por id");
  assert.ok(lib.fuzzyScore("Aser Capital", "ACIER CAPITAL") > lib.fuzzyScore("Aser Capital", "ORBITA CONSULTORES"));
  assert.ok(lib.fuzzyScore("Desarrollo y construcciones de MR", "DESARROLLO Y CONSTRUCCIONES DMR SA DE CV") > lib.fuzzyScore("Desarrollo y construcciones de MR", "CONSTRUCCIONES DEL MAYAB SA DE CV"));
});

caseFn(16, "Busqueda por folio dictado ('S7C318UE...', palabras, espacios)", async () => {
  assert.equal(lib.normalizeSpokenFolio("s siete c trescientos dieciocho u e cuatro"), "S7C318UE4");
  assert.equal(lib.normalizeSpokenFolio("S 7 C 318 U E 4"), "S7C318UE4");
  assert.equal(lib.normalizeSpokenFolio("s7c318ue4"), "S7C318UE4");
  // findSolicitudes({folio:"S7C318UE4"})
  const exact = await call("findSolicitudes", { folio: "S7C318UE4" });
  assert.deepEqual(ids(exact), [TARGET_ID]);
  assert.equal(note(exact, "folio")?.confianza ?? "EXACTA", "EXACTA");
  // Truncated prefix the user actually gave ("S7C318UE..."): s39 is deleted, s26 is UF2.
  const prefix = await call("findSolicitudes", { folio: "S7C318UE" });
  assert.deepEqual(ids(prefix), [TARGET_ID]);
  // getSolicitudDetail({folio:"s siete c trescientos dieciocho u e cuatro"})
  const d = await call("getSolicitudDetail", { folio: "s siete c trescientos dieciocho u e cuatro" });
  assert.equal(d.encontrada, true);
  assert.equal(d.solicitud.id, TARGET_ID);
  assert.equal(d.solicitud.folio, "S7C318UE4");
});

caseFn(17, "Cliente DMR, empresa 'Aser Capital', metodo PUE, factura Z48207, 7,540 (es consulta, no instruccion)", async () => {
  // findSolicitudes({cliente:"DMR", empresa:"Aser Capital", factura:"Z48207", monto:7540})
  const r = await call("findSolicitudes", { cliente: "DMR", empresa: "Aser Capital", factura: "Z48207", monto: 7540 });
  assert.deepEqual(ids(r), [TARGET_ID]);
  const it = r.items[0];
  assert.match(String(it.factura), /48207/);
  assert.equal(it.metodoPago, "PUE", "metodoPago debe venir de tipoFactura");
  // Serie+folio matters: "Z48207" must not match s26 (serie A, folio 48207, DMR, 7,540).
  const facturaOnly = await call("findSolicitudes", { factura: "Z48207", limite: 20 });
  assert.deepEqual(ids(facturaOnly), [TARGET_ID], "factura Z48207 = serie Z + folio 48207");
  const facturaFolio = await call("findSolicitudes", { factura: "48207", limite: 20 });
  sameIds(facturaFolio, ["s16", "s26"], "solo el folio 48207 coincide con ambas series");
});

caseFn(18, "'La fecha fue el 23 de octubre' acota la busqueda", async () => {
  // findSolicitudes({cliente:"Desarrollo y construcciones de MR", empresa:"Acier", desde:"2026-10-23", hasta:"2026-10-23"})
  const r = await call("findSolicitudes", { cliente: "Desarrollo y construcciones de MR", empresa: "Acier", desde: "2026-10-23", hasta: "2026-10-23" });
  assert.deepEqual(ids(r), [TARGET_ID]);
  assert.equal(mxDay(r.items[0].fecha), "2026-10-23");
  const d = await call("getSolicitudDetail", { id: TARGET_ID });
  assert.equal(mxDay(d.solicitud.facturaFecha), "2026-10-23");
});

// ===========================================================================
// F. Contexto de la conversacion
// ===========================================================================
caseFn(19, "Tras encontrar la solicitud DMR: 'Analiza la OC' (encadenar por id)", async () => {
  const found = await call("findSolicitudes", { cliente: "Desarrollo y construcciones de MR", empresa: "Aser Capital", monto: 7540 });
  const id = found.items[0]?.id;
  assert.equal(id, TARGET_ID);
  // getSolicitudDetail({id})
  const d = await call("getSolicitudDetail", { id });
  assert.equal(d.encontrada, true);
  const s = d.solicitud;
  assert.ok(s.oc, "detalle debe traer la OC");
  assert.match(norm(s.oc.cliente), /desarrollo y construcciones dmr/);
  assert.equal(cents(s.oc.total), cents(7540));
  assert.equal(cents(s.oc.subtotal), cents(6500));
  assert.equal(cents(s.oc.iva), cents(1040));
  assert.equal(s.oc.partidas.length, 2);
  assert.deepEqual(s.oc.partidas.map(p => [p.cantidad, p.descripcion]), [[10, "Saco de cemento gris 50 kg"], [4, "Varilla corrugada 3/8 x 12 m"]]);
  if (s.oc.rfc != null) assert.equal(s.oc.rfc, "DCD010101AA1");
  const tipos = s.documentos.map(doc => norm(doc.tipo));
  assert.ok(tipos.some(t => /orden|oc/.test(t)), `documentos sin OC: ${JSON.stringify(s.documentos)}`);
  assert.ok(tipos.some(t => /cotizacion/.test(t)), "documentos sin COTIZACION");
  assert.ok(!s.documentos.some(doc => /factura-s13/.test(String(doc.nombre))), "no debe mezclar documentos de otra solicitud");
  assert.equal(s.cotizacionDetalle?.estado, "FAILED_RETRYABLE");
  assert.equal(s.cotizacionDetalle?.etapa, "RENDER_PDF");
  assert.equal(s.metodoPago, "PUE");
  assert.equal(cents(s.totalFactura), cents(7540));
  assert.equal(s.facturaUuid, "0F1E2D3C-4B5A-4968-8776-A5B4C3D2E1F0");
});

caseFn(20, "Ultimo cliente que hizo solicitud -> 'estado y monto' de ESA solicitud", async () => {
  const last = await call("findSolicitudes", { orden: "RECIENTES", limite: 1 });
  const id = last.items[0]?.id;
  assert.equal(id, "s04");
  assert.match(norm(last.items[0].cliente), /servicios sismicos/);
  // getSolicitudDetail({id}) - must be the same record, never the large old rejected s07.
  const d = await call("getSolicitudDetail", { id });
  assert.equal(d.solicitud.id, "s04");
  assert.equal(d.solicitud.cliente, last.items[0].cliente);
  assert.equal(cents(d.solicitud.monto), cents(23100.5));
  assert.match(norm(d.solicitud.estado), /pendiente/);
  assert.equal(mxDay(d.solicitud.fecha), HOY);
  assert.notEqual(cents(d.solicitud.monto), cents(388120.4));
});

caseFn(21, "'Esa no puede ser la ultima': orden RECIENTES verificable", async () => {
  // findSolicitudes({orden:"RECIENTES", limite:20}) / ANTIGUAS / MONTO_DESC
  const r = await call("findSolicitudes", { orden: "RECIENTES", limite: 20 });
  const sorted = [...LIVE_SOLS].sort((a, b) => b.createdAt - a.createdAt);
  assert.deepEqual(ids(r), sorted.slice(0, 20).map(s => s.id), "orden descendente por createdAt");
  for (let i = 1; i < r.items.length; i += 1) assert.ok(mxDay(r.items[i - 1].fecha) >= mxDay(r.items[i].fecha), "fechas no descendentes");
  const old = await call("findSolicitudes", { orden: "ANTIGUAS", limite: 1 });
  assert.equal(old.items[0].id, "s37");
  const big = await call("findSolicitudes", { orden: "MONTO_DESC", limite: 1 });
  assert.equal(big.items[0].id, "s07", "la mayor (rechazada de agosto) no es la ultima");
  assert.notEqual(r.items[0].id, big.items[0].id);
});

skip(22, "Cuando fue la ultima vez que hablamos", "memoria entre sesiones: no es una herramienta de lectura de solicitudes/pagos/personas");
skip(23, "Rellenos, respuestas largas, cambio a ingles, tono", "estilo del modelo de voz; se valida en el prompt/gateway, no en las herramientas");

caseFn(24, "'Este mes' = octubre (rango de dias en hora Mexico, sin pedir AAAA-MM-DD)", async () => {
  const range = lib.mexicoDayRange("2026-10-01", "2026-10-31");
  const pick = (obj, keys) => keys.map(k => obj?.[k]).find(v => v != null);
  const [a, b] = Array.isArray(range) ? range : [pick(range, ["fromMs", "start", "desde", "from", "gte", "startMs"]), pick(range, ["toMs", "end", "hasta", "to", "lt", "lte", "endMs"])];
  const start = toDate(a).getTime();
  const end = toDate(b).getTime();
  assert.equal(start, Date.UTC(2026, 9, 1, 6, 0, 0), "inicio = 1-oct 00:00 hora Mexico");
  const next = Date.UTC(2026, 10, 1, 6, 0, 0);
  assert.ok(end <= next && end >= next - 1000, `fin debe ser 1-nov 00:00 Mexico (exclusivo) o justo antes; llego ${new Date(end).toISOString()}`);
  const day = lib.mexicoDayRange(HOY, HOY);
  const [da] = Array.isArray(day) ? day : [pick(day, ["fromMs", "start", "desde", "from", "gte", "startMs"])];
  assert.equal(toDate(da).getTime(), Date.UTC(2026, 9, 27, 6, 0, 0));
  // The tool call the model makes for "este mes":
  const r = await call("findSolicitudes", { ...ESTE_MES, soloConteo: true });
  assert.ok(!ids(r).includes("s25"));
  assert.equal(r.total, solsWhere(s => inRange(mxDay(s.createdAt), ESTE_MES)).length);
});

skip(25, "PDF de montos de San Nicolas de septiembre", "generar PDF no es una herramienta de lectura; los datos si se obtienen con findSolicitudes({cliente:'San Nicolas', desde:'2026-09-01', hasta:'2026-09-30'})");

// ===========================================================================
// Run + report
// ===========================================================================
(async () => {
  const rows = [];
  for (const c of CASES.sort((x, y) => x.n - y.n)) {
    if (!c.fn) { rows.push({ n: c.n, description: c.description, status: "SKIP", detail: c.reason }); continue; }
    try {
      await c.fn();
      rows.push({ n: c.n, description: c.description, status: "PASS", detail: "" });
    } catch (error) {
      rows.push({ n: c.n, description: c.description, status: "FAIL", detail: String(error && error.message || error).split("\n").slice(0, 6).join(" | ") });
    }
  }
  const w = Math.min(90, Math.max(...rows.map(r => r.description.length)));
  console.log(`\n${"#".padStart(3)}  ${"Caso".padEnd(w)}  Resultado`);
  console.log(`${"-".repeat(3)}  ${"-".repeat(w)}  ---------`);
  for (const r of rows) {
    console.log(`${String(r.n).padStart(3)}  ${r.description.slice(0, w).padEnd(w)}  ${r.status}`);
    if (r.status !== "PASS") console.log(`     ${r.status === "FAIL" ? "-> " : "   "}${r.detail}`);
  }
  const count = s => rows.filter(r => r.status === s).length;
  console.log(`\nPASS ${count("PASS")}  FAIL ${count("FAIL")}  SKIP ${count("SKIP")}  (total ${rows.length})`);
  process.exit(count("FAIL") ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
