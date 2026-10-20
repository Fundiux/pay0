$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskConfig = Join-Path ([System.IO.Path]::GetTempPath()) ('pay0-lineage-' + [guid]::NewGuid().ToString('N') + '.json')
$previousConfigHome = $env:XDG_CONFIG_HOME
$previousAnalytics = $env:FIREBASE_CLI_DISABLE_USAGE
$previousDebug = $env:DEBUG
$env:DEBUG = ''
$env:XDG_CONFIG_HOME = $taskConfig + '-cli'
$env:FIREBASE_CLI_DISABLE_USAGE = 'true'
$taskSettings = @{
  firestore = @{ rules = (Join-Path $taskRoot 'firestore.rules') }
  emulators = @{
    firestore = @{ host = '127.0.0.1'; port = 18216 }
    ui = @{ enabled = $false }
    hub = @{ host = '127.0.0.1'; port = 14416 }
    logging = @{ host = '127.0.0.1'; port = 14516 }
    singleProjectMode = $true
  }
}
[System.IO.File]::WriteAllText($taskConfig, ($taskSettings | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
Push-Location $taskRoot
try {
  & firebase.cmd emulators:exec --project demo-pay0-lineage --config $taskConfig --only firestore 'node qa/scripts/remediation-delegation-lineage-emulator.test.cjs'
  if ($LASTEXITCODE -ne 0) { throw "Lineage emulator suite failed: $LASTEXITCODE" }
} finally {
  Pop-Location
  $env:XDG_CONFIG_HOME = $previousConfigHome
  $env:FIREBASE_CLI_DISABLE_USAGE = $previousAnalytics
  $env:DEBUG = $previousDebug
  Remove-Item -LiteralPath $taskConfig -Force
}
