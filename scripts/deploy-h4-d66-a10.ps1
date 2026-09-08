$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$projectId = "pay-0-system"

Write-Host "=== H4-D66-A10 | Build Functions ===" -ForegroundColor Cyan
Push-Location functions
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Fallo build Functions." }
Pop-Location

Write-Host "=== H4-D66-A10 | Regresiones compatibles ===" -ForegroundColor Cyan
$qa = @(
  "qa/scripts/h4-d65-a0.mjs",
  "qa/scripts/h4-d65-a2.mjs",
  "qa/scripts/h4-d66-a1.mjs",
  "qa/scripts/h4-d66-a2.mjs",
  "qa/scripts/h4-d66-a3.mjs",
  "qa/scripts/h4-d66-a4.mjs",
  "qa/scripts/h4-d66-a5.mjs",
  "qa/scripts/h4-d66-a6.mjs",
  "qa/scripts/h4-d66-a9.mjs",
  "qa/scripts/h4-d66-a10.mjs"
)
foreach ($test in $qa) {
  node $test
  if ($LASTEXITCODE -ne 0) { throw "Fallo QA: $test" }
}

Write-Host "=== H4-D66-A10 | TypeScript frontend ===" -ForegroundColor Cyan
npx.cmd tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw "Fallo TypeScript frontend." }

Write-Host "=== H4-D66-A10 | Build Next productivo ===" -ForegroundColor Cyan
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Fallo build Next." }

Write-Host "=== H4-D66-A10 | Despliegue Function + Hosting ===" -ForegroundColor Cyan
firebase use $projectId
if ($LASTEXITCODE -ne 0) { throw "No se pudo seleccionar $projectId." }

firebase deploy --project $projectId --only functions:executePagoApplicationIqPlan,hosting
if ($LASTEXITCODE -ne 0) { throw "Fallo despliegue H4-D66-A10." }

Write-Host "H4-D66-A10 desplegado." -ForegroundColor Green
Write-Host "No se ejecuto IQ, no se toco Firestore y no se genero ZIP canonico."
Write-Host "El modal ya debe mostrar OK/NO por campo y detalle navegador."
