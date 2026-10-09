param([ValidateSet('baseline','candidate','actual')][string]$Mode='candidate')
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskPreviousTemp=$env:TEMP
$taskPreviousTmp=$env:TMP
$taskRuntime=Join-Path $taskRoot ('.firebase/remediation-temp/'+[guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($taskRuntime) | Out-Null
$env:TEMP=$taskRuntime
$env:TMP=$taskRuntime
$taskConfig=Join-Path $taskRuntime 'firebase.json'
$taskPreviousXdg=$env:XDG_CONFIG_HOME
$taskXdg=Join-Path ([System.IO.Path]::GetTempPath()) ('pay0-restriction-xdg-'+[guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($taskXdg) | Out-Null
$env:XDG_CONFIG_HOME=$taskXdg
$taskPreviousDebug=$env:DEBUG
$env:DEBUG=''
$taskPreviousMode=$env:PAY0_RESTRICTION_RULES_MODE
$env:PAY0_RESTRICTION_RULES_MODE=$Mode
$taskSettings=@{firestore=@{rules=(Join-Path $taskRoot 'firestore.rules')};storage=@{rules=(Join-Path $taskRoot 'storage.rules')};emulators=@{firestore=@{host='127.0.0.1';port=18088;websocketPort=19088};storage=@{host='127.0.0.1';port=19198};ui=@{enabled=$false};hub=@{host='127.0.0.1';port=14408};logging=@{host='127.0.0.1';port=14508};singleProjectMode=$true}}
[System.IO.File]::WriteAllText($taskConfig,($taskSettings|ConvertTo-Json -Depth 5),[System.Text.UTF8Encoding]::new($false))
Push-Location $taskRoot
try {
 & firebase.cmd emulators:exec --project demo-pay0-restriction-boundaries --config $taskConfig --only firestore,storage 'node qa/scripts/remediation-restriction-boundaries.test.mjs'
 if($LASTEXITCODE -ne 0){throw "Restriction boundary emulator failed: $LASTEXITCODE"}
} finally {
 Pop-Location
 $env:DEBUG=$taskPreviousDebug
 $env:PAY0_RESTRICTION_RULES_MODE=$taskPreviousMode
 $env:XDG_CONFIG_HOME=$taskPreviousXdg
 $env:TEMP=$taskPreviousTemp
 $env:TMP=$taskPreviousTmp
 Remove-Item -LiteralPath $taskConfig -Force -ErrorAction SilentlyContinue
 if(Test-Path -LiteralPath $taskXdg){
  $taskResolvedXdg=(Resolve-Path -LiteralPath $taskXdg).Path
  $taskExpectedXdg=[System.IO.Path]::GetFullPath($taskXdg)
  $taskTempRoot=[System.IO.Path]::GetFullPath($taskRuntime).TrimEnd([System.IO.Path]::DirectorySeparatorChar)+[System.IO.Path]::DirectorySeparatorChar
  if($taskResolvedXdg -eq $taskExpectedXdg -and $taskResolvedXdg.StartsWith($taskTempRoot,[System.StringComparison]::OrdinalIgnoreCase) -and [System.IO.Path]::GetFileName($taskResolvedXdg).StartsWith('pay0-restriction-xdg-')){
   Remove-Item -LiteralPath $taskResolvedXdg -Recurse -Force -ErrorAction SilentlyContinue
  }else{throw 'Refusing cleanup outside the isolated runner configuration directory'}
 }
}
