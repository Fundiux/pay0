$ErrorActionPreference = "Stop"

$root = Join-Path $env:USERPROFILE "Desktop\pay0-system"
if (-not (Test-Path -LiteralPath $root)) {
  throw "No se encontro el proyecto en: $root"
}

Set-Location $root

node ".\scripts\verify-h4-d66-a33-canonical-base.mjs"

if ($LASTEXITCODE -ne 0) {
  throw "Fallo verificacion canonica H4-D66-A33."
}