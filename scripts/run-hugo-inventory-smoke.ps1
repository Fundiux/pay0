$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$env:DEBUG = ""
$firebaseCmd = Join-Path $env:APPDATA "npm\firebase.cmd"
if (-not (Test-Path -LiteralPath $firebaseCmd)) { throw "Firebase CLI no disponible." }
& $firebaseCmd emulators:exec --only "firestore" --project "demo-pay0" "node qa/scripts/hugo-complement-inventory-emulator-smoke.cjs"
if ($LASTEXITCODE -ne 0) { throw "El inventario de Hugo falló en emulador." }
