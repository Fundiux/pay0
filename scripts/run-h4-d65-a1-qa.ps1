$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host ""
Write-Host "=== H4-D65-A1 | Build Functions ===" -ForegroundColor Cyan
Push-Location ".\functions"
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "Fallo build de Functions."
  }
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "=== H4-D65-A1 | Auditoria financiera aislada ===" -ForegroundColor Cyan
& node.exe ".\qa\scripts\h4-d65-a1.mjs"
if ($LASTEXITCODE -ne 0) {
  throw "Fallo auditoria H4-D65-A1."
}
