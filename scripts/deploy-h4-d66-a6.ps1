$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$projectId = "pay-0-system"

Write-Host "=== H4-D66-A6 | Build Functions ===" -ForegroundColor Cyan
Push-Location functions
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Fallo build Functions." }
Pop-Location

Write-Host "=== H4-D66-A6 | Regresiones ===" -ForegroundColor Cyan
$qa = @(
  "qa/scripts/h4-d65-a0.mjs",
  "qa/scripts/h4-d65-a2.mjs",
  "qa/scripts/h4-d66-a1.mjs",
  "qa/scripts/h4-d66-a2.mjs",
  "qa/scripts/h4-d66-a3.mjs",
  "qa/scripts/h4-d66-a4.mjs",
  "qa/scripts/h4-d66-a5.mjs",
  "qa/scripts/h4-d66-a6.mjs"
)
foreach ($test in $qa) {
  node $test
  if ($LASTEXITCODE -ne 0) { throw "Fallo QA: $test" }
}

Write-Host "=== H4-D66-A6 | Despliegue exclusivo de Function ===" -ForegroundColor Cyan
firebase use $projectId
if ($LASTEXITCODE -ne 0) { throw "No se pudo seleccionar $projectId." }
firebase deploy --project $projectId --only functions:executePagoApplicationIqPlan
if ($LASTEXITCODE -ne 0) { throw "Fallo despliegue executePagoApplicationIqPlan." }

Write-Host "H4-D66-A6 desplegado." -ForegroundColor Green
Write-Host "No se ejecuto IQ, no se toco Hosting y no se genero ZIP canonico."
Write-Host "Reanuda el mismo plan con un solo reintento seguro y pega la evidencia."
