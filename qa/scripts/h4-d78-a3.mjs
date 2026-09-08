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

const startToken = "export const reconcilePagoIqDeposit = onCall(";
const endToken = "async function reconcilePagoIqDepositCoreH4D44(";
const start = source.indexOf(startToken);
const end = source.indexOf(endToken, start + startToken.length);

check("existe callable reconcilePagoIqDeposit", start >= 0);
check("callable tiene cierre determinista", end > start);

const callable = source.slice(start, end);

check(
  "marcador A3 presente",
  callable.includes("H4_D78_A3_CALLABLE_READS_ALL_IQ_FOLIO_ALIASES"),
);
check("callable lee iqDepositId", callable.includes("ctx.pago.iqDepositId"));
check("callable lee iqDepositFolio", callable.includes("ctx.pago.iqDepositFolio"));
check("callable lee iqPagoDepositId", callable.includes("ctx.pago.iqPagoDepositId"));
check(
  "callable lee iqPagoDepositFolio",
  callable.includes("ctx.pago.iqPagoDepositFolio"),
);
check(
  "callable entrega folio al buscador",
  callable.includes("iqId: existingIqId || undefined"),
);
check(
  "reconcilePagoIqDeposit sigue exportada",
  /^\s*reconcilePagoIqDeposit,\s*$/m.test(index),
);
check(
  "scheduler global de conciliacion sigue fuera",
  !/^\s*processIqPagoDepositReconciliationQueue,\s*$/m.test(index),
);
check(
  "scheduler global de creacion sigue fuera",
  !/^\s*processIqPagoDepositCreateQueue,\s*$/m.test(index),
);

console.log(`H4-D78-A3D QA PASS: ${passed} pruebas.`);