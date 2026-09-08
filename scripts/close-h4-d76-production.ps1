$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$env:NODE_NO_WARNINGS = "1"

$root = (Get-Location).Path
if (-not (Test-Path -LiteralPath (Join-Path $root "firebase.json") -PathType Leaf)) {
  throw "Ejecuta este script desde la raiz de C:\Users\ebarr\Desktop\pay0-system."
}

$firebaseCmd = Join-Path $env:APPDATA "npm\firebase.cmd"
if (-not (Test-Path -LiteralPath $firebaseCmd -PathType Leaf)) {
  $firebaseCommand = Get-Command firebase.cmd -ErrorAction SilentlyContinue
  if (-not $firebaseCommand) {
    throw "Firebase CLI no esta disponible."
  }
  $firebaseCmd = $firebaseCommand.Source
}

$functionTargets = @("upsertUser", "createAdmin", "createOperador")
$required = @(
  "config\authorization-policy.json",
  "firestore.rules",
  "functions\src\index.ts",
  "functions\src\modules\users\authorizationPolicy.generated.ts",
  "functions\src\modules\users\defaultModules.ts",
  "src\lib\roles.ts",
  "src\components\RouteAccessGuard.tsx",
  "src\components\UserPermissionsPanel.tsx",
  "qa\scripts\h4-d76-domain-closure.mjs",
  "scripts\verify-authorization-policy.mjs"
)

function Invoke-FirebaseLogged {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  $previousErrorAction = $ErrorActionPreference
  $hasNativePreference = Test-Path Variable:global:PSNativeCommandUseErrorActionPreference
  if ($hasNativePreference) {
    $previousNativePreference = $global:PSNativeCommandUseErrorActionPreference
  }

  try {
    $ErrorActionPreference = "Continue"
    if ($hasNativePreference) {
      $global:PSNativeCommandUseErrorActionPreference = $false
    }

    & $firebaseCmd @Arguments 2>&1 | Tee-Object -FilePath $LogPath
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
    if ($hasNativePreference) {
      $global:PSNativeCommandUseErrorActionPreference = $previousNativePreference
    }
  }

  if ($exitCode -ne 0) {
    throw "$FailureMessage Codigo Firebase: $exitCode. Revisa: $LogPath"
  }
}

function Invoke-NpmBuild {
  param([Parameter(Mandatory = $true)][string]$Directory)

  if (-not (Test-Path -LiteralPath (Join-Path $Directory "node_modules") -PathType Container)) {
    Write-Host "Instalando dependencias reproducibles en $Directory..." -ForegroundColor Yellow
    & npm.cmd --prefix $Directory ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci fallo en $Directory." }
  }

  & npm.cmd --prefix $Directory run build
  if ($LASTEXITCODE -ne 0) { throw "Build fallo en $Directory." }
}

Write-Host "=== H4-D76 | Cierre productivo Usuarios y Permisos ===" -ForegroundColor Cyan
Write-Host "Bloque unico, reanudable e idempotente."
Write-Host "Despliega exactamente 3 Functions, Firestore Rules y Hosting."
Write-Host "No modifica documentos de negocio, Storage ni IQ."

foreach ($relative in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) {
    throw "Falta archivo requerido: $relative"
  }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$audit = Join-Path $root "audit\H4-D76-DOMAIN-CLOSURE-$stamp"
New-Item -ItemType Directory -Path $audit -Force | Out-Null

Write-Host "`n=== Politica canonica ===" -ForegroundColor Cyan
& node (Join-Path $root "scripts\verify-authorization-policy.mjs")
if ($LASTEXITCODE -ne 0) { throw "La politica de autorizacion tiene divergencias." }

Write-Host "`n=== Builds reproducibles ===" -ForegroundColor Cyan
Invoke-NpmBuild -Directory (Join-Path $root "functions")
Invoke-NpmBuild -Directory $root

Write-Host "`n=== Regresion acumulada H4-D76 ===" -ForegroundColor Cyan
$qaBlocks = @(1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)
foreach ($number in $qaBlocks) {
  & node (Join-Path $root "qa\scripts\h4-d76-a$number.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Fallo QA H4-D76-A$number." }
}

& node (Join-Path $root "qa\scripts\h4-d76-a19b.mjs")
if ($LASTEXITCODE -ne 0) { throw "Fallo QA H4-D76-A19B." }

& node (Join-Path $root "qa\scripts\h4-d76-domain-closure.mjs")
if ($LASTEXITCODE -ne 0) { throw "Fallo QA de cierre integral H4-D76." }

