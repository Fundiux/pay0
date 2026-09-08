$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
node .\qa\scripts\h4-d66-a3.mjs
if ($LASTEXITCODE -ne 0) { throw "H4-D66-A3 QA fallo." }
