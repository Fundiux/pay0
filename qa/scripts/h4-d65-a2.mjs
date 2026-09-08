import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const indexSource = read("functions/src/index.ts");
const financialSource = read("functions/src/modules/deposits/financial.ts");
const iqSource = read("functions/src/modules/iq/pagoDepositCallables.ts");
const packageSource = read("package.json");

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `No se encontro inicio: ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  assert.notEqual(end, -1, `No se encontro fin: ${endMarker}`);
  return source.slice(start, end);
}

function money2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function amountFromCost(gross, cost) {
  if (cost.mode === "FIXED") return money2(cost.rate);
  const base = cost.base === "SUBTOTAL" ? money2(gross / 1.16) : money2(gross);
  return money2(base * (money2(cost.rate) / 100));
}

function hierarchyIsValid(gross, costs) {
  const levels = [
    amountFromCost(gross, costs.despacho),
    ...(costs.admin ? [amountFromCost(gross, costs.admin)] : []),
    ...(costs.operador ? [amountFromCost(gross, costs.operador)] : []),
    amountFromCost(gross, costs.client),
  ];
  return levels.every((amount, index) => index === 0 || levels[index - 1] <= amount);
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

console.log("\n=== H4-D65-A2 | Cierre de compuertas financieras ===");

const createPagoSection = section(indexSource, "export const createPago", "export const changePagoStatus");
const createResolverSection = section(
  indexSource,
  "async function resolvePagoFinancialCostSnapshot",
  "export const createPago",
);
const postingSection = section(
  financialSource,
  "export async function postCanonicalPagoFinancials",
  null,
);
const distributionSection = section(
  financialSource,
  "let superadminEarningAmount = 0;",
  "const totalEarningsAmount",
);

test("cada pago nuevo fija una fotografia financiera completa", () => {
  assert.match(createPagoSection, /financialAssignmentSnapshot: PagoFinancialAssignmentSnapshot/);
  assert.match(createPagoSection, /version: "H4_D65_A2_V1"/);
  for (const field of [
    "despachoId",
    "adminId",
    "operadorId",
    "operationTypeKey",
    "operationFlags",
    "clientCost",
    "despachoCost",
    "adminCost",
    "operadorCost",
  ]) {
    assert.match(createPagoSection, new RegExp(field));
  }
  assert.match(createPagoSection, /financialAssignmentSnapshot,/);
  assert.match(createPagoSection, /financialRateSnapshot:/);
});

test("los costos inactivos se rechazan al crear y al postear", () => {
  assert.match(createResolverSection, /active: data\.active !== false/);
  assert.match(createResolverSection, /if \(cost\.active === false\)/);
  assert.match(financialSource, /if \(!doc \|\| doc\.active === false\) return null;/);
  assert.match(postingSection, /ausente o inactivo en la fotografia financiera/);
});

test("base, modalidad y tarifa cliente vienen del costo backend", () => {
  assert.match(createPagoSection, /saleTypeKey: financialAssignmentSnapshot\.clientCost\.calculationBaseType/);
  assert.match(createPagoSection, /pricingMode: financialAssignmentSnapshot\.clientCost\.pricingMode/);
  assert.match(createPagoSection, /calculationBaseType: financialAssignmentSnapshot\.clientCost\.calculationBaseType/);
  assert.match(createPagoSection, /finalClientRate: financialAssignmentSnapshot\.clientCost\.rate/);
  assert.doesNotMatch(createPagoSection, /pricingMode: String\(pricingMode/);
  assert.doesNotMatch(createPagoSection, /calculationBaseType: String\(calculationBaseType/);
});

test("la conciliacion exige fotografia y no resuelve costos ni asignaciones en vivo", () => {
  assert.match(postingSection, /SKIPPED_MISSING_FINANCIAL_SNAPSHOT/);
  assert.match(postingSection, /const assignmentSnapshot = asRecord\(pago\.financialAssignmentSnapshot\)/);
  assert.match(postingSection, /const adminId = firstText\(assignmentSnapshot, \["adminId"\]\)/);
  assert.match(postingSection, /const operadorId = firstText\(assignmentSnapshot, \["operadorId"\]\)/);
  assert.doesNotMatch(postingSection, /users\/\$\{adminId\}\/costos/);
  assert.doesNotMatch(postingSection, /users\/\$\{operadorId\}\/costos/);
  assert.doesNotMatch(postingSection, /clients\/\$\{clienteId\}\/costos/);
  assert.doesNotMatch(postingSection, /despachos\/\$\{despachoId\}\/costos/);
});

test("una jerarquia invertida se bloquea al crear y al conciliar", () => {
  assert.match(createPagoSection, /assertPagoFinancialRateHierarchy\(/);
  assert.match(financialSource, /SKIPPED_INVALID_RATE_HIERARCHY/);
  assert.match(financialSource, /validateRateHierarchy\(/);
  assert.doesNotMatch(distributionSection, /Math\.max\(0,/);

  assert.equal(hierarchyIsValid(100000, {
    despacho: { rate: 1, base: "TOTAL", mode: "PERCENT" },
    admin: { rate: 2, base: "TOTAL", mode: "PERCENT" },
    operador: { rate: 3, base: "TOTAL", mode: "PERCENT" },
    client: { rate: 5, base: "TOTAL", mode: "PERCENT" },
  }), true);

  assert.equal(hierarchyIsValid(100000, {
    despacho: { rate: 3, base: "TOTAL", mode: "PERCENT" },
    admin: { rate: 2, base: "TOTAL", mode: "PERCENT" },
    operador: null,
    client: { rate: 5, base: "TOTAL", mode: "PERCENT" },
  }), false);
});

test("la jerarquia compara montos reales entre TOTAL SUBTOTAL y FIXED", () => {
  assert.equal(hierarchyIsValid(116000, {
    despacho: { rate: 1000, base: "TOTAL", mode: "FIXED" },
    admin: { rate: 1.5, base: "SUBTOTAL", mode: "PERCENT" },
    operador: { rate: 2, base: "SUBTOTAL", mode: "PERCENT" },
    client: { rate: 3, base: "SUBTOTAL", mode: "PERCENT" },
  }), true);
  assert.equal(hierarchyIsValid(116000, {
    despacho: { rate: 2500, base: "TOTAL", mode: "FIXED" },
    admin: { rate: 2, base: "SUBTOTAL", mode: "PERCENT" },
    operador: null,
    client: { rate: 3, base: "SUBTOTAL", mode: "PERCENT" },
  }), false);
});

test("las banderas financieras quedan congeladas al registrar", () => {
  for (const flag of ["generatesClientBalance", "generatesUserEarnings", "allowsDispersion"]) {
    assert.match(createPagoSection, new RegExp(flag));
    assert.match(postingSection, new RegExp(flag));
  }
  assert.match(createPagoSection, /operationGeneratesClientBalance:/);
  assert.match(createPagoSection, /operationGeneratesUserEarnings:/);
  assert.match(createPagoSection, /operationAllowsDispersion:/);
});

test("saldo cliente solo se genera cuando tambien se permite dispersion", () => {
  assert.match(
    postingSection,
    /const clientBalanceEnabled =\s*operationFlags\.generatesClientBalance && operationFlags\.allowsDispersion/,
  );
  assert.match(postingSection, /if \(clientBalanceEnabled && grossAmount > 0\)/);
  assert.match(postingSection, /walletPostingStatus: clientBalanceEnabled \? "POSTED" : "SKIPPED_OPERATION_FLAGS"/);
  assert.match(postingSection, /clientNetAmountGenerated: clientBalanceEnabled \? clientNetAmount : 0/);
});

test("utilidades de usuarios obedecen generatesUserEarnings", () => {
  assert.match(postingSection, /const userEarningsEnabled = operationFlags\.generatesUserEarnings/);
  assert.match(distributionSection, /if \(userEarningsEnabled\)/);
  assert.match(postingSection, /if \(userEarningsEnabled && superadminMeta/);
  assert.match(postingSection, /if \(userEarningsEnabled && adminMeta/);
  assert.match(postingSection, /if \(userEarningsEnabled && operadorMeta/);
});

test("adelantos no se liquidan cuando la operacion no genera wallet", () => {
  assert.match(postingSection, /const advanceSettlement = clientBalanceEnabled\s*\?/);
  assert.match(postingSection, /releasedAmount: 0/);
  assert.match(postingSection, /if \(clientBalanceEnabled && advanceSettlement\.appliedAmount > 0\)/);
});

test("clic manual e IQ conservan el mismo motor canonico", () => {
  assert.match(indexSource, /await postCanonicalPagoFinancials\(\{/);
  assert.match(iqSource, /import \{ postCanonicalPagoFinancials \} from "\.\.\/deposits\/financial";/);
  assert.match(iqSource, /const result = await postCanonicalPagoFinancials\(\{/);
});

test("el bloque es solo forward y no barre historicos", () => {
  assert.match(postingSection, /No se resolveran costos historicos en vivo/);
  assert.doesNotMatch(financialSource, /BACKFILL|MIGRAT/i);
  assert.doesNotMatch(indexSource, /H4_D65_A2[^\n]*(BACKFILL|MIGRAT)/i);
  assert.match(packageSource, /"qa:pay0:h4-d65-a2"/);
});

console.log(`\nH4-D65-A2 QA PASS: ${passed} pruebas.`);
console.log("Cinco compuertas cerradas, sin Firebase de produccion, sin IQ real y sin backfill.");
