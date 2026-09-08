$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectId = "pay-0-system"
$hostingUrl = "https://pay-0-system.web.app"
$deployTargets = @(
  "firestore:rules",
  "functions:reservePagoApplicationBatch",
  "functions:applyPagoToSolicitudesAtomic",
  "functions:applyPagoToSolicitud",
  "functions:preparePagoApplicationIqPlan",
  "functions:resumePagoApplicationIqPlan",
  "functions:executePagoApplicationIqPlan",
  "hosting"
) -join ","

Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

function Invoke-NodeQa([string]$RelativePath, [string]$Label) {
  Write-Host ""
  Write-Host "=== H4-D66-A5 | $Label ===" -ForegroundColor Cyan
  & node.exe $RelativePath
  if ($LASTEXITCODE -ne 0) { throw "Fallo $Label." }
}

Write-Host ""
Write-Host "=== H4-D66-A5 | Preflight de herramientas ===" -ForegroundColor Cyan
if (-not (Get-Command firebase.cmd -ErrorAction SilentlyContinue)) {
  throw "Firebase CLI no esta disponible. Instala o habilita firebase-tools antes de desplegar."
}
& firebase.cmd --version
if ($LASTEXITCODE -ne 0) { throw "No se pudo ejecutar Firebase CLI." }

$firebaserc = Get-Content ".firebaserc" -Raw | ConvertFrom-Json
if ([string]$firebaserc.projects.default -ne $projectId) {
  throw ".firebaserc no apunta a $projectId."
}

Write-Host ""
Write-Host "=== H4-D66-A5 | Build Functions ===" -ForegroundColor Cyan
Push-Location ".\functions"
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Fallo build de Functions." }
}
finally { Pop-Location }

Invoke-NodeQa ".\qa\scripts\h4-d65-a0.mjs" "Regresion H4-D65-A0"
Invoke-NodeQa ".\qa\scripts\h4-d65-a2.mjs" "Regresion H4-D65-A2"
Invoke-NodeQa ".\qa\scripts\h4-d66-a1.mjs" "Regresion H4-D66-A1"
Invoke-NodeQa ".\qa\scripts\h4-d66-a2.mjs" "Regresion H4-D66-A2 corregido"
Invoke-NodeQa ".\qa\scripts\h4-d66-a3.mjs" "Regresion H4-D66-A3"
Invoke-NodeQa ".\qa\scripts\h4-d66-a4.mjs" "Regresion H4-D66-A4"
Invoke-NodeQa ".\qa\scripts\h4-d66-a5.mjs" "QA H4-D66-A5"

Write-Host ""
Write-Host "=== H4-D66-A5 | TypeScript frontend ===" -ForegroundColor Cyan
& npx.cmd tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw "Fallo TypeScript frontend." }

Write-Host ""
Write-Host "=== H4-D66-A5 | Build Next productivo ===" -ForegroundColor Cyan
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Fallo build productivo de Next/Hosting." }

Write-Host ""
Write-Host "=== H4-D66-A5 | Proyecto Firebase ===" -ForegroundColor Cyan
& firebase.cmd use $projectId
if ($LASTEXITCODE -ne 0) { throw "No se pudo validar el proyecto Firebase $projectId. Revisa firebase login." }

Write-Host ""
Write-Host "=== H4-D66-A5 | Despliegue controlado ===" -ForegroundColor Cyan
Write-Host "Proyecto: $projectId"
Write-Host "Targets: $deployTargets"
& firebase.cmd deploy --project $projectId --only $deployTargets
if ($LASTEXITCODE -ne 0) { throw "Fallo el despliegue H4-D66-A5." }

Write-Host ""
Write-Host "=== H4-D66-A5 | Verificacion de Functions ===" -ForegroundColor Cyan
$functionList = (& firebase.cmd functions:list --project $projectId 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw "No se pudo listar Functions despues del despliegue." }
$requiredFunctions = @(
  "reservePagoApplicationBatch",
  "applyPagoToSolicitudesAtomic",
  "applyPagoToSolicitud",
  "preparePagoApplicationIqPlan",
  "resumePagoApplicationIqPlan",
  "executePagoApplicationIqPlan"
)
foreach ($functionName in $requiredFunctions) {
  if ($functionList -notmatch [regex]::Escape($functionName)) {
    throw "La Function $functionName no aparece desplegada."
  }
  Write-Host "OK  $functionName"
}

Write-Host ""
Write-Host "=== H4-D66-A5 | Verificacion de Hosting ===" -ForegroundColor Cyan
try {
  $response = Invoke-WebRequest -Uri $hostingUrl -Method Get -UseBasicParsing -TimeoutSec 60
  if ([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 400) {
    throw "Hosting respondio HTTP $($response.StatusCode)."
  }
  Write-Host "OK  $hostingUrl -> HTTP $($response.StatusCode)"
}
catch {
  throw "Hosting no respondio correctamente: $($_.Exception.Message)"
}

$protocolPath = Join-Path (Get-Location) "docs\checkpoints\H4-D66-A5-CONTROLLED-PRODUCTION-PILOT.md"
Write-Host ""
Write-Host "H4-D66-A5 desplegado correctamente." -ForegroundColor Green
Write-Host "Functions de Aplicacion de pagos: DESPLEGADAS." -ForegroundColor Green
Write-Host "Firestore rules: DESPLEGADAS." -ForegroundColor Green
Write-Host "Hosting/SSR: DESPLEGADO." -ForegroundColor Green
Write-Host "IQ real: TODAVIA NO EJECUTADO POR ESTE SCRIPT." -ForegroundColor Yellow
Write-Host ""
Write-Host "Siguiente accion manual controlada:" -ForegroundColor Yellow
Write-Host "1. Abre $hostingUrl/pagos"
Write-Host "2. Usa un solo pago aislado y una o dos facturas IQ."
Write-Host "3. Revisa el plan y confirma una sola vez."
Write-Host "4. Si aparece CLIENT_UNKNOWN o REVIEW_REQUIRED, NO reenvies."
Write-Host "5. Comparte el resultado completo del modal y la verificacion visual en IQ."
Write-Host "Protocolo: $protocolPath" -ForegroundColor DarkGray
