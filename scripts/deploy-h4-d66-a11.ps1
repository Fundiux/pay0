$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$projectId = "pay-0-system"

Write-Host "=== H4-D66-A11 | Build Functions ===" -ForegroundColor Cyan
Push-Location functions
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Fallo build Functions." }
Pop-Location

Write-Host "=== H4-D66-A11 | QA dirigido, no regresiones repetidas ===" -ForegroundColor Cyan
node qa/scripts/h4-d66-a11.mjs
if ($LASTEXITCODE -ne 0) { throw "Fallo QA H4-D66-A11." }

Write-Host "=== H4-D66-A11 | Build Next productivo ===" -ForegroundColor Cyan
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Fallo build Next." }

Write-Host "=== H4-D66-A11 | Deploy diagnostico + Hosting ===" -ForegroundColor Cyan
firebase use $projectId
if ($LASTEXITCODE -ne 0) { throw "No se pudo seleccionar $projectId." }

firebase deploy --project $projectId --only functions:diagnosePagoApplicationIqMethods,functions:executePagoApplicationIqPlan,hosting
if ($LASTEXITCODE -ne 0) { throw "Fallo deploy H4-D66-A11." }

Write-Host "H4-D66-A11 desplegado." -ForegroundColor Green
Write-Host "No se ejecuto IQ, no se toco Firestore y no se genero ZIP canonico."
Write-Host "Usa el boton Probar 3 metodos sin Crear; no marques la confirmacion final."
