$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "=== Build Functions ===" -ForegroundColor Cyan
Push-Location "functions"
npm run build
Pop-Location

Write-Host "=== H4-D76-A1 QA ===" -ForegroundColor Cyan
node "qa/scripts/h4-d76-a1.mjs"
