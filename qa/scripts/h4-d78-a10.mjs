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

check("callable encontrado", callableStart >= 0);
check("callable aislado", coreStart > callableStart);

const callable = source.slice(
  callableStart,
  coreStart,
);

check(
  "usa lector real del diagnostico",
  callable.includes(
    "H4_D78_A10_DIAGNOSTIC_READER_IN_RECONCILE",
  ) &&
    callable.includes(
      "await runIqFindDepositCandidates({",
    ),
);

check(
  "usa mismos limites del diagnostico",
  callable.includes("maxRows: 1000") &&
    callable.includes("limit: 15"),
);

check(
  "aplica filtro de folios ya usados",
  callable.includes(
    "applyUsedPagoIqDepositCandidateFilterH4D61B24({",
  ),
);

check(
  "prioriza folio exacto guardado",
  callable.includes(
    "EXACT_STORED_IQ_ID",
  ) &&
    callable.includes(
      "normalizeIqDepositNumericRefH4D58B(",
    ),
);

check(
  "solo adopta unico candidato sin folio",
  callable.includes(
    "diagnosticCandidatesH4D78A10.length === 1",
  ) &&
    callable.includes(
      "ONLY_FREE_CANDIDATE",
    ),
);

check(
  "conserva deteccion de conciliado",
  callable.includes(
    "effectiveConciliatedH4D64A6",
  ),
);

check(
  "conserva cierre terminal",
  callable.includes(
    "terminalOutcomeH4D64A6",
  ),
);

check(
  "no crea ni prepara deposito",
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
  "reconcile sigue exportada",
  /^\s*reconcilePagoIqDeposit,\s*$/m.test(index),
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

console.log(
  `H4-D78-A10 QA PASS: ${passed} pruebas.`,
);