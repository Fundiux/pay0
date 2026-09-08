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

const start = source.indexOf(
  "export const reconcilePagoIqDeposit = onCall(",
);
const end = source.indexOf(
  "async function reconcilePagoIqDepositCoreH4D44(",
  start,
);

check("callable existe", start >= 0);
check("callable tiene cierre", end > start);

const callable = source.slice(start, end);

check(
  "conserva cuatro alias IQ",
  [
    "ctx.pago.iqDepositId",
    "ctx.pago.iqDepositFolio",
    "ctx.pago.iqPagoDepositId",
    "ctx.pago.iqPagoDepositFolio",
  ].every((token) => callable.includes(token)),
);
check(
  "consulta el folio dirigido",
  callable.includes("iqId: existingIqId || undefined"),
);
check(
  "no prevalida ni prepara ni crea",
  !callable.includes("prevalidatePagoIqDeposit") &&
    !callable.includes("preparePagoIqDeposit") &&
    !callable.includes("createPagoIqDeposit"),
);
check(
  "no espera el posteo financiero",
  !callable.includes(
    "await postPagoFinancialsAfterIqConciliationH4D65A0",
  ),
);
check(
  "conserva decision local de posteo",
  callable.includes("shouldPostFinancialsH4D65A0"),
);
check(
  "encola posteo solo tras conciliacion",
  callable.includes(
    "shouldPostFinancialsH4D65A0 && effectiveConciliatedH4D64A6",
  ),
);
check(
  "respuesta conserva contrato financiero",
  callable.includes(
    'financialPostingStatus: financialPostingRequestIdH4D78A7 ? "QUEUED" : null',
  ),
);
check(
  "trigger asincrono existe",
  source.includes(
    "export const processPagoIqFinancialPostingRequestOnWrite = onDocumentUpdated(",
  ),
);
check(
  "trigger usa posteo canonico",
  source.includes(
    'source: "IQ_STATUS_CONFIRMED_ON_WRITE"',
  ) &&
    source.includes(
      "await postPagoFinancialsAfterIqConciliationH4D65A0({",
    ),
);
check(
  "trigger evita reprocesar mismo request",
  source.includes(
    "requestId === previousRequestId",
  ) &&
    source.includes(
      "requestId === processedRequestId",
    ),
);
check(
  "nueva Function exportada",
  /^\s*processPagoIqFinancialPostingRequestOnWrite,\s*$/m.test(
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

console.log(`H4-D78-A7B QA PASS: ${passed} pruebas.`);