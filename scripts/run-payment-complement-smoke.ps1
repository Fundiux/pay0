$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$env:DEBUG = ""

$firebaseCmd = Join-Path $env:APPDATA "npm\firebase.cmd"
if (-not (Test-Path -LiteralPath $firebaseCmd)) {
  throw "No existe Firebase CLI en: $firebaseCmd"
}

& $firebaseCmd emulators:exec `
  --only "firestore,storage" `
  --project "demo-pay0" `
  "node qa/scripts/payment-complement-automation-smoke.cjs"

if ($LASTEXITCODE -ne 0) {
  throw "El smoke de complementos terminó con código $LASTEXITCODE."
}
