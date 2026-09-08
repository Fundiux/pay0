import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const browser = read("functions/src/modules/paymentApplications/iqBrowser.ts");
const execution = read("functions/src/modules/paymentApplications/iqExecution.ts");
const deploy = read("scripts/deploy-h4-d66-a7.ps1");
const checkpoint = read("docs/checkpoints/H4-D66-A7-IQ-PAYMENT-APPLICATION-FORM-GATE.md");
const pkg = JSON.parse(read("package.json"));

let passed = 0;
const tests = [];
const test = (name, condition) => tests.push({ name, condition: Boolean(condition) });

console.log("\n=== H4-D66-A7 | Apertura robusta del formulario IQ ===");

test("el formulario real ya no se infiere por el titulo de la pagina", browser.includes("containerLooksReal") && browser.includes("hasDeposit && hasInvoice && hasAmount") && !browser.includes('return relevant.length >= 2 || /crear aplicacion|aplicar pago|aplicacion de pagos/i.test(text)'));
test("solo controles visibles y habilitados cuentan como formulario", browser.includes("getComputedStyle") && browser.includes("rect.width > 0") && browser.includes("!control.disabled"));
test("la compuerta reconoce campos nativos y combobox personalizados", browser.includes("input,select,textarea,[role='combobox']") && browser.includes("deposit|deposito|pago iq|payment") && browser.includes("invoice|factura|folio factura|solicitud"));
test("el disparador acepta Nuevo Nueva y etiquetas completas", browser.includes("NUEV[AO].{0,35}(APLICACION|PAGO)") && browser.includes("CREAR|REGISTRAR|AGREGAR") && browser.includes("APLICAR.{0,25}(PAGO|DEPOSITO)"));
test("el disparador excluye acciones destructivas o de detalle", browser.includes("ELIMINAR|BORRAR|CANCELAR|EDITAR|DETALLE|VER |CONCILIAR|RECHAZAR"));
test("la apertura admite menu en dos pasos sin tocar confirmar", browser.includes("for (let phase = 0; phase < 2; phase += 1)") && browser.includes("clickSafeApplicationFormTrigger") && browser.includes("waitForApplicationForm"));
test("existen rutas directas seguras de alta como fallback", browser.includes('"/payment-applications/new"') && browser.includes('"/payment-applications/create"') && browser.includes('"/payment-applications/crear"'));
test("el fallo conserva diagnostico de ruta controles y campos", browser.includes("IQ_PAYMENT_APPLICATION_FORM_DIAGNOSTIC_H4D66A7") && browser.includes("controls=${after.controls") && browser.includes("fields=${after.fields") && browser.includes("headings=${after.headings"));
test("el diagnostico se persiste en responseMessage y mensaje visible", browser.includes("result.responseMessage = applicationForm.diagnostics") && browser.includes("applicationForm.diagnostics") && execution.includes("responseMessage: cleanText(result.responseMessage)"));
test("la ejecucion sigue sin avanzar si no existe formulario real", browser.indexOf("if (!result.formOpened)") < browser.indexOf("const depositSelector = await tagControlByMeaning"));
test("el clic final sigue separado de la apertura", browser.indexOf("async function openApplicationForm") < browser.indexOf("async function clickFinalSubmitAction") && browser.includes("result.submitClicked = submit.clicked"));
test("A7 no agrega scheduler trigger complemento ni backfill", !browser.includes("onSchedule") && !browser.includes("onDocument") && !browser.includes("createPaymentComplement") && !browser.includes("backfill"));
test("el despliegue actualiza solo executePagoApplicationIqPlan", deploy.includes("functions:executePagoApplicationIqPlan") && !deploy.includes("hosting") && !deploy.includes("firestore:rules"));
test("el protocolo preserva el mismo plan y prohibe otro lote", checkpoint.includes("mismo plan") && checkpoint.includes("No crear otro lote") && checkpoint.includes("FAILED_SAFE"));
test("el comando QA A7 esta registrado", pkg.scripts?.["qa:pay0:h4-d66-a7"] === "powershell -ExecutionPolicy Bypass -File scripts/run-h4-d66-a7-qa.ps1");

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
console.log(`\nH4-D66-A7 QA PASS: ${passed} pruebas.`);
console.log("Formulario IQ detectado por campos reales, con apertura robusta y diagnostico seguro antes del clic final.");
