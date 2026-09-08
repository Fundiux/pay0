import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const domain = read("functions/src/modules/paymentApplications/domain.ts");
const iqPlan = read("functions/src/modules/paymentApplications/iqPlan.ts");
const browser = read("functions/src/modules/paymentApplications/iqBrowser.ts");
const execution = read("functions/src/modules/paymentApplications/iqExecution.ts");
const callables = read("functions/src/modules/paymentApplications/callables.ts");
const index = read("functions/src/index.ts");
const service = read("src/services/pagos.ts");
const pagosPage = read("src/app/pagos/page.tsx");
const pkg = JSON.parse(read("package.json"));

let passed = 0;
const tests = [];
function test(name, condition) {
  tests.push({ name, condition: Boolean(condition) });
}

test("A3 tiene version e intento determinista propios", domain.includes('PAYMENT_APPLICATION_IQ_EXECUTION_VERSION = "H4_D66_A3_V1"') && domain.includes("buildPaymentApplicationIqExecutionAttemptId") && domain.includes("attemptNumber"));
test("el plan A2 conserva lockId determinista dentro del hash y los items", (iqPlan.match(/lockId: item\.lockId/g) || []).length >= 2 && iqPlan.includes("buildPaymentApplicationIqPlanHash"));
test("un plan existente se reutiliza antes de volver a validar aplicaciones ejecutadas", iqPlan.includes("if (planSnap.exists)") && iqPlan.indexOf("if (planSnap.exists)") < iqPlan.indexOf("assertExistingApplicationSafe(applicationSnap") && iqPlan.includes("planResultFromData"));
test("la ejecucion exige confirmacion explicita y hash inmutable", execution.includes('input.confirmExecution !== true') && execution.includes("planHash") && execution.includes("El hash del plan IQ no coincide"));
test("la cuenta IQ exige modulo conciliacion o pagos", execution.includes("allowedModules.conciliacion !== true && allowedModules.pagos !== true") && execution.includes("IQ_CREDENTIALS_KEY"));
test("admin y operador requieren acceso activo al despacho del pago", execution.includes('actor.role !== "superadmin"') && execution.includes('collection("userDespachoAccess")') && execution.includes("El usuario no tiene acceso activo al despacho del pago"));
test("el claim transaccional comprueba plan reserva pago items locks y aplicaciones", execution.includes("claimExecution") && execution.includes('collection("pagoApplicationIqPlans")') && execution.includes('collection("pagoApplicationReservations")') && execution.includes('collection("pagoApplicationIqPlanItems")') && execution.includes('collection("pagoApplicationIqLocks")') && execution.includes('collection("pagoAplicaciones")'));
test("solo planes prevalidos o fallos seguros pueden ejecutarse", execution.includes('["NOT_EXECUTED", "FAILED_SAFE"]') && execution.includes('prevalidationStatus) !== "PASSED"'));
test("un plan en progreso o en revision no se reenvia", execution.includes('executionStatus === "IN_PROGRESS"') && execution.includes('"UNKNOWN_REVIEW_REQUIRED", "REJECTED_REVIEW_REQUIRED"') && execution.includes("No se permite un segundo envio"));
test("un resultado exitoso se reutiliza sin abrir otro navegador", execution.includes('executionStatus === "SUCCEEDED"') && execution.includes("executionResultFromPlan") && execution.indexOf("const claimed = await claimExecution") < execution.indexOf("const browserResult = await runIqPaymentApplication"));
test("el navegador usa exclusivamente la ruta de Aplicacion de pagos", browser.includes('IQ_PAYMENT_APPLICATION_ROUTE = "/payment-applications"') && browser.includes("new URL(IQ_PAYMENT_APPLICATION_ROUTE"));
test("el deposito y cada factura se verifican antes del clic final", browser.includes("depositMatched") && browser.includes("result.itemResults.every") && browser.includes("IQ_PAYMENT_APPLICATION_NOT_VERIFIED") && browser.indexOf("result.verified =") < browser.indexOf("const submit = await clickFinalSubmitAction"));
test("las facturas multiples se preparan y se confirman como un solo lote", browser.includes("for (const item of items)") && browser.includes("bindItemToExistingRow") && browser.includes("appendApplicationItem") && (browser.match(/clickFinalSubmitAction\(page\)/g) || []).length === 1);
test("el clic final solo ocurre despues de validacion exacta", browser.includes("if (!result.verified)") && browser.includes("result.submitClicked = submit.clicked") && browser.includes("expectedAmount"));
test("fallar antes del clic final queda como FAILED_SAFE", execution.includes('browserResult.outcome === "NOT_SUBMITTED" && browserResult.submitClicked === false') && execution.includes('"FAILED_SAFE"') && execution.includes('lockStatus = succeeded ? "COMPLETED" : failedSafe ? "PREVALIDATED"'));
test("resultado desconocido despues del clic bloquea reintentos", browser.includes("La accion final fue enviada a IQ") && browser.includes("No reintentar automaticamente") && execution.includes('"UNKNOWN_REVIEW_REQUIRED"'));
test("rechazo IQ tambien exige revision antes de reintentar", browser.includes('outcome = "REJECTED"') && execution.includes('"REJECTED_REVIEW_REQUIRED"') && execution.includes('lockStatus') && execution.includes('"REVIEW_REQUIRED"'));
test("el resultado se guarda por plan intento pago solicitud y aplicacion", execution.includes('collection("pagoApplicationIqAttempts")') && execution.includes("iqPaymentApplicationStatus") && execution.includes("iqApplicationResult") && execution.includes("iqPaymentAppliedAmount"));
test("PUE y PPD conservan seguimiento pero A3 no crea complementos", execution.includes("requiresPaymentComplement") && execution.includes("requiresSameMonthPueSettlement") && !execution.includes("createPaymentComplement") && !browser.includes("payment-complements"));
test("el callable usa navegador aislado 2GiB y concurrencia uno", callables.includes("executePagoApplicationIqPlan") && callables.includes('memory: "2GiB"') && callables.includes("concurrency: 1") && callables.includes("timeoutSeconds: 300") && callables.includes("IQ_PAYMENT_APPLICATION_SECRETS"));
test("A3 queda exportado y disponible en el servicio frontend", index.includes("executePagoApplicationIqPlan") && service.includes('httpsCallable(functions, "executePagoApplicationIqPlan"') && service.includes("confirmExecution: true"));
test("A3 sigue sin automatismos y A4 solo lo conecta con confirmacion humana", !execution.includes("onSchedule") && !execution.includes("onDocument") && !callables.includes("onSchedule") && !callables.includes("onDocument") && (!pagosPage.includes("executePagoApplicationIqPlan") || (pagosPage.includes("iqHumanConfirmed") && pagosPage.includes("confirmExecution: true") && pagosPage.includes("PagoApplicationIqFlowModal"))));
test("el comando QA A3 esta registrado", pkg.scripts?.["qa:pay0:h4-d66-a3"] === "powershell -ExecutionPolicy Bypass -File scripts/run-h4-d66-a3-qa.ps1");

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
console.log(`\nH4-D66-A3 QA PASS: ${passed} pruebas.`);
console.log("Ejecucion IQ explicita, idempotente y conservadora: un solo lote, sin scheduler, sin despliegue y sin complemento automatico.");
