$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
node .\qa\scripts\h4-d66-a2.mjs
if ($LASTEXITCODE -ne 0) { throw "H4-D66-A2 QA fallo." }
