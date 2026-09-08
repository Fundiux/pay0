import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const deposit = require("../../functions/lib/modules/iq/pagoDepositCallables.js");
const docs = require("../../functions/lib/modules/pagoDocuments/service.js");
const telegram = require("../../functions/lib/modules/iq/pagoTelegramNotifications.js");

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
function expectHttpsCode(fn, expected) {
  let caught = null;
  try { fn(); } catch (error) { caught = error; }
  assert.ok(caught, `Se esperaba error ${expected}`);
  const code = String(caught.code || "").replace(/^functions\//, "");
  assert.equal(code, expected);
}

const baseRejected = {
  status: "RECHAZADO",
  iqDepositStatus: "REJECTED",
  iqDepositReconciliationStatus: "Rechazado por comprobante ilegible",
  iqDepositTerminalLocked: true,
  iqDepositTerminalStatus: "REJECTED",
  iqDepositId: "208640",
  iqDepositCreationQueuedUploadId: "upload-anterior",
  iqDepositOnDemandTaskId: "task-anterior",
  montoTotal: 1000,
  montoAplicado: 0,
  financialPostingStatus: "PENDING",
  walletPostingStatus: "PENDING",
};

test("detecta rechazo y cancelacion", () => {
  assert.equal(deposit.getPagoIqTerminalOutcomeH4D64A6("Rechazado"), "REJECTED");
  assert.equal(deposit.getPagoIqTerminalOutcomeH4D64A6("Cancelado"), "CANCELLED");
  assert.equal(deposit.getPagoIqTerminalOutcomeH4D64A6("Conciliado"), null);
});

test("cierra definitivamente tareas del rechazo", () => {
  const patch = deposit.buildPagoIqTerminalLockPatchH4D58H({
    pago: baseRejected,
    iqId: "208640",
    operationStatus: "En operacion",
    reconciliationStatus: "Rechazado por comprobante ilegible",
    authUid: "qa-superadmin",
    source: "QA_H4_D64_A7",
  });
  assert.equal(patch.status, "RECHAZADO");
  assert.equal(patch.iqDepositTerminalLocked, true);
  assert.equal(patch.iqDepositFollowupStatus, "COMPLETED_TERMINAL");
  assert.equal(patch.iqDepositCreationStatus, "TERMINAL_REJECTED");
  assert.equal(patch.iqDepositCreationRetryBlocked, true);
  assert.equal(patch.iqDepositOnDemandStatus, "COMPLETED_TERMINAL");
  assert.equal(patch.iqDepositTerminalPreviousQueuedUploadId, "upload-anterior");
  assert.equal(patch.iqDepositTerminalPreviousOnDemandTaskId, "task-anterior");
});

test("clasifica resultados terminales sin reintento", () => {
  assert.equal(deposit.pagoIqResultIsTerminalH4D64({ status: "REJECTED" }), true);
  assert.equal(deposit.pagoIqResultIsTerminalH4D64({ reconciliationStatus: "CANCELADO" }), true);
  assert.equal(deposit.pagoIqResultIsTerminalH4D64({ status: "PENDING" }), false);
});

test("edicion controlada de monto permite solo caso valido", () => {
  const decision = docs.validateRejectedPagoAmountCorrectionH4D64A7({
    role: "superadmin",
    pago: baseRejected,
    newAmount: 1200,
    hasRegisteredApplications: false,
  });
  assert.equal(decision.previousAmount, 1000);
  assert.equal(decision.terminalIqId, "208640");
  assert.equal(decision.correctionVersion, 1);
});

test("edicion de monto bloquea rol, aplicaciones y posteo", () => {
  expectHttpsCode(() => docs.validateRejectedPagoAmountCorrectionH4D64A7({
    role: "admin", pago: baseRejected, newAmount: 1200, hasRegisteredApplications: false,
  }), "permission-denied");
  expectHttpsCode(() => docs.validateRejectedPagoAmountCorrectionH4D64A7({
    role: "superadmin", pago: { ...baseRejected, montoAplicado: 1 }, newAmount: 1200, hasRegisteredApplications: false,
  }), "failed-precondition");
  expectHttpsCode(() => docs.validateRejectedPagoAmountCorrectionH4D64A7({
    role: "superadmin", pago: { ...baseRejected, walletPostingStatus: "POSTED" }, newAmount: 1200, hasRegisteredApplications: false,
  }), "failed-precondition");
  expectHttpsCode(() => docs.validateRejectedPagoAmountCorrectionH4D64A7({
    role: "superadmin", pago: baseRejected, newAmount: 1200, hasRegisteredApplications: true,
  }), "failed-precondition");
});

test("nuevo comprobante conserva terminal y abre nueva generacion", () => {
  const unlock = docs.buildPagoIqReplacementUnlockPatchH4D58H({
    pago: baseRejected,
    uploadId: "upload-nuevo",
    documentType: "COMPROBANTE_PAGO",
    uid: "qa-superadmin",
  });
  const queue = docs.buildPagoIqAutoQueuePatchH4D62B({
    pago: baseRejected,
    uploadId: "upload-nuevo",
    documentType: "COMPROBANTE_PAGO",
    uid: "qa-superadmin",
    terminalUnlockApplied: true,
  });
  assert.equal(unlock.status, "CONCILIACION_PENDIENTE");
  assert.equal(unlock.iqDepositPreviousTerminalIqId, "208640");
  assert.equal(unlock.iqDepositRetryOfIqId, "208640");
  assert.equal(unlock.iqDepositTerminalLocked, false);
  assert.equal(unlock.iqDepositRetryGeneration, "upload-nuevo");
  assert.equal(queue.iqDepositCreationStatus, "QUEUED");
  assert.equal(queue.iqDepositCreationQueuedUploadId, "upload-nuevo");
  assert.equal(queue.iqDepositOnDemandGeneration, "upload-nuevo");
  assert.equal(queue.iqDepositOnDemandStatus, "READY_TO_ENQUEUE");
});

test("alertas Telegram se construyen sin enviar", () => {
  const common = {
    auth: { uid: "qa-superadmin", role: "superadmin", rootId: "qa-root", user: { username: "QA" } },
    pagoId: "qa-pago",
    pago: { folio: "PQA1", montoTotal: 1200, clienteNombre: "CLIENTE QA", empresaNombre: "EMPRESA QA" },
    iqId: "208640",
    source: "QA_H4_D64_A7",
  };
  const rejected = telegram.buildIqPagoTelegramPreviewH4D64A7({ ...common, event: "IQ_PAGO_RECHAZADO" });
  const receipt = telegram.buildIqPagoTelegramPreviewH4D64A7({ ...common, event: "IQ_PAGO_NUEVO_COMPROBANTE" });
  const amount = telegram.buildIqPagoTelegramPreviewH4D64A7({ ...common, event: "IQ_PAGO_MONTO_CORREGIDO" });
  assert.match(rejected.text, /pago rechazado/i);
  assert.match(rejected.text, /208640/);
  assert.match(receipt.text, /nuevo comprobante/i);
  assert.match(amount.text, /monto de pago corregido/i);
  assert.equal(rejected.notificationId.includes("qa-pago"), true);
});

test("la prueba no tiene conectores de produccion", () => {
  const source = String(process.env.FIRESTORE_EMULATOR_HOST || "");
  assert.equal(source, "");
  assert.equal(process.env.IQ_CREDENTIALS_KEY, undefined);
  assert.equal(process.env.TELEGRAM_BOT_TOKEN, undefined);
});

console.log(`\nH4-D64-A6 QA PASS: ${passed} pruebas.`);
console.log("Sin IQ, sin Firebase de produccion, sin Telegram y sin modificar pagos.");
