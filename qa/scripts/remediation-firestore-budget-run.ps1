param([string]$SourceRoot='.',[switch]$Baseline,[switch]$QueryOnly,[switch]$BoundaryOnly)
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskSource=(Resolve-Path (Join-Path $taskRoot $SourceRoot)).Path
$taskRuntime=Join-Path $taskRoot ('.firebase/remediation-temp/budget-'+[guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($taskRuntime)|Out-Null
$taskConfig=Join-Path $taskRuntime 'firebase.json'
$taskSaved=@{}
foreach($k in @('TEMP','TMP','XDG_CONFIG_HOME','DEBUG','FIREBASE_CLI_DISABLE_USAGE','PAY0_RULES_SOURCE_ROOT')){$taskSaved[$k]=[Environment]::GetEnvironmentVariable($k,'Process')}
$env:TEMP=$taskRuntime;$env:TMP=$taskRuntime;$env:XDG_CONFIG_HOME=Join-Path $taskRuntime 'cli';$env:DEBUG='';$env:FIREBASE_CLI_DISABLE_USAGE='true';$env:PAY0_RULES_SOURCE_ROOT=$taskSource
$settings=@{firestore=@{rules=(Join-Path $taskSource 'firestore.rules')};storage=@{rules=(Join-Path $taskSource 'storage.rules')};emulators=@{firestore=@{host='127.0.0.1';port=18236;websocketPort=19236};storage=@{host='127.0.0.1';port=19196};ui=@{enabled=$false};hub=@{host='127.0.0.1';port=14436};logging=@{host='127.0.0.1';port=14536};singleProjectMode=$false}}
[System.IO.File]::WriteAllText($taskConfig,($settings|ConvertTo-Json -Depth 5),[System.Text.UTF8Encoding]::new($false))
Push-Location $taskRoot
try{
 $cmd='node qa/scripts/remediation-firestore-budget.test.cjs'
 if($Baseline){$cmd+=' --baseline'}
 if($QueryOnly){$cmd+=' --query-only'}
 if($BoundaryOnly){$cmd+=' --boundary-only'}
 $taskPref=$ErrorActionPreference;$taskExit=$null
 try{$ErrorActionPreference='Continue';$global:LASTEXITCODE=$null
  & node (Join-Path $taskRoot '.worktrees/pay0-remediation-integration-20261009/scripts/run-firebase-clean-env.mjs') emulators:exec --project demo-pay0-restriction-boundaries --config $taskConfig --only firestore,storage $cmd
  $taskExit=$LASTEXITCODE
 }finally{$ErrorActionPreference=$taskPref}
 if($null -eq $taskExit -or $taskExit -ne 0){throw 'Firestore evaluator budget gate failed'}
}finally{
 Pop-Location
 foreach($k in $taskSaved.Keys){[Environment]::SetEnvironmentVariable($k,$taskSaved[$k],'Process')}
 Remove-Item -LiteralPath $taskConfig -Force -ErrorAction SilentlyContinue
}

exit 0
