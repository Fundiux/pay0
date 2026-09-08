$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host ""
Write-Host "=== H4-D65-A2 | Build Functions ===" -ForegroundColor Cyan
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
Write-Host "=== H4-D65-A2 | Regresion H4-D65-A0 ===" -ForegroundColor Cyan
& node.exe ".\qa\scripts\h4-d65-a0.mjs"
if ($LASTEXITCODE -ne 0) {
  throw "Fallo regresion H4-D65-A0."
}

Write-Host ""
Write-Host "=== H4-D65-A2 | QA cinco compuertas ===" -ForegroundColor Cyan
& node.exe ".\qa\scripts\h4-d65-a2.mjs"
if ($LASTEXITCODE -ne 0) {
  throw "Fallo QA H4-D65-A2."
}

Write-Host ""
Write-Host "=== H4-D65-A2 | TypeScript frontend ===" -ForegroundColor Cyan
& npx.cmd tsc --noEmit
if ($LASTEXITCODE -ne 0) {
  throw "Fallo TypeScript frontend."
}
