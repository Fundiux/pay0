$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host ""
Write-Host "=== H4-D64-A6 | Build Functions ===" -ForegroundColor Cyan
Push-Location ".\functions"
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Fallo build Functions." }
}
finally { Pop-Location }

Write-Host ""
Write-Host "=== H4-D64-A6 | QA aislada ===" -ForegroundColor Cyan
& node.exe ".\qa\scripts\h4-d64-a6.mjs"
if ($LASTEXITCODE -ne 0) { throw "Fallo QA H4-D64-A6." }
