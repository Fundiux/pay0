import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const domain = read("functions/src/modules/paymentApplications/domain.ts");
const iqPlan = read("functions/src/modules/paymentApplications/iqPlan.ts");
const callables = read("functions/src/modules/paymentApplications/callables.ts");
const index = read("functions/src/index.ts");
const service = read("src/services/pagos.ts");
const rules = read("firestore.rules");
const pkg = JSON.parse(read("package.json"));

let passed = 0;
const tests = [];
function test(name, condition) {
  tests.push({ name, condition: Boolean(condition) });
}

test("el plan IQ usa version y ids deterministas propios", domain.includes('PAYMENT_APPLICATION_IQ_PLAN_VERSION = "H4_D66_A2_V1"') && domain.includes("buildPaymentApplicationIqPlanId") && domain.includes("buildPaymentApplicationIqPlanItemId") && domain.includes("buildPaymentApplicationIqAttemptId") && domain.includes("buildPaymentApplicationIqLockId"));
test("la preparacion exige una reserva A1 compatible", iqPlan.includes("Primero reserva el lote de aplicacion PAY0") && iqPlan.includes("assertReservationCompatible") && iqPlan.includes('["RESERVED", "APPLIED"]'));
test("el pago requiere conciliacion y folio IQ numerico", iqPlan.includes('"CONCILIADO", "APLICADO_PARCIAL", "APLICADO_TOTAL"') && iqPlan.includes("getPagoIqFolio") && iqPlan.includes("normalizeIqNumericFolio"));
test("cada solicitud exige folio IQ y coincidencia cliente empresa", iqPlan.includes("getSolicitudIqFolio") && iqPlan.includes("assertPagoSolicitudMatch") && iqPlan.includes("assertRootScope"));
test("PUE permite parcialidades sin complemento y marca liquidacion mensual", !iqPlan.includes("debe liquidarse completa en una sola aplicacion") && iqPlan.includes('requiresSameMonthSettlement: invoiceType === "PUE" && balanceAfter > 0') && iqPlan.includes('"CONTINUE_PUE_PAYMENTS_WITHIN_MONTH"') && iqPlan.includes('"PUE_NO_COMPLEMENT_SAME_MONTH"'));
test("PPD queda marcado para complemento", iqPlan.includes('requiresComplement: invoiceType === "PPD"') && iqPlan.includes('"CREATE_PAYMENT_COMPLEMENT_AFTER_APPLICATION"'));
test("el plan se ordena y calcula hash inmutable", iqPlan.includes("preparedItems.sort") && iqPlan.includes("buildPaymentApplicationIqPlanHash") && iqPlan.includes("planHash"));
test("una solicitud con reserva activa ajena queda bloqueada", iqPlan.includes("isActiveForeignLock") && iqPlan.includes("ya esta reservada por otro lote"));
test("una aplicacion ya ejecutada en IQ queda bloqueada", iqPlan.includes("assertExistingApplicationSafe") && iqPlan.includes("iqActionExecuted === true") && iqPlan.includes("ya fue enviada o ejecutada en IQ"));
test("cada solicitud registra item intento y lock", iqPlan.includes('collection("pagoApplicationIqPlanItems")') && iqPlan.includes('collection("pagoApplicationIqAttempts")') && iqPlan.includes('collection("pagoApplicationIqLocks")'));
test("el intento A2 es exclusivamente prevalidacion", iqPlan.includes('attemptType: "PREVALIDATION_ONLY"') && iqPlan.includes('resultCode: "READY_FOR_IQ"') && iqPlan.includes('attemptNumber: 0'));
test("A2 declara cero ejecucion IQ en todos los documentos", (iqPlan.match(/iqActionExecuted: false/g) || []).length >= 7 && (iqPlan.match(/iqExecutionStatus: "NOT_EXECUTED"/g) || []).length >= 7);
test("el callable y servicio frontend exponen solo preparacion", callables.includes("preparePagoApplicationIqPlan") && callables.includes("preparePaymentApplicationIqPlan") && index.includes("preparePagoApplicationIqPlan") && service.includes('httpsCallable(functions, "preparePagoApplicationIqPlan")'));
test("A2 no importa navegador ni llama rutas IQ", !iqPlan.includes("browserSession") && !iqPlan.includes("playwright") && !iqPlan.includes("/payment-applications") && !iqPlan.includes("fetch("));
test("las reglas hacen las colecciones nuevas solo lectura cliente", rules.includes("match /pagoApplicationIqPlans/{planId}") && rules.includes("match /pagoApplicationIqPlanItems/{itemId}") && rules.includes("match /pagoApplicationIqAttempts/{attemptId}") && rules.includes("match /pagoApplicationIqLocks/{lockId}") && (rules.match(/allow create, update, delete: if false;/g) || []).length >= 4);
test("el comando QA A2 esta registrado", pkg.scripts?.["qa:pay0:h4-d66-a2"] === "powershell -ExecutionPolicy Bypass -File scripts/run-h4-d66-a2-qa.ps1");

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
console.log(`\nH4-D66-A2 QA PASS: ${passed} pruebas.`);
console.log("Plan IQ determinista y prevalidado, sin navegador, sin IQ real, sin despliegue y sin backfill.");
