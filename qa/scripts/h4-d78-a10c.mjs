import fs from "node:fs";

const source = fs.readFileSync(
  "functions/src/modules/iq/pagoDepositCallables.ts",
  "utf8",
);

const index = fs.readFileSync(
  "functions/src/index.ts",
  "utf8",
);

let passed = 0;

function check(name, condition) {
  if (!condition) {
    console.error(`FAIL ${name}`);
    process.exit(1);
  }

  passed += 1;
  console.log(`PASS ${name}`);
}

const callableStart = source.indexOf(
  "export const reconcilePagoIqDeposit = onCall(",
);

const coreStart = source.indexOf(
  "async function reconcilePagoIqDepositCoreH4D44(",
  callableStart + 1,
);

check("callable existe", callableStart >= 0);
check("core existe", coreStart > callableStart);

const callable = source.slice(callableStart, coreStart);
const core = source.slice(coreStart);

check(
  "A10B usa lector real de Diagnostico IQ",
  callable.includes(
    "H4_D78_A10B_DIAGNOSTIC_READER_IN_RECONCILE",
  ) &&
    callable.includes("runIqFindDepositCandidates({"),
);

check(
  "A10B conserva filtro anti reuso",
  callable.includes(
    "applyUsedPagoIqDepositCandidateFilterH4D61B24({",
  ),
);

check(
  "A10B prioriza folio exacto",
  callable.includes("EXACT_STORED_IQ_ID"),
);

check(
  "A10B construye match completo",
  [
    "rowText:",
    "rowCells:",
    "operationStatus:",
    "reconciliationStatus:",
    "matchStrategy:",
  ].every((token) => callable.includes(token)),
);

check(
  "boton no crea deposito",
  ![
    "prevalidatePagoIqDeposit(",
    "preparePagoIqDeposit(",
    "createPagoIqDeposit(",
    "runIqCreateDepositBatch(",
  ].some((token) => callable.includes(token)),
);

check(
  "boton no espera posteo financiero",
  !callable.includes(
    "await postPagoFinancialsAfterIqConciliationH4D65A0",
  ),
);

check(
  "boton solicita posteo solo tras conciliacion",
  callable.includes(
    "shouldPostFinancialsH4D65A0 && effectiveConciliatedH4D64A6",
  ) &&
    callable.includes("iqFinancialPostingRequestId"),
);

check(
  "onWrite financiero existe",
  source.includes(
    "export const processPagoIqFinancialPostingRequestOnWrite = onDocumentUpdated(",
  ),
);

check(
  "onWrite usa posteo canonico",
  source.includes(
    'source: "IQ_STATUS_CONFIRMED_ON_WRITE"',
  ) &&
    source.includes(
      "await postPagoFinancialsAfterIqConciliationH4D65A0({",
    ),
);

check(
  "onWrite evita reprocesar request",
  source.includes("requestId === previousRequestId") &&
    source.includes("requestId === processedRequestId") &&
    source.includes("iqFinancialPostingProcessedRequestId"),
);

check(
  "core automatico conserva posteo canonico",
  core.includes(
    "H4_D65_A0_CORE_RECONCILE_POSTS_FINANCIALS",
  ) &&
    core.includes(
      "await postPagoFinancialsAfterIqConciliationH4D65A0({",
    ),
);

check(
  "ruta historica conserva posteo canonico",
  source.includes(
    "H4_D65_A0_HISTORICAL_RECONCILE_POSTS_FINANCIALS",
  ),
);

check(
  "Functions necesarias exportadas",
  /^\s*reconcilePagoIqDeposit,\s*$/m.test(index) &&
    (
      /^\s*processPagoIqFinancialPostingRequestOnWrite,\s*$/m.test(index) ||
      /export\s*\{\s*processPagoIqFinancialPostingRequestOnWrite\s*\}\s*from\s*["']\.\/modules\/iq\/pagoDepositCallables["'];?/m.test(
        index,
      )
    ),
);

check(
  "schedulers globales siguen fuera",
  !/^\s*processIqPagoDepositReconciliationQueue,\s*$/m.test(
    index,
  ) &&
    !/^\s*processIqPagoDepositCreateQueue,\s*$/m.test(
      index,
    ),
);

check(
  "marcador inline obsoleto sigue fuera",
  !source.includes(
    "H4_D65_A0_MANUAL_RECONCILE_POSTS_FINANCIALS",
  ),
);

console.log(
  `H4-D78-A10C QA PASS: ${passed} pruebas.`,
);