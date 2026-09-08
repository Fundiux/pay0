import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const page = read("src/app/pagos/page.tsx");
const modal = read("src/components/PagoApplicationIqFlowModal.tsx");
const frontendService = read("src/services/pagos.ts");
const backendService = read("functions/src/modules/paymentApplications/service.ts");
const iqPlan = read("functions/src/modules/paymentApplications/iqPlan.ts");
const callables = read("functions/src/modules/paymentApplications/callables.ts");
const index = read("functions/src/index.ts");
const execution = read("functions/src/modules/paymentApplications/iqExecution.ts");
const pkg = JSON.parse(read("package.json"));

let passed = 0;
const tests = [];
const test = (name, condition) => tests.push({ name, condition: Boolean(condition) });

console.log("\n=== H4-D66-A4 | Integracion controlada en Pagos ===");

test("el pago atomico deja puntero recuperable antes de preparar IQ", backendService.includes("lastPaymentApplicationReservationId: reservationId") && backendService.includes('iqPaymentApplicationStatus: "PAY0_APPLIED_PENDING_IQ_PLAN"'));
test("el plan A2 deja identificadores recuperables en el pago", iqPlan.includes("iqPaymentApplicationPlanId: planId") && iqPlan.includes("iqPaymentApplicationReservationId: reservationId") && iqPlan.includes("iqPaymentApplicationPlanHash: planHash"));
test("la reanudacion reconstruye el lote desde la reserva backend", iqPlan.includes("resumePaymentApplicationIqPlan") && iqPlan.includes("normalizePaymentApplicationBatchInput") && iqPlan.includes("reservation?.applications") && iqPlan.includes("reservation?.idempotencyKey"));
test("la reanudacion conserva permisos y alcance", iqPlan.includes("assertRootScope(pago, params.actor.rootId)") && iqPlan.includes('assertEntityOwnership(pago, params.actor, "este pago")') && iqPlan.includes("La reserva de aplicacion esta fuera del alcance autorizado"));
test("el callable de reanudacion queda exportado", callables.includes("resumePagoApplicationIqPlan") && callables.includes("resumePaymentApplicationIqPlan") && index.includes("resumePagoApplicationIqPlan") && frontendService.includes('httpsCallable(functions, "resumePagoApplicationIqPlan")'));
test("Pagos aplica todo el lote en PAY0 antes de preparar IQ", page.indexOf("await applyPagoToSolicitudesAtomic") < page.indexOf("await preparePagoApplicationIqPlan") && page.includes("Lote PAY0 confirmado. Prevalidando deposito y facturas en IQ"));
test("la misma llave idempotente se conserva durante la preparacion", page.includes("const idempotencyKey = applyRequestKeyRef.current || createPagoApplicationIdempotencyKey()") && page.includes("idempotencyKey,") && page.includes("Reintentando prevalidacion con la misma reserva idempotente"));
test("la interfaz presenta deposito facturas tipos montos y saldos", modal.includes("Deposito IQ") && modal.includes("Factura IQ") && modal.includes("Folio PAY0") && modal.includes("Saldo antes") && modal.includes("Saldo despues") && modal.includes("invoiceType"));
test("PUE y PPD se explican antes de ejecutar", modal.includes("PPD: complemento pendiente") && modal.includes("PUE: liquidar dentro del mes") && modal.includes("PUE: liquidada, sin complemento"));
test("la ejecucion requiere checkbox humano explicito", modal.includes("Confirmo que revise el deposito IQ") && modal.includes("disabled={busy || !humanConfirmed}") && page.includes("if (!iqHumanConfirmed"));
test("A3 recibe confirmExecution true solo desde el handler humano", page.includes("executePreparedIqFlow") && page.includes("executePagoApplicationIqPlan") && page.includes("confirmExecution: true") && page.indexOf("if (!iqHumanConfirmed") < page.indexOf("confirmExecution: true"));
test("dobles clics quedan bloqueados en cliente", page.includes("iqFlowActionRef.current") && page.includes("setIqFlowBusy(true)") && modal.includes("disabled={busy || !humanConfirmed}"));
test("fallo seguro permite reintento con nueva confirmacion", page.includes('executionStatus === "FAILED_SAFE"') && page.includes('stage: "EXECUTING"') && modal.includes("Confirmar reintento seguro") && page.includes("setIqHumanConfirmed(false)"));
test("resultado cliente desconocido no ofrece reenvio directo", page.includes('stage: "CLIENT_UNKNOWN"') && modal.includes('const canRefresh = ["CLIENT_UNKNOWN", "IN_PROGRESS"].includes(stage)') && !modal.includes('const canExecute = ["READY", "FAILED_SAFE", "CLIENT_UNKNOWN"]'));
test("revision obligatoria no permite reintento", modal.includes('const canExecute = ["READY", "FAILED_SAFE"].includes(stage)') && modal.includes("REVIEW_REQUIRED") && page.includes('stage = executionStatus === "SUCCEEDED"'));
test("un pago pendiente oculta nuevas aplicaciones y muestra continuar", page.includes("isIqPaymentApplicationBlocking") && page.includes("!iqApplicationBlocking") && page.includes("Continuar aplicacion IQ pendiente"));
test("cerrar la ventana no ejecuta IQ", modal.includes("ninguna ejecucion IQ ocurre al abrir o cerrar esta ventana") && page.includes("setIqFlowOpen(false)") && !modal.includes("useEffect"));
test("A4 no agrega scheduler ni trigger", !execution.includes("onSchedule") && !execution.includes("onDocument") && !callables.includes("onSchedule") && !callables.includes("onDocument"));
test("A4 no crea complementos ni barre historicos", !page.includes("createPaymentComplement") && !iqPlan.includes("createPaymentComplement") && !callables.includes("backfill") && !callables.includes("onSchedule"));
test("el comando QA A4 esta registrado", pkg.scripts?.["qa:pay0:h4-d66-a4"] === "powershell -ExecutionPolicy Bypass -File scripts/run-h4-d66-a4-qa.ps1");

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
console.log(`\nH4-D66-A4 QA PASS: ${passed} pruebas.`);
console.log("Integracion visible y recuperable en Pagos, con confirmacion humana y sin automatismos ocultos.");
