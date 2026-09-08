import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const deposit = require("../../functions/lib/modules/iq/pagoDepositCallables.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = fs.readFileSync(
  path.join(root, "functions/src/modules/iq/pagoDepositCallables.ts"),
  "utf8",
);
const indexSource = fs.readFileSync(
  path.join(root, "functions/src/index.ts"),
  "utf8",
);

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

const pending = {
  status: "CONCILIACION_PENDIENTE",
  iqDepositCreationStatus: "CREATED",
  iqDepositId: "211751",
};

test("primer folio IQ encola comprobacion dirigida", () => {
  assert.equal(
    deposit.shouldEnqueuePagoIqReconcileOnFirstLinkH4D78A1(
      { status: "CONCILIACION_PENDIENTE" },
      pending,
    ),
    true,
  );
});

test("mismo folio no genera ciclo de onWrite", () => {
  assert.equal(
    deposit.shouldEnqueuePagoIqReconcileOnFirstLinkH4D78A1(
      pending,
      pending,
    ),
    false,
  );
});

test("alias historico de folio tambien dispara seguimiento", () => {
  assert.equal(
    deposit.shouldEnqueuePagoIqReconcileOnFirstLinkH4D78A1(
      { status: "CONCILIACION_PENDIENTE" },
      {
        status: "CONCILIACION_PENDIENTE",
        iqPagoDepositFolio: "211751",
      },
    ),
    true,
  );
});

test("pago ya conciliado no vuelve a consultar IQ", () => {
  assert.equal(
    deposit.shouldEnqueuePagoIqReconcileOnFirstLinkH4D78A1(
      { status: "CONCILIACION_PENDIENTE" },
      { ...pending, status: "CONCILIADO" },
    ),
    false,
  );
});

test("pago omitido no vuelve a consultar IQ", () => {
  assert.equal(
    deposit.shouldEnqueuePagoIqReconcileOnFirstLinkH4D78A1(
      { status: "CONCILIACION_PENDIENTE" },
      { ...pending, iqDepositAutomationOmitted: true },
    ),
    false,
  );
});

test("referencia no numerica no se adopta como folio IQ", () => {
  assert.equal(
    deposit.shouldEnqueuePagoIqReconcileOnFirstLinkH4D78A1(
      { status: "CONCILIACION_PENDIENTE" },
      {
        status: "CONCILIACION_PENDIENTE",
        iqDepositId: "sin-folio",
      },
    ),
    false,
  );
});

test("reconciliacion tiene prioridad si un evento tambien parece creacion", () => {
  assert.match(
    source,
    /const operation: PagoIqOnDemandOperationH4D64 =\s*shouldEnqueueReconcile \? "RECONCILE" : "CREATE";/,
  );
  assert.match(
    source,
    /operation === "CREATE"\s*\? afterQueuedUploadId \|\| eventGeneration\s*:\s*`linked-\$\{linkedIqId\}-\$\{eventGeneration\}`/,
  );
});

test("tarea dirigida reintenta solo mientras el pago esta pendiente", () => {
  assert.match(
    source,
    /pagoStatus !== "CONCILIACION_PENDIENTE"[\s\S]{0,260}COMPLETED_NO_LONGER_PENDING/,
  );
  assert.match(
    source,
    /operation:\s*"RECONCILE"[\s\S]{0,160}attempt:\s*nextAttempt/,
  );
});

test("conciliacion IQ conserva posteo financiero canonico", () => {
  assert.match(
    source,
    /await postPagoFinancialsAfterIqConciliationH4D65A0\(\{/,
  );
  assert.match(
    source,
    /H4_D65_A0_CORE_RECONCILE_POSTS_FINANCIALS/,
  );
});

test("schedulers globales de pagos permanecen fuera del index", () => {
  const exportsBlock = indexSource.slice(
    indexSource.indexOf("prevalidatePagoIqDeposit"),
    indexSource.indexOf("getIqAutomationDashboard"),
  );

  assert.match(exportsBlock, /processIqPagoDepositCreateQueueOnWrite/);
  assert.match(exportsBlock, /processIqPagoDepositOnDemandTask/);
  assert.doesNotMatch(
    exportsBlock,
    /^\s*processIqPagoDepositReconciliationQueue,\s*$/m,
  );
  assert.doesNotMatch(
    exportsBlock,
    /^\s*processIqPagoDepositCreateQueue,\s*$/m,
  );
});

test("QA no usa Firebase ni IQ de produccion", () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, undefined);
  assert.equal(process.env.IQ_CREDENTIALS_KEY, undefined);
  assert.equal(process.env.TELEGRAM_BOT_TOKEN, undefined);
});

console.log(`\nH4-D78-A1 QA PASS: ${passed} pruebas.`);
console.log(
  "Seguimiento por folio dirigido, sin polling global, sin IQ real y sin modificar pagos.",
);
