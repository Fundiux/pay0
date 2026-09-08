$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
node qa/scripts/h4-d66-a8.mjs
if ($LASTEXITCODE -ne 0) { throw "Fallo QA H4-D66-A8." }
