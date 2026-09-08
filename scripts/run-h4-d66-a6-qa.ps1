$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
node qa/scripts/h4-d66-a6.mjs
if ($LASTEXITCODE -ne 0) { throw "H4-D66-A6 QA fallo." }
