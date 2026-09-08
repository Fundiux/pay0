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

const helperStart = browser.indexOf(
  "async function selectIqApplicationFieldWithRetryH4D79A1(",
);

const helperEnd = browser.indexOf(
  "async function requireTaggedField(",
  helperStart,
);

check("helper dirigido existe", helperStart >= 0);
check("helper dirigido tiene cierre", helperEnd > helperStart);

const helper = browser.slice(helperStart, helperEnd);

check(
  "restaura espera solo para Deposito",
  helper.includes('params.field !== "DEPOSITO"') &&
    helper.includes("timeoutMs = 22000") &&
    helper.includes("pollMs = 650"),
);

check(
  "conserva folio exacto esperado",
  helper.includes("const expected = cleanText(params.expected)") &&
    helper.includes("lastCheck.ok"),
);

check(
  "reporta ready o timeout",
  helper.includes("H4_D79_A1_DEPOSITO_READY") &&
    helper.includes("H4_D79_A1_DEPOSITO_TIMEOUT"),
);

check(
  "helper no presiona Crear",
  ![
    "clickFinalSubmitAction(",
    "clickActionByText(",
    "submitClicked",
    "confirmationClicked",
  ].some((token) => helper.includes(token)),
);

check(
  "fallo nativo de Deposito permite fallback",
  browser.includes("if (nativeCheck?.ok)") &&
    browser.includes(
      'if (nativeCheck && field !== "DEPOSITO")',
    ),
);

check(
  "adapter canonico usa retry",
  browser.includes(
    "selectField: (params) =>\n            selectIqApplicationFieldWithRetryH4D79A1({",
  ),
);

check(
  "base canonica sigue separada",
  browser.includes(
    "A33_CANONICAL_BASE_ADAPTER_BEGIN",
  ) &&
    base.includes(
      "runCanonicalIqApplicationBaseFields",
    ),
);

check(
  "monto canonico sigue despues de la base",
  browser.includes(
    "A34_AMOUNT_ONLY_AFTER_CANONICAL_BASE",
  ) &&
    browser.includes(
      "fillIqApplicationAmountA34(",
    ),
);

check(
  "click final sigue separado",
  browser.includes(
    "async function clickFinalSubmitAction(",
  ),
);

check(
  "post submit sigue separado",
  browser.includes(
    "resolveIqApplicationIdFromListingA36(",
  ),
);

check(
  "ejecucion conserva fallo seguro",
  execution.includes(
    'browserResult.outcome === "NOT_SUBMITTED"',
  ) &&
    execution.includes(
      '? "FAILED_SAFE"',
    ),
);

check(
  "Functions siguen exportadas",
  /^\s*executePagoApplicationIqPlan,\s*$/m.test(index) &&
    /^\s*diagnosePagoApplicationIqMethods,\s*$/m.test(index),
);

check(
  "no agrega scheduler de Aplicacion IQ",
  !/onSchedule\([\s\S]{0,400}executePagoApplicationIqPlan/.test(
    browser,
  ) &&
    !/processIqPaymentApplicationQueue/.test(index),
);

console.log(
  `H4-D79-A1 QA PASS: ${passed} pruebas.`,
);