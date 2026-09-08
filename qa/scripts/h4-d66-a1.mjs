import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const require = createRequire(import.meta.url);

const domain = require(path.join(root, "functions/lib/modules/paymentApplications/domain.js"));
const domainSource = read("functions/src/modules/paymentApplications/domain.ts");
const serviceSource = read("functions/src/modules/paymentApplications/service.ts");
const callablesSource = read("functions/src/modules/paymentApplications/callables.ts");
const indexSource = read("functions/src/index.ts");
const pagosServiceSource = read("src/services/pagos.ts");
const pagosPageSource = read("src/app/pagos/page.tsx");
const solicitudesPageSource = read("src/app/solicitudes/page.tsx");
const rulesSource = read("firestore.rules");
const packageSource = read("package.json");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

console.log("\n=== H4-D66-A1 | Reserva idempotente + aplicacion multiple atomica ===");

const baseInput = {
  pagoId: "pago-113",
  idempotencyKey: "payapp-12345678",
  aplicaciones: [
    { solicitudId: "sol-b", montoAplicado: 250.25 },
    { solicitudId: "sol-a", montoAplicado: 100.1 },
  ],
};

const normalized = domain.normalizePaymentApplicationBatchInput(baseInput);

test("normaliza, ordena y suma el lote en centavos", () => {
  assert.deepEqual(normalized.applications, [
    { solicitudId: "sol-a", montoAplicado: 100.1 },
    { solicitudId: "sol-b", montoAplicado: 250.25 },
  ]);
  assert.equal(normalized.totalAmount, 350.35);
});

test("el hash idempotente no depende del orden visual", () => {
  const reordered = domain.normalizePaymentApplicationBatchInput({
    ...baseInput,
    aplicaciones: [...baseInput.aplicaciones].reverse(),
  });
  assert.equal(reordered.requestHash, normalized.requestHash);
});

test("la reserva es determinista por root, pago y llave", () => {
  const first = domain.buildPaymentApplicationReservationId({
    rootId: "root-1",
    pagoId: baseInput.pagoId,
    idempotencyKey: baseInput.idempotencyKey,
  });
  const second = domain.buildPaymentApplicationReservationId({
    rootId: "root-1",
    pagoId: baseInput.pagoId,
    idempotencyKey: baseInput.idempotencyKey,
  });
  const other = domain.buildPaymentApplicationReservationId({
    rootId: "root-1",
    pagoId: baseInput.pagoId,
    idempotencyKey: "payapp-87654321",
  });
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^par_[a-f0-9]{56}$/);
});

test("aplicacion, ledger, notas y actividad usan ids deterministas", () => {
  const reservationId = domain.buildPaymentApplicationReservationId({
    rootId: "root-1",
    pagoId: baseInput.pagoId,
    idempotencyKey: baseInput.idempotencyKey,
  });
  const applicationId = domain.buildPaymentApplicationDocumentId(reservationId, "sol-a");
  assert.equal(
    applicationId,
    domain.buildPaymentApplicationDocumentId(reservationId, "sol-a"),
  );
  assert.equal(
    domain.buildPaymentApplicationLedgerId(applicationId),
    domain.buildPaymentApplicationLedgerId(applicationId),
  );
  assert.equal(
    domain.buildPaymentApplicationNoteId(reservationId, "sol-a"),
    domain.buildPaymentApplicationNoteId(reservationId, "sol-a"),
  );
  assert.notEqual(
    domain.buildPaymentApplicationActivityId(applicationId, "APPLIED"),
    domain.buildPaymentApplicationActivityId(applicationId, "COMPLETED"),
  );
});

test("rechaza solicitudes duplicadas y lotes mayores a 50", () => {
  assert.throws(() => domain.normalizePaymentApplicationBatchInput({
    pagoId: "pago-1",
    idempotencyKey: "payapp-duplicado",
    aplicaciones: [
      { solicitudId: "sol-1", montoAplicado: 1 },
      { solicitudId: "sol-1", montoAplicado: 2 },
    ],
  }));
  assert.throws(() => domain.normalizePaymentApplicationBatchInput({
    pagoId: "pago-1",
    idempotencyKey: "payapp-masivo-51",
    aplicaciones: Array.from({ length: 51 }, (_, index) => ({
      solicitudId: `sol-${index}`,
      montoAplicado: 1,
    })),
  }));
});

