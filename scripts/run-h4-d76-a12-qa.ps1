$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
Push-Location functions
npm run build
Pop-Location
foreach ($n in 1,2,3,5,6,7,8,9,10,11,12) { node "qa/scripts/h4-d76-a$n.mjs" }
