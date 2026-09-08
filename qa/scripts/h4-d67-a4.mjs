import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const bytes = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath));

const index = read("functions/src/index.ts");
const canonicalBase = read(
  "functions/src/modules/paymentApplications/iqApplicationBaseFields.ts",
);
const browser = read(
  "functions/src/modules/paymentApplications/iqBrowser.ts",
);
const execution = read(
  "functions/src/modules/paymentApplications/iqExecution.ts",
);
const callables = read(
  "functions/src/modules/paymentApplications/callables.ts",
);
const financial = read(
  "functions/src/modules/deposits/financial.ts",
);
const modal = read("src/components/PagoApplicationIqFlowModal.tsx");
const pagosPage = read("src/app/pagos/page.tsx");
const gitignore = read(".gitignore");
const pkg = JSON.parse(read("package.json"));

function position(source, marker) {
  const value = source.indexOf(marker);
  assert.notEqual(value, -1, `Falta marcador: ${marker}`);
  return value;
}

function noBom(relativePath) {
  const data = bytes(relativePath);

  return !(
    data.length >= 3 &&
    data[0] === 0xef &&
    data[1] === 0xbb &&
    data[2] === 0xbf
  );
}

const removedSchedulers = [
  "discoverIqWorkCandidates",
  "processIqCreateQueue",
  "processIqInvoiceImportQueue",
  "processIqReconciliationQueue",
];

console.log("=== H4-D67-A4 | Baseline canonico actual ===");

const bootstrapPath = path.join(
  root,
  "functions",
  "src",
  "modules",
  "users",
  "bootstrap.ts",
);
assert.ok(
  !fs.existsSync(bootstrapPath),
  "bootstrap.ts sigue presente",
);
for (const pattern of [
  /^\s*export\s*\{[^}\r\n]*\bbootstrapSuperAdmin\b[^}\r\n]*\}\s*from\s*["'][^"']+["']\s*;?/m,
  /^\s*export\s+(?:const|let|var|function)\s+bootstrapSuperAdmin\b/m,
  /^\s*(?:const|let|var|function)\s+bootstrapSuperAdmin\b/m,
  /^\s*import\s+[^;\r\n]*\bbootstrapSuperAdmin\b[^;\r\n]*from\s*["'][^"']+["']\s*;?/m,
  /^\s*(?:import|export)[^;\r\n]*["']\.\/modules\/users\/bootstrap["']\s*;?/m,
]) {
  assert.doesNotMatch(index, pattern);
}
console.log("PASS bootstrapSuperAdmin retirado definitivamente");

for (const scheduler of removedSchedulers) {
  assert.ok(!index.includes(scheduler), `${scheduler} sigue exportada`);
}
assert.match(index, /processIqPagoDepositCreateQueueOnWrite/);
assert.match(index, /processIqPagoDepositOnDemandTask/);
console.log("PASS schedulers de Solicitudes retirados y Pagos bajo demanda conservado");

const associatedPosition = position(canonicalBase, 'field: "ASOCIADO"');
const clientPosition = position(canonicalBase, 'field: "CLIENTE"');
const companyPosition = position(canonicalBase, 'field: "EMPRESA"');
const depositPosition = position(canonicalBase, 'field: "DEPOSITO"');
const itemsPosition = position(canonicalBase, "for (const item of input.items)");

assert.ok(associatedPosition < clientPosition);
assert.ok(clientPosition < companyPosition);
assert.ok(companyPosition < depositPosition);
assert.ok(depositPosition < itemsPosition);
assert.match(
  canonicalBase,
  /field:\s*"DEPOSITO"[\s\S]{0,300}expected:\s*cleanText\(input\.pagoIqFolio\)[\s\S]{0,200}mode:\s*"FOLIO"/,
);
assert.match(canonicalBase, /IQ_PAYMENT_APPLICATION_DEPOSIT_NOT_MATCHED/);
assert.match(canonicalBase, /IQ_PAYMENT_APPLICATION_NOT_VERIFIED/);
console.log("PASS base IQ modular: Asociado Cliente Empresa Deposito Facturas");

assert.match(
  browser,
  /field:\s*"FACTURA"[\s\S]{0,220}expected:\s*item\.solicitudIqFolio[\s\S]{0,160}mode:\s*"FOLIO"/,
);
assert.match(browser, /textMatchesIqFolio/);
assert.match(browser, /requireTaggedField/);
assert.match(browser, /selectNativeIqApplicationField/);
console.log("PASS deposito y facturas se seleccionan semanticamente por folio");

