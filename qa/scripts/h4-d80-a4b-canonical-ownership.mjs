import fs from "node:fs";

const contract = fs.readFileSync(
  "functions/src/modules/iq/canonicalOwnership.ts",
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

let passed = 0;

function check(name, condition) {
  if (!condition) {
    console.error(`FAIL ${name}`);
    process.exit(1);
  }

  passed += 1;
  console.log(`PASS ${name}`);
}

const capabilities = [
  "CREATE_INVOICE",
  "RESOLVE_INVOICE_FOLIO",
  "SYNC_INVOICE_STATUS",
  "CREATE_DEPOSIT",
  "RESOLVE_DEPOSIT_FOLIO",
  "SYNC_DEPOSIT_STATUS",
  "CREATE_PAYMENT_APPLICATION",
  "RESOLVE_PAYMENT_APPLICATION_FOLIO",
  "SYNC_PAYMENT_APPLICATION_STATUS",
];

for (const capability of capabilities) {
  check(
    `capacidad ${capability}`,
    contract.includes(`${capability}:`),
  );
}

check(
  "version canonica A4B",
  contract.includes(
    '"H4_D80_A4B" as const',
  ),
);

check(
  "tres propietarios unicos",
  contract.includes(
    'owner: "IQ_SOLICITUDES"',
  ) &&
    contract.includes(
      'owner: "IQ_PAGO_DEPOSIT"',
    ) &&
    contract.includes(
      'owner: "PAYMENT_APPLICATIONS"',
    ),
);

check(
  "folios write once",
  contract.includes(
    'solicitudIqFolio: Object.freeze({',
  ) &&
    contract.includes(
      'pagoIqFolio: Object.freeze({',
    ) &&
    contract.includes(
      '"WRITE_ONCE_AFTER_RESOLUTION"',
    ),
);

check(
  "terminales congelados",
  contract.includes(
    "IQ_CANONICAL_TERMINAL_STATES",
  ) &&
    contract.includes('"REJECTED"') &&
    contract.includes('"CANCELLED"'),
);

check(
  "eventual consistency aplicacion",
  contract.includes(
    'acceptedPostWithVerifiedFields:\n      "CREATED_PENDING_FOLIO"',
  ) &&
    contract.includes(
      "repeatPostWhileFolioPending: false",
    ) &&
    contract.includes(
      'resolutionMode: "READ_ONLY"',
    ),
);

check(
  "implementacion actual pending folio",
  execution.includes(
    "H4_D80_A1C_CANONICAL_PLAN_LIFECYCLE",
  ) &&
    browser.includes(
      "IQ_PAYMENT_APPLICATION_CREATED_PENDING_FOLIO",
    ),
);

check(
  "clave y ventana de lote",
  contract.includes('"rootId"') &&
    contract.includes('"despachoId"') &&
    contract.includes(
      '"iqCredentialProfileId"',
    ) &&
    contract.includes(
      "IQ_CANONICAL_BATCH_WINDOW_MINUTES",
    ) &&
    contract.includes("5 as const"),
);

const dormant = [
  "processIqPagoDepositReconciliationQueue",
  "processIqPagoDepositCreateQueue",
  "processIqCreateQueue",
  "discoverIqWorkCandidates",
  "processIqInvoiceImportQueue",
  "processIqReconciliationQueue",
  "processIqStatusMonitorQueue",
];

for (const functionName of dormant) {
  check(
    `obsoleto no exportado ${functionName}`,
    !new RegExp(
      `^\\s*${functionName},\\s*$`,
      "m",
    ).test(index),
  );
}

const active = [
  "processIqPagoDepositCreateQueueOnWrite",
  "processIqPagoDepositOnDemandTask",
  "processPagoIqFinancialPostingRequestOnWrite",
];

for (const functionName of active) {
  check(
    `activo exportado ${functionName}`,
    new RegExp(
      `^\\s*${functionName},\\s*$`,
      "m",
    ).test(index),
  );
}

console.log(
  `H4-D80-A4B QA PASS: ${passed} pruebas.`,
);