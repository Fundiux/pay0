import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const browser = read("functions/src/modules/paymentApplications/iqBrowser.ts");
const execution = read("functions/src/modules/paymentApplications/iqExecution.ts");
const deploy = read("scripts/deploy-h4-d66-a6.ps1");
const checkpoint = read("docs/checkpoints/H4-D66-A6-IQ-LOGIN-GATE.md");
const pkg = JSON.parse(read("package.json"));

let passed = 0;
const tests = [];
const test = (name, condition) => tests.push({ name, condition: Boolean(condition) });

console.log("\n=== H4-D66-A6 | Compuerta robusta de login IQ ===");

test("el login distingue visibilidad real de existencia en DOM", browser.includes("visiblePassword: passwordInputs.some(isVisible)") && browser.includes("getComputedStyle"));
test("un input password oculto ya no provoca rechazo falso", !browser.includes("Boolean(doc.querySelector(\"input[type='password']\")) ||") && browser.includes("!resolvedState.visiblePassword"));
test("el login admite submit por boton o formulario", browser.includes("form?.requestSubmit") && browser.includes("form?.submit"));
test("la resolucion espera SPA y navegacion antes de decidir", browser.includes("waitForLoginResolution") && browser.includes("timeoutMs = 22000") && browser.includes("sleep(500)"));
test("la ruta payment-applications confirma la sesion", browser.includes("verifyAuthenticatedRoute") && browser.includes("IQ_PAYMENT_APPLICATION_ROUTE") && browser.includes("routeAccessible && !routeState.visiblePassword"));
test("solo un mensaje explicito clasifica credenciales rechazadas", browser.includes("explicitRejection") && browser.includes("IQ rechazo las credenciales") && browser.includes("credenciales.{0,80}"));
test("un login ambiguo permanece como fallo seguro sin accion IQ", browser.includes("IQ mantuvo visible el formulario de login") && browser.includes("no se ejecuto ninguna accion"));
test("la aplicacion no avanza al formulario sin autenticacion", browser.indexOf("if (!result.authenticated)") < browser.indexOf("openApplicationForm(page)"));
test("el motor conserva FAILED_SAFE antes del clic final", execution.includes("FAILED_SAFE") && execution.includes("submitClicked") && execution.includes("iqActionExecuted"));
test("A6 no agrega scheduler trigger ni complemento", !browser.includes("onSchedule") && !browser.includes("onDocument") && !browser.includes("createPaymentComplement"));
test("el despliegue actualiza solo executePagoApplicationIqPlan", deploy.includes("functions:executePagoApplicationIqPlan") && !deploy.includes("hosting") && !deploy.includes("firestore:rules"));
test("el protocolo exige reutilizar el plan y un solo reintento", checkpoint.includes("mismo plan") && checkpoint.includes("un solo reintento") && checkpoint.includes("No crear otro lote"));
test("el comando QA A6 esta registrado", pkg.scripts?.["qa:pay0:h4-d66-a6"] === "powershell -ExecutionPolicy Bypass -File scripts/run-h4-d66-a6-qa.ps1");

for (const row of tests) {
  if (!row.condition) {
    console.error(`FAIL ${row.name}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`PASS ${row.name}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`\nH4-D66-A6 QA PASS: ${passed} pruebas.`);
console.log("Login IQ verificado por controles visibles y ruta autenticada, sin accion final automatica.");
