$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

node "qa\scripts\h4-d67-a4.mjs"

if ($LASTEXITCODE -ne 0) {
  throw "Fallo QA H4-D67-A4."
}