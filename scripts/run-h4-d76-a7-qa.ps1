$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
Push-Location functions
npm run build
Pop-Location
node qa/scripts/h4-d76-a1.mjs
node qa/scripts/h4-d76-a2.mjs
node qa/scripts/h4-d76-a3.mjs
node qa/scripts/h4-d76-a5.mjs
node qa/scripts/h4-d76-a6.mjs
node qa/scripts/h4-d76-a7.mjs
