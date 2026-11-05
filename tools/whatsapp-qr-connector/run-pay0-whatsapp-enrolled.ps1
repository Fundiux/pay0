param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9-]{1,40}$')][string]$Agent,
 [Parameter(Mandatory=$true)][string]$ConfigFile,
 [string]$NodePath = 'C:\nvm4w\nodejs\node.exe'
)
# Supervisor del conector enrolado por servidor (uno por agente). No se ejecuta solo: lo lanza el dueno.
# Mutex por agente, relanzado con espera, parada limpia con stop.request y logs rotados fuera del repo.
$ErrorActionPreference='Stop'
$entry=Join-Path $PSScriptRoot 'enrolledLauncher.cjs'
$base=Join-Path $env:LOCALAPPDATA 'PAY0\WhatsAppConnector'
$control=Join-Path $base ('control\'+$Agent)
$logs=Join-Path $base 'logs'
$stop=Join-Path $control 'stop.request'
New-Item -ItemType Directory -Force -Path $control,$logs | Out-Null
function Rotate($file){
 if((Test-Path -LiteralPath $file) -and ((Get-Item -LiteralPath $file).Length -gt 5MB)){
  foreach($i in 2,1){ if(Test-Path -LiteralPath "$file.$i"){ if($i -eq 2){Remove-Item -LiteralPath "$file.2" -Force}else{Move-Item -LiteralPath "$file.1" "$file.2" -Force} } }
  Move-Item -LiteralPath $file "$file.1" -Force
 }
}
$mutex=[Threading.Mutex]::new($false,'Local\PAY0WhatsAppEnrolledSupervisor-'+$Agent)
$acquired=$false
try {
 try {$acquired=$mutex.WaitOne(0)} catch [Threading.AbandonedMutexException] {$acquired=$true}
 if(!$acquired){exit 0}
 if(!(Test-Path -LiteralPath $entry) -or !(Test-Path -LiteralPath $NodePath) -or !(Test-Path -LiteralPath $ConfigFile)){throw 'Connector runtime or config missing'}
 # Una parada pendiente de una corrida anterior se limpia solo al arrancar a proposito.
 if(Test-Path -LiteralPath $stop){Remove-Item -LiteralPath $stop -Force}
 $out=Join-Path $logs ($Agent+'.stdout.log'); $err=Join-Path $logs ($Agent+'.stderr.log')
 while(!(Test-Path -LiteralPath $stop)){
  $already=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine -like '*enrolledLauncher.cjs*' -and $_.CommandLine -like ('*'+$ConfigFile+'*')})
  if($already.Count){Start-Sleep -Seconds 15;continue}
  Rotate $out; Rotate $err
  $worker=Start-Process -FilePath $NodePath -ArgumentList @($entry,'run','--config',$ConfigFile) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  $worker.WaitForExit()
  if(Test-Path -LiteralPath $stop){break}
  Start-Sleep -Seconds 30
 }
} finally {if($acquired){$mutex.ReleaseMutex()};$mutex.Dispose()}
