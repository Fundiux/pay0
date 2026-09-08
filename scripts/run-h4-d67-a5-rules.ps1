$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$firebaseCmd = Join-Path $env:APPDATA "npm\firebase.cmd"

if (-not (Test-Path $firebaseCmd)) {
  throw "No existe Firebase CLI en: $firebaseCmd"
}

if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  throw "No se encontro Java en PATH."
}

$projectId = "pay0-system-rules-baseline"
$command = "node qa/scripts/h4-d67-a5-rules-baseline.mjs"

$oldPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"

& $firebaseCmd emulators:exec `
  --only "firestore,storage" `
  --project $projectId `
  $command

$exitCode = $LASTEXITCODE
$ErrorActionPreference = $oldPreference

if ($exitCode -ne 0) {
  throw "Las pruebas de reglas terminaron con codigo $exitCode."
}