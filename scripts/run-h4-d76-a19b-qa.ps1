$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
Push-Location functions
try { npm run build } finally { Pop-Location }
node --check "tools/whatsapp-qr-connector/connector.cjs"
node "qa/scripts/h4-d76-a19b.mjs"
