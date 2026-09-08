$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host ""
Write-Host "=== H4-D66-A1 | Build Functions ===" -ForegroundColor Cyan
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
Write-Host "=== H4-D66-A1 | Regresion H4-D65-A0 ===" -ForegroundColor Cyan
& node.exe ".\qa\scripts\h4-d65-a0.mjs"
if ($LASTEXITCODE -ne 0) {
  throw "Fallo regresion H4-D65-A0."
}

Write-Host ""
Write-Host "=== H4-D66-A1 | Regresion H4-D65-A2 ===" -ForegroundColor Cyan
& node.exe ".\qa\scripts\h4-d65-a2.mjs"
if ($LASTEXITCODE -ne 0) {
  throw "Fallo regresion H4-D65-A2."
}

Write-Host ""
Write-Host "=== H4-D66-A1 | QA reserva y lote atomico ===" -ForegroundColor Cyan
& node.exe ".\qa\scripts\h4-d66-a1.mjs"
if ($LASTEXITCODE -ne 0) {
  throw "Fallo QA H4-D66-A1."
}

Write-Host ""
Write-Host "=== H4-D66-A1 | TypeScript frontend ===" -ForegroundColor Cyan
& npx.cmd tsc --noEmit
if ($LASTEXITCODE -ne 0) {
  throw "Fallo TypeScript frontend."
}

Write-Host ""
Write-Host "H4-D66-A1 validado localmente." -ForegroundColor Green
Write-Host "NO se desplego, NO se genero ZIP y NO se ejecuto IQ real." -ForegroundColor Yellow
