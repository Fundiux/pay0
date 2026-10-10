$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskRuntime=Join-Path $taskRoot ('.firebase/remediation-temp/hugo-history-'+[guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($taskRuntime) | Out-Null
$taskConfig=Join-Path $taskRuntime 'firebase.json'
$taskRules=Join-Path $taskRuntime 'firestore.rules'
[System.IO.File]::WriteAllText($taskRules,"rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }",[System.Text.UTF8Encoding]::new($false))
$taskSaved=@{}
foreach($key in @('TEMP','TMP','XDG_CONFIG_HOME','DEBUG','FIREBASE_CLI_DISABLE_USAGE')){$taskSaved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
$env:TEMP=$taskRuntime
$env:TMP=$taskRuntime
$env:XDG_CONFIG_HOME=Join-Path $taskRuntime 'cli'
$env:DEBUG=''
$env:FIREBASE_CLI_DISABLE_USAGE='true'
$taskSettings=@{firestore=@{rules=$taskRules};emulators=@{firestore=@{host='127.0.0.1';port=18232;websocketPort=19232};ui=@{enabled=$false};hub=@{host='127.0.0.1';port=14432};logging=@{host='127.0.0.1';port=14532};singleProjectMode=$true}}
[System.IO.File]::WriteAllText($taskConfig,($taskSettings|ConvertTo-Json -Depth 5),[System.Text.UTF8Encoding]::new($false))
Push-Location $taskRoot
try{
 $taskNativePreference=$ErrorActionPreference
 try{
  $ErrorActionPreference='Continue'
  & firebase.cmd emulators:exec --project demo-pay0 --config $taskConfig --only firestore 'node qa/scripts/remediation-hugo-historical-emulator.test.cjs'
  $taskNativeExit=$LASTEXITCODE
 }finally{$ErrorActionPreference=$taskNativePreference}
 if($taskNativeExit -ne 0){throw 'Hugo historical emulator gate failed'}
}finally{
 Pop-Location
 foreach($key in $taskSaved.Keys){[Environment]::SetEnvironmentVariable($key,$taskSaved[$key],'Process')}
 Remove-Item -LiteralPath $taskConfig,$taskRules -Force -ErrorAction SilentlyContinue
 # Preserve ignored runtime diagnostics; never recursively remove shared temp files.
}
