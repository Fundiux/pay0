$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Push-Location "functions"
npm run build
Pop-Location
node "qa/scripts/h4-d76-a1.mjs"
node "qa/scripts/h4-d76-a2.mjs"
node "qa/scripts/h4-d76-a3.mjs"
npx tsc --noEmit
