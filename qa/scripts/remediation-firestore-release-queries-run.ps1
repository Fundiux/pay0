param([string]$SourceRoot='.worktrees/pay0-remediation-integration-20261009')
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskSource=(Resolve-Path -LiteralPath (Join-Path $taskRoot $SourceRoot)).Path
$taskRuntime=Join-Path $taskRoot ('.firebase/remediation-temp/firestore-release-'+[guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($taskRuntime) | Out-Null
$taskConfig=Join-Path $taskRuntime 'firebase.json'
$taskSaved=@{}
foreach($key in @('TEMP','TMP','XDG_CONFIG_HOME','DEBUG','FIREBASE_CLI_DISABLE_USAGE','PAY0_RULES_SOURCE_ROOT')){$taskSaved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
$env:TEMP=$taskRuntime
$env:TMP=$taskRuntime
$env:XDG_CONFIG_HOME=Join-Path $taskRuntime 'cli'
$env:DEBUG=''
$env:FIREBASE_CLI_DISABLE_USAGE='true'
$env:PAY0_RULES_SOURCE_ROOT=$taskSource
$taskSettings=@{firestore=@{rules=(Join-Path $taskSource 'firestore.rules')};emulators=@{firestore=@{host='127.0.0.1';port=18228;websocketPort=19228};ui=@{enabled=$false};hub=@{host='127.0.0.1';port=14428};logging=@{host='127.0.0.1';port=14528};singleProjectMode=$true}}
[System.IO.File]::WriteAllText($taskConfig,($taskSettings|ConvertTo-Json -Depth 5),[System.Text.UTF8Encoding]::new($false))
Push-Location $taskRoot
try{
 $taskNativePreference=$ErrorActionPreference
 $taskExit=$null
 try {
  # Expected permission-denied probes write native stderr in Windows PowerShell.
  # Preserve diagnostics and use the actual process exit status for this gate.
  $ErrorActionPreference='Continue'
  $global:LASTEXITCODE=$null
  & firebase.cmd emulators:exec --project demo-pay0-firestore-release --config $taskConfig --only firestore 'node qa/scripts/remediation-firestore-release-queries.test.mjs'
  $taskExit=$LASTEXITCODE
 } finally {$ErrorActionPreference=$taskNativePreference}
 if($null -eq $taskExit -or $taskExit -ne 0){throw 'Firestore query release gate failed'}
}finally{
 Pop-Location
 foreach($key in $taskSaved.Keys){[Environment]::SetEnvironmentVariable($key,$taskSaved[$key],'Process')}
 # Keep ignored emulator diagnostics; no recursive cleanup or production access.
 Remove-Item -LiteralPath $taskConfig -Force -ErrorAction SilentlyContinue
}
