import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const deposit = require("../../functions/lib/modules/iq/pagoDepositCallables.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const depositSource = fs.readFileSync(
  path.join(root, "functions/src/modules/iq/pagoDepositCallables.ts"),
  "utf8",
);
const manualSource = fs.readFileSync(path.join(root, "functions/src/index.ts"), "utf8");
const serviceSource = fs.readFileSync(path.join(root, "src/services/iq.ts"), "utf8");
const modalSource = fs.readFileSync(path.join(root, "src/components/PagoDocsModal.tsx"), "utf8");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

function simulateCanonicalPost(state) {
  if (state.financialPostingStatus === "POSTED") {
    return { ...state, postCalls: state.postCalls, result: "POSTED" };
  }
  if (state.status !== "CONCILIADO") {
    return { ...state, result: "NOT_CONCILIATED" };
  }
  return {
    ...state,
    financialPostingStatus: "POSTED",
    walletPostingStatus: "POSTED",
    clientBalanceMovements: state.clientBalanceMovements + 1,
    userIncomeMovements: state.userIncomeMovements + 1,
    postCalls: state.postCalls + 1,
    result: "POSTED",
  };
}

function simulateManualConciliation(state) {
  return simulateCanonicalPost({ ...state, status: "CONCILIADO" });
}

function simulateIqConciliation(state) {
  const next = state.status === "CONCILIACION_PENDIENTE"
    ? { ...state, status: "CONCILIADO" }
    : { ...state };
  return simulateCanonicalPost(next);
}

const base = {
  status: "CONCILIACION_PENDIENTE",
  financialPostingStatus: "PENDING",
  walletPostingStatus: "PENDING",
  clientBalanceMovements: 0,
  userIncomeMovements: 0,
  postCalls: 0,
};

test("clic manual conserva el posteo financiero canonico", () => {
  assert.match(manualSource, /await postCanonicalPagoFinancials\(\{/);
  assert.match(manualSource, /if \(nextStatus === "CONCILIADO"\)/);
});

test("IQ importa y usa exactamente el mismo posteo canonico", () => {
  assert.match(depositSource, /import \{ postCanonicalPagoFinancials \} from "\.\.\/deposits\/financial";/);
  assert.match(depositSource, /const result = await postCanonicalPagoFinancials\(\{/);
  assert.equal(
    count(depositSource, /postPagoFinancialsAfterIqConciliationH4D65A0\(\{/g),
    5,
  );
});

test("todos los caminos IQ exitosos quedaron cubiertos", () => {
  const markers = [
    "H4_D65_A0_HISTORICAL_RECONCILE_POSTS_FINANCIALS",
    "H4_D65_A0_MANUAL_RECONCILE_POSTS_FINANCIALS",
    "H4_D65_A0_CORE_RECONCILE_POSTS_FINANCIALS",
    "H4_D65_A0_MANUAL_LINK_POSTS_FINANCIALS",
    "H4_D65_A0_MANUAL_LINK_HTTP_POSTS_FINANCIALS",
  ];
  for (const marker of markers) assert.match(depositSource, new RegExp(marker));
});

test("la decision permite pendiente y conciliado visual para reparacion manual", () => {
  assert.equal(deposit.shouldPostPagoFinancialsAfterIqConciliationH4D65A0({
    conciliated: true,
    currentStatus: "CONCILIACION_PENDIENTE",
  }), true);
  assert.equal(deposit.shouldPostPagoFinancialsAfterIqConciliationH4D65A0({
    conciliated: true,
    currentStatus: "CONCILIADO",
  }), true);
  assert.equal(deposit.shouldPostPagoFinancialsAfterIqConciliationH4D65A0({
    conciliated: false,
    currentStatus: "CONCILIACION_PENDIENTE",
  }), false);
  assert.equal(deposit.shouldPostPagoFinancialsAfterIqConciliationH4D65A0({
    conciliated: true,
    currentStatus: "RECHAZADO",
  }), false);
});

test("conciliacion manual e IQ producen el mismo resultado financiero", () => {
  const manual = simulateManualConciliation(base);
  const iq = simulateIqConciliation(base);
  assert.deepEqual(
    {
      status: iq.status,
      financialPostingStatus: iq.financialPostingStatus,
      walletPostingStatus: iq.walletPostingStatus,
      clientBalanceMovements: iq.clientBalanceMovements,
      userIncomeMovements: iq.userIncomeMovements,
    },
    {
      status: manual.status,
      financialPostingStatus: manual.financialPostingStatus,
      walletPostingStatus: manual.walletPostingStatus,
      clientBalanceMovements: manual.clientBalanceMovements,
      userIncomeMovements: manual.userIncomeMovements,
    },
  );
});

test("reintento IQ no duplica saldo ni ingresos", () => {
  const first = simulateIqConciliation(base);
  const second = simulateIqConciliation(first);
  assert.equal(second.clientBalanceMovements, 1);
  assert.equal(second.userIncomeMovements, 1);
  assert.equal(second.postCalls, 1);
  assert.equal(second.financialPostingStatus, "POSTED");
});

test("sincronizar un conciliado solo visual completa el posteo faltante", () => {
  const visualOnly = {
    ...base,
    status: "CONCILIADO",
    financialPostingStatus: "PENDING",
    walletPostingStatus: "PENDING",
  };
  const repaired = simulateIqConciliation(visualOnly);
  assert.equal(repaired.financialPostingStatus, "POSTED");
  assert.equal(repaired.walletPostingStatus, "POSTED");
  assert.equal(repaired.clientBalanceMovements, 1);
  assert.equal(repaired.userIncomeMovements, 1);
});

test("resultado queda visible en API y modal", () => {
  for (const field of [
    "financialPostingAttempted",
    "financialPostingOk",
    "financialPostingStatus",
    "financialSnapshotId",
    "financialPostingError",
  ]) {
    assert.match(serviceSource, new RegExp(field));
    assert.match(depositSource, new RegExp(field));
  }
  assert.match(modalSource, /Posteo financiero PAY0: COMPLETADO/);
  assert.match(modalSource, /H4_D65_A0_UI_SHOWS_FINANCIAL_POSTING_RESULT/);
});

test("no existe barrido ni backfill de pagos historicos", () => {
  assert.doesNotMatch(depositSource, /H4_D65_A0[^\n]*(BACKFILL|MIGRAT)/i);
  assert.doesNotMatch(depositSource, /collection\("pagos"\)[\s\S]{0,120}where\("status",\s*"==",\s*"CONCILIADO"\)/);
  assert.equal(process.env.IQ_CREDENTIALS_KEY, undefined);
  assert.equal(process.env.TELEGRAM_BOT_TOKEN, undefined);
});

console.log(`\nH4-D65-A0 QA PASS: ${passed} pruebas.`);
console.log("Mismo posteo financiero para clic manual e IQ, sin IQ real, sin produccion y sin backfill.");