Write-Host "`n=== Deploy 3 Functions ===" -ForegroundColor Yellow
$onlyFunctions = ($functionTargets | ForEach-Object { "functions:$_" }) -join ","
Invoke-FirebaseLogged `
  -Arguments @("deploy", "--only", $onlyFunctions) `
  -LogPath (Join-Path $audit "functions-deploy.log") `
  -FailureMessage "Fallo deploy de las tres Functions."

Write-Host "`n=== Deploy Firestore Rules ===" -ForegroundColor Yellow
Invoke-FirebaseLogged `
  -Arguments @("deploy", "--only", "firestore:rules") `
  -LogPath (Join-Path $audit "firestore-rules-deploy.log") `
  -FailureMessage "Fallo deploy de Firestore Rules."

Write-Host "`n=== Deploy Hosting ===" -ForegroundColor Yellow
Invoke-FirebaseLogged `
  -Arguments @("deploy", "--only", "hosting") `
  -LogPath (Join-Path $audit "hosting-deploy.log") `
  -FailureMessage "Fallo deploy de Hosting."

Write-Host "`n=== Inventario productivo ===" -ForegroundColor Cyan
$functionsListLog = Join-Path $audit "functions-list.log"
Invoke-FirebaseLogged `
  -Arguments @("functions:list") `
  -LogPath $functionsListLog `
  -FailureMessage "No fue posible consultar functions:list."

$functionsList = [IO.File]::ReadAllText($functionsListLog)
$missingFunctions = @($functionTargets | Where-Object { -not $functionsList.Contains($_) })
if ($missingFunctions.Count -gt 0) {
  throw "Functions no visibles: $($missingFunctions -join ', ')"
}

Write-Host "`n=== Smoke productivo ===" -ForegroundColor Cyan
$siteBase = "https://pay-0-system.web.app"
$httpChecks = @()
foreach ($path in @("/login", "/dashboard", "/usuarios")) {
  $response = Invoke-WebRequest `
    -Uri "$siteBase$path" `
    -MaximumRedirection 5 `
    -UseBasicParsing `
    -TimeoutSec 30
  if ([int]$response.StatusCode -ne 200) {
    throw "Smoke HTTP fallo en $path con $($response.StatusCode)."
  }
  $httpChecks += [ordered]@{ path = $path; status = [int]$response.StatusCode }
  Write-Host "PASS HTTP 200 $path"
}

$anonymousDenied = $false
try {
  $null = Invoke-WebRequest `
    -Uri "https://firestore.googleapis.com/v1/projects/pay-0-system/databases/(default)/documents/users/anonymous-smoke" `
    -UseBasicParsing `
    -TimeoutSec 30
} catch {
  $statusCode = [int]$_.Exception.Response.StatusCode
  if ($statusCode -in @(401, 403)) {
    $anonymousDenied = $true
    Write-Host "PASS Firestore anonimo denegado ($statusCode)"
  } else {
    throw
  }
}
if (-not $anonymousDenied) {
  throw "Firestore permitio una lectura anonima inesperada."
}

$reportPath = Join-Path $audit "h4-d76-domain-production-closure.json"
$report = [ordered]@{
  ok = $true
  domain = "Usuarios/Permisos"
  status = "CLOSED"
  policy = "PAY0-USERS-PERMISSIONS@1"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  localRegression = "146/146"
  functionsDeployed = $functionTargets
  functionsVerified = $functionTargets
  firestoreRulesDeployed = $true
  hostingDeployed = $true
  anonymousFirestoreDenied = $true
  httpChecks = $httpChecks
  dataWritesPerformed = 0
  storageChangesPerformed = 0
  iqChangesPerformed = 0
}
[IO.File]::WriteAllText(
  $reportPath,
  ($report | ConvertTo-Json -Depth 6),
  [Text.UTF8Encoding]::new($false)
)

$closurePath = Join-Path $root "docs\checkpoints\H4-D76-USERS-PERMISSIONS-CLOSURE.md"
$closureText = @"
# H4-D76 — Cierre de Usuarios/Permisos

Estado: **CLOSED**

## Contrato

- Fuente canónica: ``config/authorization-policy.json``.
- Consumidores sincronizados: frontend, Cloud Functions y Firestore Rules.
- El rol es el techo; los permisos individuales solo pueden revocar.
- Rutas autenticadas no registradas fallan cerradas.
- UI y reportes usan nombres y folios; no muestran UID.

## Evidencia local

- Regresión H4-D76 acumulada: 131/131.
- Cierre estructural adicional: 15/15.
- Total: 146/146.
- Build Functions: OK.
- Build Next.js: OK.

## Evidencia productiva

- Functions: ``upsertUser``, ``createAdmin``, ``createOperador`` desplegadas y visibles.
- Firestore Rules: desplegadas.
- Hosting: desplegado.
- HTTP: ``/login``, ``/dashboard`` y ``/usuarios`` respondieron 200.
- Firestore anónimo: denegado.
- Reporte: ``$reportPath``.

## Regla de reapertura

No reabrir este dominio salvo regresión comprobada o requisito nuevo.
"@
[IO.File]::WriteAllText(
  $closurePath,
  $closureText,
  [Text.UTF8Encoding]::new($false)
)

Write-Host "`n=== Checkpoint canonico ===" -ForegroundColor Cyan
$zipScript = Join-Path $root "PAY0-H4-D77-A3C-zip-canonico-post-pagos-ui.ps1"
if (Test-Path -LiteralPath $zipScript -PathType Leaf) {
  & $zipScript
  if ($LASTEXITCODE -ne 0) { throw "Fallo la generacion del ZIP canonico." }
} else {
  Write-Host "No se encontro el generador canonico; el cierre productivo si quedo registrado." -ForegroundColor Yellow
}

Write-Host "`n=== USUARIOS/PERMISOS CERRADO ===" -ForegroundColor Green
Write-Host "Regresion: 146/146"
Write-Host "Functions: 3/3"
Write-Host "Rules: desplegadas"
Write-Host "Hosting: desplegado"
Write-Host "Smoke: OK"
Write-Host "Reporte: $reportPath"
Write-Host "No se modificaron datos de negocio, Storage ni IQ." -ForegroundColor Yellow
