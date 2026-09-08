$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$projectId = "pay-0-system"

Write-Host "=== H4-D66-A9/A10 | Build Functions ===" -ForegroundColor Cyan
Push-Location functions
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Fallo build Functions." }
Pop-Location

Write-Host "=== H4-D66-A9/A10 | Regresiones compatibles ===" -ForegroundColor Cyan
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
  "qa/scripts/h4-d66-a9.mjs"
)

foreach ($test in $qa) {
  node $test
  if ($LASTEXITCODE -ne 0) { throw "Fallo QA: $test" }
}

Write-Host "=== H4-D66-A9/A10 | Validacion de seleccion por folio IQ ===" -ForegroundColor Cyan
$browser = Get-Content "functions\src\modules\paymentApplications\iqBrowser.ts" -Raw
$execution = Get-Content "functions\src\modules\paymentApplications\iqExecution.ts" -Raw

$required = @(
  'fieldChecks',
  'textMatchesIqFolio',
  'selectOptionFromTaggedControl',
  'requireTaggedField',
  'field: "DEPOSITO"',
  'field: "FACTURA"',
  'expected: cleanText(input.pagoIqFolio)',
  'expected: item.solicitudIqFolio'
)
foreach ($needle in $required) {
  if ($browser -notlike "*$needle*") { throw "Falta marcador requerido: $needle" }
  Write-Host "OK  $needle"
}

$execRequired = @(
  'asociadoName: access.profileAlias',
  'clienteName: cleanText(pago?.clienteNombre)',
  'empresaName: cleanText(pago?.empresaNombre)'
)
foreach ($needle in $execRequired) {
  if ($execution -notlike "*$needle*") { throw "Falta marcador de datos reales: $needle" }
  Write-Host "OK  $needle"
}

Write-Host "OK  patron: modulo -> + Nuevo -> drawer -> campos por etiqueta -> deposito/factura por folio IQ"

Write-Host "=== H4-D66-A9/A10 | Despliegue exclusivo de Function ===" -ForegroundColor Cyan
firebase use $projectId
if ($LASTEXITCODE -ne 0) { throw "No se pudo seleccionar $projectId." }

firebase deploy --project $projectId --only functions:executePagoApplicationIqPlan
if ($LASTEXITCODE -ne 0) { throw "Fallo despliegue executePagoApplicationIqPlan." }

Write-Host "H4-D66-A9/A10 desplegado." -ForegroundColor Green
Write-Host "No se ejecuto IQ, no se toco Hosting/Firestore y no se genero ZIP canonico."
Write-Host "Continua el mismo plan. Si falla antes de enviar, pega el diagnostico visible y no reintentes otra vez."
