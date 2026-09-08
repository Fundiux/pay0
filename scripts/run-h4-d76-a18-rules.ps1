$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$firebaseCmd = Join-Path $env:APPDATA "npm\firebase.cmd"
if (-not (Test-Path -LiteralPath $firebaseCmd)) {
  throw "No existe Firebase CLI en: $firebaseCmd"
}

$oldPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $firebaseCmd emulators:exec --only "firestore" --project "pay0-h4-d76-a18" "node qa/scripts/h4-d76-a18-rules.mjs"
$exitCode = $LASTEXITCODE
$ErrorActionPreference = $oldPreference
if ($exitCode -ne 0) {
  throw "Las pruebas H4-D76-A18 de reglas terminaron con codigo $exitCode."
}