const formOpenPosition = position(
  browser,
  "const applicationForm = await openApplicationForm",
);
const formGatePosition = position(browser, "if (!result.formOpened)");
const canonicalAdapterPosition = position(
  browser,
  "const canonicalBaseA33 =",
);
const amountPosition = position(
  browser,
  "const amountCheckA34 =",
);
const diagnosticPosition = position(
  browser,
  "if (input.diagnosticOnly === true || input.submit !== true)",
);
const submitPosition = position(
  browser,
  "const submit = await clickFinalSubmitAction",
);

assert.ok(formOpenPosition < formGatePosition);
assert.ok(formGatePosition < canonicalAdapterPosition);
assert.ok(canonicalAdapterPosition < amountPosition);
assert.ok(amountPosition < diagnosticPosition);
assert.ok(diagnosticPosition < submitPosition);
assert.match(browser, /IQ_PAYMENT_APPLICATION_FORM_NOT_OPENED/);
assert.match(
  browser,
  /result\.fieldChecks\.push\(\.\.\.canonicalBaseA33\.fieldChecks\)/,
);
assert.match(browser, /result\.submitClicked = submit\.clicked/);
console.log("PASS formulario real y verificaciones bloquean el clic final");

assert.match(execution, /input\.confirmExecution !== true/);
assert.match(execution, /fieldChecks:\s*result\.fieldChecks/);
assert.match(execution, /FAILED_SAFE/);
assert.match(execution, /UNKNOWN_REVIEW_REQUIRED/);
assert.match(execution, /REJECTED_REVIEW_REQUIRED/);
assert.doesNotMatch(execution, /onSchedule|onDocument/);
assert.doesNotMatch(callables, /onSchedule|onDocument/);
assert.match(callables, /memory:\s*"2GiB"/);
assert.match(callables, /concurrency:\s*1/);
assert.match(callables, /timeoutSeconds:\s*300/);
console.log("PASS ejecucion IQ humana, aislada y sin automatismos");

assert.match(modal, /Verificacion de campos IQ/);
assert.match(modal, /fieldChecks\.map/);
assert.match(modal, /Detalle navegador/);
assert.match(modal, /browserResponseMessage/);
assert.match(pagosPage, /iqHumanConfirmed/);
assert.match(pagosPage, /confirmExecution:\s*true/);
assert.match(pagosPage, /PagoApplicationIqFlowModal/);
console.log("PASS evidencia visible y confirmacion humana conservadas");

assert.match(financial, /db\.runTransaction/);
assert.match(financial, /financialPostingStatus/);
assert.match(financial, /PAGO_RECIBIDO_BRUTO/);
assert.match(financial, /COMISION_CLIENTE_COBRADA/);
assert.match(financial, /ADELANTO_LIQUIDADO/);
assert.match(financial, /UTILIDAD_GENERADA/);
assert.match(financial, /generatesClientBalance/);
assert.match(financial, /generatesUserEarnings/);
assert.match(financial, /allowsDispersion/);
assert.match(financial, /financialAssignmentSnapshot/);
console.log("PASS posteo financiero transaccional y banderas operativas presentes");

const bomTargets = [
  "functions/src/modules/paymentApplications/callables.ts",
  "functions/src/modules/paymentApplications/iqBrowser.ts",
  "functions/src/modules/iq/browserSession.ts",
  "src/app/pagos/page.tsx",
];

for (const target of bomTargets) {
  assert.ok(noBom(target), `${target} conserva BOM UTF-8`);
}

const authPath = path.join(root, "qa", ".auth", "superadmin.json");
assert.ok(!fs.existsSync(authPath), "qa/.auth/superadmin.json sigue empaquetable");
assert.match(gitignore, /^qa\/\.auth\/$/m);
console.log("PASS higiene UTF-8 y estado Playwright fuera del arbol entregable");

assert.equal(
  pkg.scripts["qa:pay0:h4-d67-a4"],
  "powershell -ExecutionPolicy Bypass -File scripts/run-h4-d67-a4-qa.ps1",
);
assert.equal(
  pkg.scripts["qa:pay0:h4-current"],
  "powershell -ExecutionPolicy Bypass -File scripts/run-h4-current-regression.ps1",
);

console.log("H4-D67-A4 QA OK");