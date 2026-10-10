$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskProject='demo-pay0-dispersion-notes'
foreach($key in @('GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN')) {
 if([Environment]::GetEnvironmentVariable($key,'Process')){throw 'Credential environment forbidden for local notes gate'}
}
foreach($key in @('GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','GCP_PROJECT','GOOGLE_CLOUD_QUOTA_PROJECT','FIREBASE_PROJECT_ID')) {
 $value=[Environment]::GetEnvironmentVariable($key,'Process')
 if($value -and $value -ne $taskProject){throw 'Non-demo project environment forbidden'}
}
if($env:FIRESTORE_EMULATOR_HOST -and $env:FIRESTORE_EMULATOR_HOST -ne '127.0.0.1:18246'){throw 'Unexpected emulator host'}
if($env:FIREBASE_CONFIG){if(($env:FIREBASE_CONFIG|ConvertFrom-Json).projectId -ne $taskProject){throw 'Non-demo Firebase config forbidden'}}
$taskRuntime=Join-Path $taskRoot ('.firebase/remediation-temp/notes-sdk-'+[guid]::NewGuid().ToString('N'))
& git -C $taskRoot check-ignore --quiet -- $taskRuntime
if($LASTEXITCODE -ne 0){throw "Local diagnostics directory must be ignored"}
[IO.Directory]::CreateDirectory($taskRuntime)|Out-Null
$taskConfig=Join-Path $taskRuntime 'firebase.json'
$taskRules=Join-Path $taskRuntime 'firestore.rules'
[IO.File]::WriteAllText($taskRules,"rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }",[Text.UTF8Encoding]::new($false))
$taskSettings=@{firestore=@{rules=$taskRules};emulators=@{firestore=@{host='127.0.0.1';port=18246;websocketPort=19246};ui=@{enabled=$false};hub=@{host='127.0.0.1';port=14446};logging=@{host='127.0.0.1';port=14546};singleProjectMode=$true}}
[IO.File]::WriteAllText($taskConfig,($taskSettings|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$taskSaved=@{}
foreach($key in @('TEMP','TMP','XDG_CONFIG_HOME','DEBUG','FIREBASE_CLI_DISABLE_USAGE','PAY0_NOTES_REAL_SDK','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','FIRESTORE_EMULATOR_HOST')){$taskSaved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
Push-Location $taskRoot
try {
 $env:TEMP=$taskRuntime;$env:TMP=$taskRuntime;$env:XDG_CONFIG_HOME=Join-Path $taskRuntime 'cli';$env:DEBUG='';$env:FIREBASE_CLI_DISABLE_USAGE='true';$env:PAY0_NOTES_REAL_SDK='1';$env:GCLOUD_PROJECT=$taskProject;$env:GOOGLE_CLOUD_PROJECT=$taskProject;$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:18246'
 $taskPreference=$ErrorActionPreference;$taskExit=$null
 try {
  $ErrorActionPreference='Continue';$global:LASTEXITCODE=$null
  & node scripts/run-firebase-clean-env.mjs emulators:exec --project $taskProject --config $taskConfig --only firestore 'node --test qa/scripts/remediation-dispersion-notes-read.test.cjs'
  $taskExit=$LASTEXITCODE
 } finally {$ErrorActionPreference=$taskPreference}
 if($null -eq $taskExit -or $taskExit -ne 0){throw 'Notes real SDK gate failed'}
} finally {
 Pop-Location
 foreach($key in $taskSaved.Keys){[Environment]::SetEnvironmentVariable($key,$taskSaved[$key],'Process')}
 Remove-Item -LiteralPath $taskConfig,$taskRules -Force -ErrorAction SilentlyContinue
}
exit 0