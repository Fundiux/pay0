import fs from "node:fs";

const source = fs.readFileSync(
  "functions/src/modules/iq/pagoDepositCallables.ts",
  "utf8",
);
const index = fs.readFileSync("functions/src/index.ts", "utf8");

let passed = 0;

function check(name, condition) {
  if (!condition) {
    console.error(`FAIL ${name}`);
    process.exit(1);
  }

  passed += 1;
  console.log(`PASS ${name}`);
}

const callableStart =
  source.indexOf("export const reconcilePagoIqDeposit = onCall(");
const callableEnd =
  source.indexOf(
    "async function reconcilePagoIqDepositCoreH4D44(",
    callableStart + 1,
  );

check("callable encontrado", callableStart >= 0);
check("callable aislado", callableEnd > callableStart);

const callable = source.slice(callableStart, callableEnd);

check(
  "lee los cuatro alias del folio",
  [
    "ctx.pago.iqDepositId",
    "ctx.pago.iqDepositFolio",
    "ctx.pago.iqPagoDepositId",
    "ctx.pago.iqPagoDepositFolio",
  ].every((token) => callable.includes(token)),
);

check(
  "consulta el folio IQ existente",
  callable.includes("runIqFindDepositsByRefs({") &&
    callable.includes("iqId: existingIqId || undefined"),
);

check(
  "conserva conciliado y terminales",
  callable.includes("effectiveConciliatedH4D64A6") &&
    callable.includes("terminalOutcomeH4D64A6"),
);

check(
  "no crea deposito",
  ![
    "prevalidatePagoIqDeposit(",
    "preparePagoIqDeposit(",
    "createPagoIqDeposit(",
    "runIqCreateDepositBatch(",
  ].some((token) => callable.includes(token)),
);

check(
  "no espera posteo financiero",
  !callable.includes(
    "await postPagoFinancialsAfterIqConciliationH4D65A0",
  ),
);

check(
  "solicita posteo backend",
  callable.includes("iqFinancialPostingRequestId"),
);

check(
  "onWrite financiero existe",
  source.includes(
    "export const processPagoIqFinancialPostingRequestOnWrite",
  ),
);

check(
  "onWrite usa posteo canonico",
  source.includes('source: "IQ_STATUS_CONFIRMED_ON_WRITE"') &&
    source.includes(
      "await postPagoFinancialsAfterIqConciliationH4D65A0({",
    ),
);

check(
  "onWrite es idempotente por request",
  source.includes("requestId === previousRequestId") &&
    source.includes("requestId === processedRequestId"),
);

check(
  "reconcilePagoIqDeposit exportada",
  /^\s*reconcilePagoIqDeposit,\s*$/m.test(index),
);

check(
  "onWrite financiero exportado",
  /^\s*processPagoIqFinancialPostingRequestOnWrite,\s*$/m.test(
    index,
  ) ||
    /export\s*\{\s*processPagoIqFinancialPostingRequestOnWrite\s*\}\s*from\s*["']\.\/modules\/iq\/pagoDepositCallables["'];?/m.test(
      index,
    ),
);

check(
  "schedulers globales siguen fuera",
  !/^\s*processIqPagoDepositReconciliationQueue,\s*$/m.test(
    index,
  ) &&
    !/^\s*processIqPagoDepositCreateQueue,\s*$/m.test(index),
);

console.log(`H4-D78-A8B QA PASS: ${passed} pruebas.`);