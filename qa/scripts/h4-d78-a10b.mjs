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
    "H4_D78_A10B_DIAGNOSTIC_READER_IN_RECONCILE",
  ) &&
    callable.includes(
      "await runIqFindDepositCandidates({",
    ),
);

check(
  "usa limites del diagnostico",
  callable.includes("maxRows: 1000") &&
    callable.includes("limit: 15"),
);

check(
  "aplica filtro anti reuso",
  callable.includes(
    "applyUsedPagoIqDepositCandidateFilterH4D61B24({",
  ),
);

check(
  "match queda mutable",
  callable.includes("let match: any ="),
);

check(
  "normaliza candidato a Record",
  callable.includes(
    "const selectedCandidateRecordH4D78A10B =",
  ),
);

check(
  "construye IqDepositStatusMatch completo",
  [
    "key: ctx.pagoId",
    "found: true",
    "iqId:",
    "rowText:",
    "rowCells:",
    "operationStatus:",
    "reconciliationStatus:",
    "matchStrategy:",
  ].every((token) => callable.includes(token)),
);

check(
  "prioriza folio guardado exacto",
  callable.includes("EXACT_STORED_IQ_ID"),
);

check(
  "solo adopta candidato unico sin folio",
  callable.includes(
    "diagnosticCandidatesH4D78A10B.length === 1",
  ) &&
    callable.includes("ONLY_FREE_CANDIDATE"),
);

check(
  "conserva deteccion conciliado",
  callable.includes(
    "effectiveConciliatedH4D64A6",
  ),
);

check(
  "conserva rechazo y cancelacion",
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
  `H4-D78-A10B QA PASS: ${passed} pruebas.`,
);