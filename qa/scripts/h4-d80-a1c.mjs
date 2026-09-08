import fs from "node:fs";

const browser = fs.readFileSync(
  "functions/src/modules/paymentApplications/iqBrowser.ts",
  "utf8",
);

const execution = fs.readFileSync(
  "functions/src/modules/paymentApplications/iqExecution.ts",
  "utf8",
);

const base = fs.readFileSync(
  "functions/src/modules/paymentApplications/iqApplicationBaseFields.ts",
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

const successStart = browser.indexOf(
  'result.outcome = "SUCCEEDED";',
);

const rejectedStart = browser.indexOf(
  "    if (rejected) {",
  successStart,
);

check("bloque post-submit existe", successStart >= 0);
check("bloque post-submit tiene cierre", rejectedStart > successStart);

const successBlock = browser.slice(
  successStart,
  rejectedStart,
);

check(
  "folio ausente queda CREATED_PENDING_FOLIO",
  successBlock.includes(
    "IQ_PAYMENT_APPLICATION_CREATED_PENDING_FOLIO",
  ),
);

check(
  "folio ausente no queda UNKNOWN_REVIEW_REQUIRED",
  !successBlock.includes(
    "IQ_PAYMENT_APPLICATION_UNKNOWN_REVIEW_REQUIRED",
  ),
);

check(
  "POST aceptado conserva outcome SUCCEEDED",
  successBlock.includes(
    'result.outcome = "SUCCEEDED"',
  ),
);

check(
  "no repite POST para resolver folio",
  !successBlock.includes(
    "clickFinalSubmitAction(",
  ),
);

check(
  "mantiene resolucion por lectura",
  successBlock.includes(
    "resolveIqApplicationIdFromListingA36(",
  ),
);

check(
  "mantiene espera de deposito H4-D79-A1",
  browser.includes(
    "H4_D79_A1_DEPOSIT_DEPENDENCY_RETRY",
  ),
);

check(
  "mantiene base canonica de campos",
  browser.includes(
    "A33_CANONICAL_BASE_ADAPTER_BEGIN",
  ) &&
    base.includes(
      "runCanonicalIqApplicationBaseFields",
    ),
);

check(
  "plan declara lifecycle canonico",
  execution.includes(
    "H4_D80_A1C_CANONICAL_PLAN_LIFECYCLE",
  ),
);

check(
  "plan distingue folio resuelto o pendiente",
  execution.includes(
    '"CREATED_CONFIRMED"',
  ) &&
    execution.includes(
      '"CREATED_PENDING_FOLIO"',
    ) &&
    execution.includes(
      '"RESOLVED"',
    ) &&
    execution.includes(
      '"PENDING"',
    ),
);

check(
  "plan es fuente canonica",
  execution.includes(
    'iqApplicationCanonicalVersion:\n        "H4_D80_A1C"',
  ) &&
    execution.includes(
      "iqApplicationFolioResolveRequired",
    ),
);

check(
  "origen de folio queda registrado",
  execution.includes(
    '"POST_SESSION_LISTING"',
  ) &&
    execution.includes(
      '"POST_ACCEPTED_FIELDS_VERIFIED"',
    ),
);

check(
  "rechazo sigue siendo terminal",
  execution.includes(
    'const rejected = browserResult.outcome === "REJECTED"',
  ),
);

check(
  "fallo seguro sigue sin envio",
  execution.includes(
    'browserResult.outcome === "NOT_SUBMITTED"',
  ) &&
    execution.includes(
      '? "FAILED_SAFE"',
    ),
);

check(
  "Function sigue exportada",
  /^\s*executePagoApplicationIqPlan,\s*$/m.test(
    index,
  ),
);

check(
  "no agrega scheduler",
  !/processIqPaymentApplicationQueue/.test(index) &&
    !/onSchedule\([\s\S]{0,500}executePagoApplicationIqPlan/.test(
      execution,
    ),
);

console.log(
  `H4-D80-A1C QA PASS: ${passed} pruebas.`,
);