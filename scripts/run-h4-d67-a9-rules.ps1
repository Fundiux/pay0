$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$firebaseCmd = Join-Path $env:APPDATA "npm\firebase.cmd"

if (-not (Test-Path -LiteralPath $firebaseCmd)) {
  throw "No existe Firebase CLI en: $firebaseCmd"
}

$oldPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"

& $firebaseCmd emulators:exec `
  --only "firestore,storage" `
  --project "pay0-system-rules-a9" `
  "node qa/scripts/h4-d67-a9-rules.mjs"

$exitCode = $LASTEXITCODE
$ErrorActionPreference = $oldPreference

if ($exitCode -ne 0) {
  throw "Las pruebas A9 de reglas terminaron con codigo $exitCode."
}