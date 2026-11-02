param([ValidateSet('Prepare','Execute')][string]$Mode='Prepare')
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskScript=Join-Path $PSScriptRoot 'payment-iq-deposit-lease-sdk.test.cjs'
$taskProject='demo-pay0-iq-lease'
$taskPorts=@(18264,19264,14464,14564)
$taskProcess=$null;$taskCompleted=$false;$taskSaved=@{};$taskSummary=$null;$taskFailure=$null;$taskPortsClosed=$false
function Assert-PortsClosed {
 $taskListeners=[System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
 if(@($taskListeners|Where-Object {$_.Port -in $taskPorts}).Count -ne 0){throw 'EMULATOR_PORTS_NOT_CLOSED'}
}
$taskFailureEnums=@('FOLIO_SOURCE_PIN_MISMATCH','SOURCE_PIN_MISMATCH','FIXTURE_PIN_MISMATCH','NORMAL_BUILD_REQUIRED','CREDENTIAL_ENV_REJECTED','PROJECT_ENV_REJECTED','FIREBASE_CONFIG_REJECTED','EMULATOR_HOST_REJECTED','NODE_OPTIONS_REJECTED','EMULATOR_PORTS_NOT_CLOSED','CLI_VERSION_MISMATCH','CACHED_FIRESTORE_EMULATOR_REQUIRED_NO_DOWNLOAD','IGNORED_RUNTIME_REQUIRED','FIXTURE_SYNTAX_FAILED','PROCESS_HANDLE_REQUIRED','EMULATOR_GATE_WATCHDOG','PRIVATE_LOG_LIMIT','SDK_RESULT_REQUIRED','SDK_GATE_FAILED','OWN_PROCESS_TREE_CLEANUP_UNVERIFIED')
try {
 if((Get-FileHash -LiteralPath $taskScript -Algorithm SHA256).Hash -ne '09D38097C4B0A94AD00E6B893E9814ECE5696CD51EC2A22D93026E4E7D0B774B'){throw 'FIXTURE_PIN_MISMATCH'}
 if((Get-FileHash -LiteralPath (Join-Path $taskRoot 'functions/src/modules/iq/depositHttpCreateFirebaseAdapters.ts') -Algorithm SHA256).Hash -ne 'CF5AAC9D5C191B71CF2D8E4552E9BDDE58220C6EAFC7B9F9EEC345E34BD9A68C'){throw 'SOURCE_PIN_MISMATCH'}
 if(-not(Test-Path -LiteralPath (Join-Path $taskRoot 'functions/lib/modules/sequences/service.js')) -or (Test-Path -LiteralPath (Join-Path $taskRoot 'functions/.bundle-provenance.json'))){throw 'NORMAL_BUILD_REQUIRED'}
 foreach($key in @('GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE')){if([Environment]::GetEnvironmentVariable($key,'Process')){throw 'CREDENTIAL_ENV_REJECTED'}}
 foreach($key in @('GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT','GCP_PROJECT','GOOGLE_CLOUD_QUOTA_PROJECT','FIREBASE_PROJECT_ID')){$value=[Environment]::GetEnvironmentVariable($key,'Process');if($value -and $value -ne $taskProject){throw 'PROJECT_ENV_REJECTED'}}
 if($env:FIREBASE_CONFIG -and ($env:FIREBASE_CONFIG|ConvertFrom-Json).projectId -ne $taskProject){throw 'FIREBASE_CONFIG_REJECTED'}
 if($env:FIRESTORE_EMULATOR_HOST -and $env:FIRESTORE_EMULATOR_HOST -ne '127.0.0.1:18264'){throw 'EMULATOR_HOST_REJECTED'}
 if($env:NODE_OPTIONS){throw 'NODE_OPTIONS_REJECTED'}
 Assert-PortsClosed
 $taskCli=Join-Path (Split-Path (Get-Command firebase.cmd -ErrorAction Stop).Source) 'node_modules/firebase-tools/lib/bin/firebase.js'
 $taskCliRoot=Split-Path (Split-Path (Split-Path $taskCli))
 if((Get-Content -LiteralPath (Join-Path $taskCliRoot 'package.json') -Raw|ConvertFrom-Json).version -ne '15.3.1'){throw 'CLI_VERSION_MISMATCH'}
 $taskEmulatorInfo=Get-Content -LiteralPath (Join-Path $taskCliRoot 'lib/emulator/downloadableEmulatorInfo.json') -Raw|ConvertFrom-Json
 $taskCache=if($env:FIREBASE_EMULATORS_PATH){$env:FIREBASE_EMULATORS_PATH}else{Join-Path $env:USERPROFILE '.cache/firebase/emulators'}
 if(-not(Test-Path -LiteralPath (Join-Path $taskCache $taskEmulatorInfo.firestore.downloadPathRelativeToCacheDir) -PathType Leaf)){throw 'CACHED_FIRESTORE_EMULATOR_REQUIRED_NO_DOWNLOAD'}
 & node --check $taskScript *> $null
 if($LASTEXITCODE -ne 0){throw 'FIXTURE_SYNTAX_FAILED'}
 if($Mode -eq 'Prepare'){
  $taskSummary=[ordered]@{status='IQ_LEASE_DEMO_PREPARED';cliVersion='15.3.1';cachedJar=$true;networkStarted=$false;cloudCalls=0}
 }else{
  $taskRuntime=Join-Path $taskRoot ('.firebase/remediation-temp/payment-iq-lease-'+[guid]::NewGuid().ToString('N'))
  & git -C $taskRoot check-ignore --quiet -- ($taskRuntime.Replace($taskRoot+'\','').Replace('\','/')+'/firebase.json')
  if($LASTEXITCODE -ne 0){throw 'IGNORED_RUNTIME_REQUIRED'}
  [IO.Directory]::CreateDirectory($taskRuntime)|Out-Null
  $taskConfig=Join-Path $taskRuntime 'firebase.json';$taskRules=Join-Path $taskRuntime 'firestore.rules';$taskLauncher=Join-Path $taskRuntime 'fixture-launcher.cjs'
  [IO.File]::WriteAllText($taskRules,"rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }",[Text.UTF8Encoding]::new($false))
  $taskSettings=@{firestore=@{rules=$taskRules};emulators=@{firestore=@{host='127.0.0.1';port=18264;websocketPort=19264};ui=@{enabled=$false};hub=@{host='127.0.0.1';port=14464};logging=@{host='127.0.0.1';port=14564};singleProjectMode=$true}}
  [IO.File]::WriteAllText($taskConfig,($taskSettings|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  # Keep emulator CLI CWD/logs private while the fixture resolves this worktree's build.
  $taskJs='process.chdir('+($taskRoot|ConvertTo-Json -Compress)+');require('+($taskScript|ConvertTo-Json -Compress)+');'
  [IO.File]::WriteAllText($taskLauncher,$taskJs,[Text.UTF8Encoding]::new($false))
  foreach($key in @('TEMP','TMP','XDG_CONFIG_HOME','DEBUG','FIREBASE_CLI_DISABLE_USAGE','CI','NO_UPDATE_NOTIFIER','FIRESTORE_EMULATOR_HOST','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','PAY0_IQ_LEASE_REAL_SDK')){$taskSaved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
  $env:TEMP=$taskRuntime;$env:TMP=$taskRuntime;$env:XDG_CONFIG_HOME=Join-Path $taskRuntime 'cli';$env:DEBUG='';$env:FIREBASE_CLI_DISABLE_USAGE='true';$env:CI='true';$env:NO_UPDATE_NOTIFIER='1';$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:18264';$env:GCLOUD_PROJECT=$taskProject;$env:GOOGLE_CLOUD_PROJECT=$taskProject;$env:PAY0_IQ_LEASE_REAL_SDK='1'
  $taskStdout=Join-Path $taskRuntime 'stdout.log';$taskStderr=Join-Path $taskRuntime 'stderr.log'
  $taskArgs=@(('"'+$taskCli+'"'),'emulators:exec','--project',$taskProject,'--config',('"'+$taskConfig+'"'),'--only','firestore',('"node --test \"'+$taskLauncher+'\""'))
  $taskProcess=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList $taskArgs -WorkingDirectory $taskRuntime -WindowStyle Hidden -PassThru -RedirectStandardOutput $taskStdout -RedirectStandardError $taskStderr
  $taskNativeHandle=$taskProcess.Handle
  if($taskNativeHandle -eq 0){throw 'PROCESS_HANDLE_REQUIRED'}
  $taskDeadline=[DateTime]::UtcNow.AddSeconds(240)
  while(-not $taskProcess.WaitForExit(1000)){
   if([DateTime]::UtcNow -gt $taskDeadline){throw 'EMULATOR_GATE_WATCHDOG'}
   foreach($taskLog in @($taskStdout,$taskStderr)){if((Test-Path -LiteralPath $taskLog) -and (Get-Item -LiteralPath $taskLog).Length -gt 4194304){throw 'PRIVATE_LOG_LIMIT'}}
  }
  $taskProcess.Refresh();$taskExit=$taskProcess.ExitCode;$taskCompleted=$true
  if((Get-Item -LiteralPath $taskStdout).Length -gt 4194304){throw 'PRIVATE_LOG_LIMIT'}
  $taskLines=[IO.File]::ReadAllText($taskStdout) -split "`r?`n"|ForEach-Object {$_ -replace '^# ',''}
  $taskRecords=@($taskLines|Where-Object {$_ -match '^\{"status":"IQ_LEASE_DEMO_SDK_PASS"'}|ForEach-Object {$_|ConvertFrom-Json})
  $taskCleanups=@($taskLines|Where-Object {$_ -match '^\{"status":"IQ_LEASE_DEMO_CLEANUP"'}|ForEach-Object {$_|ConvertFrom-Json})
  if($taskRecords.Count -ne 1 -or $taskCleanups.Count -ne 1){throw 'SDK_RESULT_REQUIRED'}
  $taskResult=$taskRecords[0];$taskCleanup=$taskCleanups[0]
  $taskExpected=@('SAME_OWNER_TERMINAL_RELEASE','SAME_OWNER_UNKNOWN_RETRY_BLOCK_PRESERVED','STALE_OWNER_ZERO_RELEASE_WRITES','INJECTED_ABORTED_FRESH_OWNER_ZERO_RELEASE_COMMITS')
  if($taskExit -ne 0 -or $taskResult.checks.Count -ne 4 -or (($taskResult.checks -join '|') -ne ($taskExpected -join '|')) -or $taskResult.cleanup -ne 'EXACT_REFS_ABSENT' -or $taskCleanup.cleanupVerified -ne $true -or $taskCleanup.trackedRefs -ne 1 -or $taskResult.cloudCalls -ne 0 -or $taskResult.emulatorOnly -ne $true -or $taskResult.injectedAborted -ne $true){throw 'SDK_GATE_FAILED'}
  $taskSummary=[ordered]@{status='IQ_LEASE_DEMO_PASS';caseCount=4;ownedReferences=1;cleanupVerified=$true;cloudCalls=0;injectedAborted=$true;cliExit=$taskExit}
 }
}catch{
 $taskFailure=if($_.Exception.Message -in $taskFailureEnums){$_.Exception.Message}else{'RUNNER_FAILED'}
}finally{
 if($taskProcess -and -not $taskCompleted -and -not $taskProcess.HasExited){
  & taskkill.exe /PID $taskProcess.Id /T /F *> $null
  $taskKillExit=$LASTEXITCODE
  if(-not $taskProcess.WaitForExit(10000) -or $taskKillExit -ne 0){$taskFailure='OWN_PROCESS_TREE_CLEANUP_UNVERIFIED'}
 }
 foreach($key in $taskSaved.Keys){[Environment]::SetEnvironmentVariable($key,$taskSaved[$key],'Process')}
 try{Assert-PortsClosed;$taskPortsClosed=$true}catch{$taskFailure='EMULATOR_PORTS_NOT_CLOSED'}
 # Preserve all ignored config/rules/launcher/logs. Never delete a foreign process.
}
if($taskFailure){[ordered]@{status='IQ_LEASE_DEMO_FAILED';reason=$taskFailure;portsClosed=$taskPortsClosed;cleanup='REVIEW_PRIVATE_EVIDENCE'}|ConvertTo-Json -Compress;exit 1}
$taskSummary['portsClosed']=$taskPortsClosed;$taskSummary|ConvertTo-Json -Compress
