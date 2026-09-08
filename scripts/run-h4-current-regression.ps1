$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$qaSuites = @(
  "qa:pay0:h4-d64-a6",
  "qa:pay0:h4-d65-a0",
  "qa:pay0:h4-d65-a2",
  "qa:pay0:h4-d66-a1",
  "qa:pay0:h4-d66-a2",
  "qa:pay0:h4-d66-a4",
  "qa:pay0:h4-d66-a5",
  "qa:pay0:h4-d66-a6",
  "qa:pay0:h4-d66-a11",
  "qa:pay0:h4-d67-a0",
  "qa:pay0:h4-d67-a4"
)

foreach ($qaSuite in $qaSuites) {
  Write-Host ""
  Write-Host "=== $qaSuite ===" -ForegroundColor Cyan

  & npm.cmd run $qaSuite

  if ($LASTEXITCODE -ne 0) {
    throw "Fallo suite canonica: $qaSuite"
  }
}

Write-Host ""
Write-Host "QA H4 CANONICO ACTUAL: 11/11 suites OK" -ForegroundColor Green