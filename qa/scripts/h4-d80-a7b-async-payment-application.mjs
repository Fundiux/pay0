import fs from "node:fs";

const callables = fs.readFileSync(
  "functions/src/modules/paymentApplications/callables.ts",
  "utf8",
);

const index = fs.readFileSync(
  "functions/src/index.ts",
  "utf8",
);

const execution = fs.readFileSync(
  "functions/src/modules/paymentApplications/iqExecution.ts",
  "utf8",
);

const browser = fs.readFileSync(
  "functions/src/modules/paymentApplications/iqBrowser.ts",
  "utf8",
);

const contract = fs.readFileSync(
  "functions/src/modules/iq/canonicalOwnership.ts",
  "utf8",
);

const closure = fs.readFileSync(
  "docs/H4-D80-CIERRE-AUDITORIA-CANONICA.md",
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

check(
  "marker A7B existe",
  callables.includes(
    "H4_D80_A7B_ASYNC_PAYMENT_APPLICATION_EXECUTION",
  ),
);

check(
  "task usa import compatible existente",
  callables.includes(
    'from "firebase-functions/tasks"',
  ) &&
    !callables.includes(
      'from "firebase-functions/v2/tasks"',
    ),
);

const callableStart = callables.indexOf(
  "export const executePagoApplicationIqPlan = onCall(",
);

const taskStart = callables.indexOf(
  "export const processPagoApplicationIqPlanOnDemandTask",
);

check(
  "callable y task existen",
  callableStart >= 0 && taskStart > callableStart,
);

const callableBlock = callables.slice(
  callableStart,
  taskStart,
);

check(
  "callable encola",
  callableBlock.includes(
    "enqueuePaymentApplicationIqExecution",
  ),
);

check(
  "callable no abre navegador",
  !callableBlock.includes(
    "executePaymentApplicationIqPlan({",
  ),
);

const taskEnd = callables.indexOf(
  "export const diagnosePagoApplicationIqMethods",
  taskStart,
);

const taskBlock = callables.slice(
  taskStart,
  taskEnd,
);

check(
  "task ejecuta core canonico",
  taskBlock.includes(
    "executePaymentApplicationIqPlan({",
  ),
);

check(
  "task sin retry automatico",
  taskBlock.includes("maxAttempts: 1"),
);

check(
  "task no relanza error",
  taskBlock.includes(
    "la tarea no debe repetir automaticamente",
  ),
);

check(
  "task valida generacion",
  taskBlock.includes(
    "iqExecutionDispatchGeneration",
  ) &&
    taskBlock.includes(
      "H4_D80_A7B_STALE_TASK_OMITTED",
    ),
);

check(
  "task revalida usuario y root",
  taskBlock.includes(
    '.collection("users")',
  ) &&
    taskBlock.includes(
      "await getRootId(uid)",
    ),
);

check(
  "task exportada",
  /^\s*processPagoApplicationIqPlanOnDemandTask,\s*$/m.test(
    index,
  ),
);

check(
  "callable existente exportado",
  /^\s*executePagoApplicationIqPlan,\s*$/m.test(
    index,
  ),
);

check(
  "no agrega scheduler",
  !/onSchedule\s*\(/.test(callableBlock) &&
    !/onSchedule\s*\(/.test(taskBlock),
);

check(
  "A1C preservado",
  execution.includes(
    "H4_D80_A1C_CANONICAL_PLAN_LIFECYCLE",
  ) &&
    browser.includes(
      "IQ_PAYMENT_APPLICATION_CREATED_PENDING_FOLIO",
    ),
);

check(
  "contrato nueve capacidades preservado",
  [
    "CREATE_INVOICE",
    "RESOLVE_INVOICE_FOLIO",
    "SYNC_INVOICE_STATUS",
    "CREATE_DEPOSIT",
    "RESOLVE_DEPOSIT_FOLIO",
    "SYNC_DEPOSIT_STATUS",
    "CREATE_PAYMENT_APPLICATION",
    "RESOLVE_PAYMENT_APPLICATION_FOLIO",
    "SYNC_PAYMENT_APPLICATION_STATUS",
  ].every((value) =>
    contract.includes(`${value}:`),
  ),
);

check(
  "cierre no declara lote terminado",
  closure.includes(
    "pertenece al siguiente bloque de automatizaciÃ³n",
  ) &&
    closure.includes(
      "No estÃ¡ declarado como terminado",
    ),
);

check(
  "snapshot no se declara propietario",
  closure.includes(
    "referencia/snapshot inmutable",
  ) &&
    closure.includes(
      "no es fuente de verdad",
    ),
);

console.log(
  `H4-D80-A7B QA PASS: ${passed} pruebas.`,
);