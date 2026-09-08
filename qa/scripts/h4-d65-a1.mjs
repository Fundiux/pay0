import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const financialSource = read("functions/src/modules/deposits/financial.ts");
const foundationSource = read("functions/src/modules/deposits/foundation.ts");
const balanceSource = read("functions/src/modules/balances/service.ts");
const financingSource = read("functions/src/modules/financing/service.ts");
const ratesSource = read("functions/src/modules/rates/callables.ts");
const indexSource = read("functions/src/index.ts");
const operationTypeSource = read("functions/src/modules/rates/callables.ts");

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `No se encontro inicio de seccion: ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  assert.notEqual(end, -1, `No se encontro fin de seccion: ${endMarker}`);
  return source.slice(start, end);
}

function money2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function baseAmount(gross, baseType) {
  return baseType === "SUBTOTAL" ? money2(gross / 1.16) : money2(gross);
}

function amountFromRate(gross, rate, baseType, pricingMode) {
  return pricingMode === "FIXED"
    ? money2(rate)
    : money2(baseAmount(gross, baseType) * (money2(rate) / 100));
}

function calculateDistribution({
  gross,
  client,
  despacho,
  admin = null,
  operador = null,
  advancePending = 0,
}) {
  const clientCharge = amountFromRate(gross, client.rate, client.base, client.mode);
  const despachoCost = amountFromRate(gross, despacho.rate, despacho.base, despacho.mode);
  const adminBase = admin
    ? amountFromRate(gross, admin.rate, admin.base, admin.mode)
    : null;
  const operadorBase = operador
    ? amountFromRate(gross, operador.rate, operador.base, operador.mode)
    : null;

  let superadmin = 0;
  let adminEarning = 0;
  let operadorEarning = 0;

  if (operadorBase !== null) {
    if (adminBase !== null) {
      superadmin = money2(Math.max(0, adminBase - despachoCost));
      adminEarning = money2(Math.max(0, operadorBase - adminBase));
    } else {
      superadmin = money2(Math.max(0, operadorBase - despachoCost));
    }
    operadorEarning = money2(Math.max(0, clientCharge - operadorBase));
  } else if (adminBase !== null) {
    superadmin = money2(Math.max(0, adminBase - despachoCost));
    adminEarning = money2(Math.max(0, clientCharge - adminBase));
  } else {
    superadmin = money2(Math.max(0, clientCharge - despachoCost));
  }

  const clientNet = money2(gross - clientCharge);
  const advanceApplied = money2(Math.min(Math.max(0, advancePending), Math.max(0, clientNet)));
  const released = money2(clientNet - advanceApplied);

  return {
    gross: money2(gross),
    clientCharge,
    despachoCost,
    superadmin,
    admin: adminEarning,
    operador: operadorEarning,
    totalEarnings: money2(superadmin + adminEarning + operadorEarning),
    clientNet,
    advanceApplied,
    released,
  };
}

let passed = 0;
const findings = [];

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function finding(code, title, evidence) {
  findings.push({ code, title, evidence });
  console.log(`HALLAZGO ${code} ${title}`);
  console.log(`  Evidencia: ${evidence}`);
}

console.log("\n=== H4-D65-A1 | Auditoria del posteo financiero canonico ===");

test("el posteo completo vive dentro de una transaccion Firestore", () => {
  assert.match(financialSource, /return await db\.runTransaction\(async \(tx\) => \{/);
  assert.match(financialSource, /tx\.set\(snapshotRef,/);
  assert.match(financialSource, /tx\.set\(distributionRef,/);
  assert.match(financialSource, /tx\.set\(dispatchRef,/);
  assert.match(financialSource, /tx\.update\(pagoRef, \{/);
});

test("la compuerta POSTED evita duplicar saldo e ingresos", () => {
  const idempotencySection = section(
    financialSource,
    'const financialPostingStatus = asText(pago.financialPostingStatus).toUpperCase();',
    'if (asText(pago.status).toUpperCase() !== "CONCILIADO")',
  );
  assert.match(idempotencySection, /financialPostingStatus === "POSTED"/);
  assert.match(idempotencySection, /status: "POSTED"/);
});

test("solo un pago CONCILIADO puede postear movimientos", () => {
  assert.match(financialSource, /asText\(pago\.status\)\.toUpperCase\(\) !== "CONCILIADO"/);
  assert.match(financialSource, /status: "NOT_CONCILIATED"/);
});

test("wallet cliente se construye con bruto IN, comision OUT y adelanto OUT", () => {
  assert.match(financialSource, /movementType: "PAGO_RECIBIDO_BRUTO"/);
  assert.match(financialSource, /movementType: "COMISION_CLIENTE_COBRADA"/);
  assert.match(financialSource, /movementType: "ADELANTO_LIQUIDADO"/);
  assert.match(financialSource, /direction: "IN"[\s\S]{0,220}movementType: "PAGO_RECIBIDO_BRUTO"|movementType: "PAGO_RECIBIDO_BRUTO"[\s\S]{0,220}direction: "IN"/);
  assert.match(financialSource, /direction: "OUT"[\s\S]{0,240}movementType: "COMISION_CLIENTE_COBRADA"|movementType: "COMISION_CLIENTE_COBRADA"[\s\S]{0,240}direction: "OUT"/);
});

test("las utilidades de superadmin, admin y operador se separan", () => {
  for (const subtype of ["SUPERADMIN", "ADMIN", "OPERADOR"]) {
    assert.match(financialSource, new RegExp(`movementSubType: "${subtype}"`));
  }
  assert.match(financialSource, /movementType: "UTILIDAD_GENERADA"/);
});

test("los movimientos consecutivos usan el saldo actualizado en memoria", () => {
  assert.match(financialSource, /const balanceAccountReads = new Map/);
  assert.match(financialSource, /current: balanceAccountReads\.get\(accountKey\)/);
  assert.match(financialSource, /balanceAccountReads\.set\(accountKey, posted\.accountPatch\)/);
  assert.match(balanceSource, /availableBalance = money2\(movement\.afterBalance\)/);
});

test("un fallo de transaccion no deja posteo parcial y marca ERROR despues", () => {
  assert.match(financialSource, /catch \(error: any\) \{/);
  assert.match(financialSource, /await pagoRef\.set\(buildSkipPayload\("ERROR", message\), \{ merge: true \}\)/);
  assert.match(financialSource, /status: "ERROR"/);
});

test("el saldo liberado corresponde a neto menos adelantos pendientes", () => {
  assert.match(financingSource, /releasedAmount = money2\(amount - appliedAmount\)/);
  assert.match(financialSource, /walletClientAmount: clientReleasedAmount/);
  assert.match(financialSource, /retornoCliente: clientReleasedAmount/);

  const result = calculateDistribution({
    gross: 100000,
    client: { rate: 5, base: "TOTAL", mode: "PERCENT" },
    despacho: { rate: 1, base: "TOTAL", mode: "PERCENT" },
    advancePending: 20000,
  });
  assert.equal(result.clientNet, 95000);
  assert.equal(result.advanceApplied, 20000);
  assert.equal(result.released, 75000);
});

test("escenario solo superadmin conserva la diferencia cliente menos despacho", () => {
  const result = calculateDistribution({
    gross: 100000,
    client: { rate: 5, base: "TOTAL", mode: "PERCENT" },
    despacho: { rate: 1, base: "TOTAL", mode: "PERCENT" },
  });
  assert.deepEqual(
    {
      clientCharge: result.clientCharge,
      despachoCost: result.despachoCost,
      superadmin: result.superadmin,
      admin: result.admin,
      operador: result.operador,
      released: result.released,
    },
    {
      clientCharge: 5000,
      despachoCost: 1000,
      superadmin: 4000,
      admin: 0,
      operador: 0,
      released: 95000,
    },
  );
});

test("escenario admin distribuye despacho-superadmin-admin-cliente", () => {
  const result = calculateDistribution({
    gross: 100000,
    client: { rate: 5, base: "TOTAL", mode: "PERCENT" },
    despacho: { rate: 1, base: "TOTAL", mode: "PERCENT" },
    admin: { rate: 3, base: "TOTAL", mode: "PERCENT" },
  });
  assert.equal(result.superadmin, 2000);
  assert.equal(result.admin, 2000);
  assert.equal(result.operador, 0);
  assert.equal(result.totalEarnings, 4000);
});

test("escenario admin y operador distribuye cada escalon", () => {
  const result = calculateDistribution({
    gross: 100000,
    client: { rate: 5, base: "TOTAL", mode: "PERCENT" },
    despacho: { rate: 1, base: "TOTAL", mode: "PERCENT" },
    admin: { rate: 2, base: "TOTAL", mode: "PERCENT" },
    operador: { rate: 3, base: "TOTAL", mode: "PERCENT" },
  });
  assert.equal(result.superadmin, 1000);
  assert.equal(result.admin, 1000);
  assert.equal(result.operador, 2000);
  assert.equal(result.totalEarnings, 4000);
});

test("TOTAL, SUBTOTAL y FIXED producen montos deterministas a centavos", () => {
  assert.equal(amountFromRate(116000, 2, "TOTAL", "PERCENT"), 2320);
  assert.equal(amountFromRate(116000, 2, "SUBTOTAL", "PERCENT"), 2000);
  assert.equal(amountFromRate(116000, 750, "TOTAL", "FIXED"), 750);
  assert.match(financialSource, /roundingVersion: "money2_v1"/);
  assert.match(foundationSource, /roundingVersion: "money2_v1"/);
});

const resolveAssignedSection = section(
  financialSource,
  "function resolveAssignedCost",
  "function resolveDespachoCost",
);
const resolveDespachoSection = section(
  financialSource,
  "function resolveDespachoCost",
  "async function readUserMetaTx",
);
const createRateResolverSection = section(
  indexSource,
  "async function resolveClientAssignedCostRate",
  "export const createPago",
);
const createPagoSection = section(
  indexSource,
  "export const createPago",
  "export const changePagoStatus",
);
const postRoleSection = section(
  financialSource,
  'const adminId = firstText(clientDoc, ["adminId"])',
  "const balanceAccountReads = new Map",
);

if (
  !/active\s*===\s*false/.test(resolveAssignedSection) &&
  !/active\s*===\s*false/.test(resolveDespachoSection) &&
  !/active\s*===\s*false/.test(createRateResolverSection)
) {
  finding(
    "F1",
    "los costos inactivos todavia pueden ser usados",
    "resolveAssignedCost, resolveDespachoCost y resolveClientAssignedCostRate no descartan active=false.",
  );
}

if (
  /firstText\(clientDoc, \["adminId"\]\)/.test(postRoleSection) &&
  /users\/\$\{adminId\}\/costos/.test(financialSource) &&
  !/financialRateSnapshot|financialAssignmentSnapshot/.test(createPagoSection)
) {
  finding(
    "F2",
    "admin, operador y costos inferiores se resuelven en vivo al conciliar",
    "El pago solo fija finalClientRate; el posteo vuelve a leer clients y users/*/costos, por lo que cambios entre registro y conciliacion alteran la distribucion.",
  );
}

if (
  /Math\.max\(0, adminBaseAmount - despachoCostAmount\)/.test(financialSource) &&
  /Math\.max\(0, clientChargeAmount - operadorBaseAmount\)/.test(financialSource) &&
  !/SKIPPED_INVALID_RATE_HIERARCHY/.test(financialSource)
) {
  finding(
    "F3",
    "una jerarquia invertida se recorta a cero en vez de bloquearse",
    "Las diferencias negativas usan Math.max(0, ...); no existe SKIPPED_INVALID_RATE_HIERARCHY ni una comprobacion monto despacho <= admin <= operador <= cliente.",
  );
}

if (
  /pricingMode,\s*calculationBaseType,\s*finalClientRate/.test(createPagoSection) &&
  /pricingMode: String\(pricingMode/.test(createPagoSection) &&
  /calculationBaseType: String\(calculationBaseType/.test(createPagoSection) &&
  /return 0;\s*}\s*\n\s*export const createPago/.test(indexSource)
) {
  finding(
    "F4",
    "base y modalidad del costo cliente dependen del formulario",
    "El backend resuelve finalClientRate, pero guarda pricingMode y calculationBaseType enviados por el cliente sin resolverlos del mismo documento de costo.",
  );
}

if (
  /generatesClientBalance/.test(operationTypeSource) &&
  /generatesUserEarnings/.test(operationTypeSource) &&
  !/generatesClientBalance|generatesUserEarnings|allowsDispersion/.test(financialSource)
) {
  finding(
    "F5",
    "el posteo no respeta las banderas financieras del tipo de operacion",
    "operationTypes define generatesClientBalance, generatesUserEarnings y allowsDispersion, pero financial.ts no las consulta.",
  );
}

assert.equal(findings.length, 5, `Se esperaban 5 hallazgos conocidos y se detectaron ${findings.length}.`);

console.log(`\nH4-D65-A1 AUDITORIA COMPLETA: ${passed} controles PASS, ${findings.length} hallazgos abiertos.`);
console.log("Sin Firebase de produccion, sin IQ, sin Telegram y sin crear movimientos.");
console.log("DECISION: no crear otro motor de saldos. Corregir las cinco compuertas en H4-D65-A2 antes de la prueba financiera real.");
