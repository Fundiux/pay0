$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
Push-Location ".\functions"
try { npm.cmd run build }
finally { Pop-Location }
node.exe ".\qa\scripts\h4-d66-a5.mjs"