test("la misma llave con payload distinto se bloquea", () => {
  assert.match(serviceSource, /La llave idempotente ya fue usada con un lote diferente/);
  assert.match(serviceSource, /reservation\?\.requestHash/);
  assert.match(serviceSource, /batch\.requestHash/);
});

test("reintento de reserva o aplicacion completada reutiliza resultado", () => {
  assert.match(serviceSource, /reservationResultFromSnapshot\(reservationId, reservation, true\)/);
  assert.match(serviceSource, /String\(reservation\?\.status \|\| ""\) === "APPLIED"/);
  assert.match(serviceSource, /status: "RESERVED"/);
  assert.match(serviceSource, /status: "APPLIED"/);
});

test("todo el lote PAY0 se confirma dentro de una sola transaccion", () => {
  assert.match(serviceSource, /export async function applyPaymentApplicationBatchAtomic/);
  assert.match(serviceSource, /return db\.runTransaction\(async \(tx\) =>/);
  assert.match(serviceSource, /buildPagoCoverageApplyPatch\(pago, batch\.totalAmount\)/);
  assert.match(serviceSource, /tx\.update\(pagoRef/);
  assert.match(serviceSource, /tx\.update\(solicitudSnap\.ref/);
  assert.match(serviceSource, /tx\.set\(db\.collection\("pagoAplicaciones"\)/);
  assert.match(serviceSource, /tx\.set\(db\.collection\("ledgerEvents"\)/);
  assert.match(serviceSource, /logActivityTx\(/);
});

test("el callable individual tambien usa el motor atomico", () => {
  assert.match(callablesSource, /export const applyPagoToSolicitud = onCall/);
  assert.match(callablesSource, /return applyPaymentApplicationBatchAtomic\(\{ actor, batch \}\)/g);
  assert.doesNotMatch(indexSource, /export const applyPagoToSolicitud = onCall/);
  assert.match(indexSource, /from "\.\/modules\/paymentApplications\/callables"/);
});

test("Pagos envia todas las solicitudes en una sola llamada", () => {
  assert.match(pagosPageSource, /await applyPagoToSolicitudesAtomic\(\{/);
  assert.match(pagosPageSource, /aplicaciones: seleccionados\.map/);
  assert.doesNotMatch(pagosPageSource, /for \(const item of seleccionados\)/);
  assert.match(pagosPageSource, /applyRequestKeyRef\.current/);
});

test("Solicitudes conserva la misma llave para un reintento individual", () => {
  assert.match(solicitudesPageSource, /applyRequestKeyRef = useRef/);
  assert.match(solicitudesPageSource, /idempotencyKey,/);
  assert.match(pagosServiceSource, /createPagoApplicationIdempotencyKey/);
  assert.match(pagosServiceSource, /applyPagoToSolicitudesAtomic/);
});

test("A1 no ejecuta ni prepara acciones reales en IQ", () => {
  const combined = `${domainSource}\n${serviceSource}\n${callablesSource}`;
  assert.doesNotMatch(combined, /browserSession|puppeteer|payment-applications|\/iq\/|modules\/iq/i);
  assert.match(combined, /iqExecutionStatus: "NOT_REQUESTED"/);
  assert.match(combined, /iqActionExecuted: false/);
});

test("reglas y comando QA incluyen la nueva reserva", () => {
  assert.match(rulesSource, /match \/pagoApplicationReservations\/\{reservationId\}/);
  assert.match(rulesSource, /allow create, update, delete: if false;/);
  assert.match(packageSource, /"qa:pay0:h4-d66-a1"/);
});

console.log(`\nH4-D66-A1 QA PASS: ${passed} pruebas.`);
console.log("Sin Firebase de produccion, sin IQ real, sin despliegue y sin backfill.");
