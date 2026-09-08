import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const iqPlan = read("functions/src/modules/paymentApplications/iqPlan.ts");
const modal = read("src/components/PagoApplicationIqFlowModal.tsx");
const page = read("src/app/pagos/page.tsx");
const execution = read("functions/src/modules/paymentApplications/iqExecution.ts");
const callables = read("functions/src/modules/paymentApplications/callables.ts");
const deploy = read("scripts/deploy-h4-d66-a5.ps1");
const checkpoint = read("docs/checkpoints/H4-D66-A5-CONTROLLED-PRODUCTION-PILOT.md");
const pkg = JSON.parse(read("package.json"));

let passed = 0;
const tests = [];
const test = (name, condition) => tests.push({ name, condition: Boolean(condition) });

console.log("\n=== H4-D66-A5 | Despliegue controlado y evidencia de piloto ===");

test("la reanudacion conserva evidencia del intento IQ", iqPlan.includes("iqExecutionAttemptId: cleanText(plan?.iqExecutionAttemptId)") && iqPlan.includes("iqExecutionResult: plan?.iqExecutionResult || null") && iqPlan.includes("actualIqAttemptCount"));
test("la interfaz muestra estado intento e identificador IQ", modal.includes("Evidencia del intento IQ") && modal.includes("Estado backend") && modal.includes("Aplicacion IQ") && modal.includes("Numero de intento"));
test("la interfaz muestra si hubo envio y confirmacion final", modal.includes("Envio final") && modal.includes("Confirmacion final") && modal.includes("submitClicked") && modal.includes("confirmationClicked"));
test("la evidencia enumera el resultado por factura", modal.includes("Factura IQ") && modal.includes("evidenceItems.map") && modal.includes("amountMatched") && modal.includes("VERIFIED"));
test("A5 mantiene confirmacion humana y no ejecuta al abrir", page.includes("if (!iqHumanConfirmed") && page.includes("confirmExecution: true") && modal.includes("ninguna ejecucion IQ ocurre al abrir o cerrar esta ventana"));
test("el motor conserva un solo clic final y proteccion post clic", execution.includes("submit: true") && execution.includes("UNKNOWN_REVIEW_REQUIRED") && execution.includes("REJECTED_REVIEW_REQUIRED") && execution.includes("FAILED_SAFE"));
test("no se agregaron schedulers ni triggers", !execution.includes("onSchedule") && !execution.includes("onDocument") && !callables.includes("onSchedule") && !callables.includes("onDocument"));
test("el despliegue apunta explicitamente a pay-0-system", deploy.includes('$projectId = "pay-0-system"') && deploy.includes("--project $projectId") && deploy.includes("pay-0-system.web.app"));
test("el despliegue incluye reglas funciones A1-A4 y hosting", deploy.includes("firestore:rules") && deploy.includes("reservePagoApplicationBatch") && deploy.includes("applyPagoToSolicitudesAtomic") && deploy.includes("preparePagoApplicationIqPlan") && deploy.includes("resumePagoApplicationIqPlan") && deploy.includes("executePagoApplicationIqPlan") && deploy.includes("hosting"));
test("el despliegue vuelve a ejecutar builds y 106 pruebas antes de produccion", deploy.includes("h4-d65-a0.mjs") && deploy.includes("h4-d65-a2.mjs") && deploy.includes("h4-d66-a1.mjs") && deploy.includes("h4-d66-a2.mjs") && deploy.includes("h4-d66-a3.mjs") && deploy.includes("h4-d66-a4.mjs") && deploy.includes("h4-d66-a5.mjs") && deploy.includes("npm.cmd run build"));
test("el protocolo exige un solo pago aislado y no reintentar resultados desconocidos", checkpoint.includes("un solo pago") && checkpoint.includes("No volver a confirmar") && checkpoint.includes("CLIENT_UNKNOWN") && checkpoint.includes("REVIEW_REQUIRED"));
test("A5 no genera complementos ni hace backfill", !modal.includes("createPaymentComplement") && !execution.includes("createPaymentComplement") && !deploy.includes("backfill") && checkpoint.includes("No incluye complementos PPD"));
test("el comando QA A5 esta registrado", pkg.scripts?.["qa:pay0:h4-d66-a5"] === "powershell -ExecutionPolicy Bypass -File scripts/run-h4-d66-a5-qa.ps1");

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
console.log(`\nH4-D66-A5 QA PASS: ${passed} pruebas.`);
console.log("Despliegue productivo controlado y evidencia recuperable para un piloto real aislado.");
