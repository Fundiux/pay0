$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$env:DEBUG = ""
$firebaseCmd = Join-Path $env:APPDATA "npm\firebase.cmd"
if (-not (Test-Path -LiteralPath $firebaseCmd)) { throw "Firebase CLI no disponible." }
& $firebaseCmd emulators:exec --only "firestore" --project "demo-pay0" "node qa/scripts/payment-complement-gates-emulator-smoke.cjs"
if ($LASTEXITCODE -ne 0) { throw "Las compuertas de complementos fallaron en emulador." }
