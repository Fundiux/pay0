$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$projectId = "pay-0-system"

Write-Host "=== H4-D66-A8B | Build Functions ===" -ForegroundColor Cyan
Push-Location functions
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Fallo build Functions." }
Pop-Location

Write-Host "=== H4-D66-A8B | Regresiones compatibles ===" -ForegroundColor Cyan
$qa = @(
  "qa/scripts/h4-d65-a0.mjs"
  "qa/scripts/h4-d65-a2.mjs"
  "qa/scripts/h4-d66-a1.mjs"
  "qa/scripts/h4-d66-a2.mjs"
  "qa/scripts/h4-d66-a3.mjs"
  "qa/scripts/h4-d66-a4.mjs"
  "qa/scripts/h4-d66-a5.mjs"
  "qa/scripts/h4-d66-a6.mjs"
  "qa/scripts/h4-d66-a8.mjs"
)

foreach ($test in $qa) {
  node $test
  if ($LASTEXITCODE -ne 0) { throw "Fallo QA: $test" }
}

Write-Host "=== H4-D66-A8B | Validacion de patron IQ usado por Solicitudes/Depositos ===" -ForegroundColor Cyan
$browser = Get-Content "functions\src\modules\paymentApplications\iqBrowser.ts" -Raw

$required = @(
  'IQ_PAYMENT_APPLICATION_ROUTE = "/payment-applications"',
  'clickSafeApplicationFormTrigger',
  'clickTopRightNewApplicationAction',
  'waitForApplicationForm',
  'captureApplicationFormSnapshot',
  'data-pay0-iq-field',
  'IQ_PAYMENT_APPLICATION_FORM_DIAGNOSTIC_H4D66A8'
)

foreach ($needle in $required) {
  if ($browser -notlike "*$needle*") {
    throw "Falta marcador requerido de apertura por modulo/drawer: $needle"
  }
  Write-Host "OK  $needle"
}

if ($browser -like '*/payment-applications/crear*' -and $browser -notlike '*No navegar a /payment-applications/crear*') {
  throw "Sigue existiendo navegacion real a /payment-applications/crear. No desplegar."
}

Write-Host "OK  sin fallback real a /payment-applications/crear"
Write-Host "OK  patron correcto: modulo -> + Nuevo -> drawer -> campos reales -> Crear separado"

Write-Host "=== H4-D66-A8B | Despliegue exclusivo de Function ===" -ForegroundColor Cyan
firebase use $projectId
if ($LASTEXITCODE -ne 0) { throw "No se pudo seleccionar $projectId." }

firebase deploy --project $projectId --only functions:executePagoApplicationIqPlan
if ($LASTEXITCODE -ne 0) { throw "Fallo despliegue executePagoApplicationIqPlan." }

Write-Host "H4-D66-A8B desplegado." -ForegroundColor Green
Write-Host "No se ejecuto IQ, no se toco Hosting/Firestore y no se genero ZIP canonico."
Write-Host "Continua el mismo plan. Si falla antes de enviar, pega el diagnostico visible y no reintentes otra vez."
