param([switch]$PrerequisitesOnly, [switch]$SkipResourceBenchmarks)
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
# Dependencies are deliberately isolated and never downloaded by this gate.
$taskFrameworkRoot=Join-Path $taskRoot '.firebase/remediation-temp/notes-http-framework'
$taskPrerequisite='Prepare the isolated Functions Framework 5.0.5 dependency using the exact setup commands in docs/remediation/2026-10-09/FIRESTORE-SERVER-READ-TRANSITION.md (HTTP gate prerequisites); no product npm install is required.'
# Node supports the empty packages[""] key that PowerShell 5 JSON parsing rejects.
$taskPrerequisiteJs=@'
const fs=require('node:fs'),path=require('node:path');try{const root=process.argv[1],pkg=JSON.parse(fs.readFileSync(path.join(root,'node_modules/@google-cloud/functions-framework/package.json'),'utf8')),lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8')),pin=lock.packages['node_modules/@google-cloud/functions-framework'];if(pkg.name!=='@google-cloud/functions-framework'||pkg.version!=='5.0.5'||pin.version!=='5.0.5'||pin.resolved!=='https://registry.npmjs.org/@google-cloud/functions-framework/-/functions-framework-5.0.5.tgz'||pin.integrity!=='sha512-/w+OB1MxJux1uO9KRud4CRPLouaB7bZcy0v6STfFVh7yqafZ1L5coWIpseoKPLUgyNfawyoEfE2mEBDRZNGL2w==')process.exit(1);}catch{process.exit(1);}
'@
& node -e $taskPrerequisiteJs $taskFrameworkRoot
if($LASTEXITCODE -ne 0){throw $taskPrerequisite}
if(-not (Test-Path -LiteralPath (Join-Path $taskRoot 'functions/lib/modules/financing/noteReads.js'))){throw 'Run npm run build in functions before the real SDK/HTTP gate; compiled noteReads.js is required.'}
if($PrerequisitesOnly){Write-Output 'NOTES_HTTP_PREREQUISITES_PASS'; exit 0}
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
foreach($key in @('TEMP','TMP','XDG_CONFIG_HOME','DEBUG','FIREBASE_CLI_DISABLE_USAGE','PAY0_NOTES_REAL_SDK','PAY0_NOTES_SKIP_RESOURCE_BENCHMARKS','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','FIRESTORE_EMULATOR_HOST')){$taskSaved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
Push-Location $taskRoot
try {
 $env:PAY0_NOTES_SKIP_RESOURCE_BENCHMARKS=if($SkipResourceBenchmarks){'1'}else{'0'}
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
