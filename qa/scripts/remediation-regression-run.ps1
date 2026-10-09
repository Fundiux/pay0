$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskConfig = Join-Path ([System.IO.Path]::GetTempPath()) ('pay0-regression-' + [guid]::NewGuid().ToString('N') + '.json')
$previousConfigHome = $env:XDG_CONFIG_HOME
$previousAnalytics = $env:FIREBASE_CLI_DISABLE_USAGE
$previousDebug = $env:DEBUG
$env:DEBUG = ''
$env:XDG_CONFIG_HOME = $taskConfig + '-cli'
$env:FIREBASE_CLI_DISABLE_USAGE = 'true'
$taskSettings = @{
  firestore = @{ rules = (Join-Path $taskRoot 'firestore.rules') }
  storage = @{ rules = (Join-Path $taskRoot 'storage.rules') }
  emulators = @{
    firestore = @{ host = '127.0.0.1'; port = 18089 }
    storage = @{ host = '127.0.0.1'; port = 19199 }
    ui = @{ enabled = $false }
    hub = @{ host = '127.0.0.1'; port = 14409 }
    logging = @{ host = '127.0.0.1'; port = 14509 }
    singleProjectMode = $false
  }
}
[System.IO.File]::WriteAllText($taskConfig, ($taskSettings | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
Push-Location $taskRoot
try {
  & firebase.cmd emulators:exec --project demo-pay0-regression --config $taskConfig --only firestore,storage 'node qa/scripts/client-csf-create-regression.cjs && node qa/scripts/verify-regression-rules.mjs && node qa/scripts/verify-authorized-document-download.cjs'
  if ($LASTEXITCODE -ne 0) { throw "Integrated regression suite failed: $LASTEXITCODE" }
} finally {
  Pop-Location
  $env:XDG_CONFIG_HOME = $previousConfigHome
  $env:FIREBASE_CLI_DISABLE_USAGE = $previousAnalytics
  $env:DEBUG = $previousDebug
  Remove-Item -LiteralPath $taskConfig -Force
}
