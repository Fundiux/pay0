$ErrorActionPreference='Stop'
$entry='C:\Users\ebarr\Desktop\pay0-system\tools\whatsapp-qr-connector\connector.cjs'
$node='C:\nvm4w\nodejs\node.exe'
$control=Join-Path $env:LOCALAPPDATA 'PAY0\WhatsAppConnector\control'
$env:PAY0_QR_CONTROL_DIR=$control
$mutex=[Threading.Mutex]::new($false,'Local\PAY0WhatsAppConnectorSupervisor')
$acquired=$false
try {
 try {$acquired=$mutex.WaitOne(0)} catch [Threading.AbandonedMutexException] {$acquired=$true}
 if(!$acquired){exit 0}
 if(!(Test-Path -LiteralPath $entry) -or !(Test-Path -LiteralPath $node)){throw 'Connector runtime missing'}
 $working=Split-Path -Parent $entry
 while(!(Test-Path -LiteralPath (Join-Path $control 'stop.request'))){
  $already=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine -match '(recovery[\\/]live[\\/]connector\.cjs|tools[\\/]whatsapp-qr-connector[\\/]connector\.cjs)'})
  if($already.Count){Start-Sleep -Seconds 15;continue}
  $worker=Start-Process -FilePath $node -ArgumentList @($entry,'--execute-authorized-qr-recovery') -WorkingDirectory $working -WindowStyle Hidden -RedirectStandardOutput (Join-Path $working 'worker.stdout.log') -RedirectStandardError (Join-Path $working 'worker.stderr.log') -PassThru
  $worker.WaitForExit()
  if(Test-Path -LiteralPath (Join-Path $control 'stop.request')){break}
  Start-Sleep -Seconds 30
 }
} finally {if($acquired){$mutex.ReleaseMutex()};$mutex.Dispose()}
