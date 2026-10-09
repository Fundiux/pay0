[CmdletBinding()]
param(
  [ValidateSet('Preflight','StageDryRun','Execute')][string]$Mode = 'Preflight',
  [switch]$LibraryOnly
)
$ErrorActionPreference = 'Stop'
$script:IqProject = 'pay-0-system'
$script:IqHead = 'c29260bef02192cdb98def40770bb8cb51378691'
$script:IqNames = @('processIqPagoDepositAutomaticTask','processIqPagoDepositCreateQueue','processIqPagoDepositOnDemandTask')
$script:IqExpected = @{
  processIqPagoDepositAutomaticTask = @('processiqpagodepositautomatictask-00001-gox','1791370236816575')
  processIqPagoDepositCreateQueue = @('processiqpagodepositcreatequeue-00020-naz','1791370286964567')
  processIqPagoDepositOnDemandTask = @('processiqpagodepositondemandtask-00034-jot','1790638545672827')
}
function Get-IqHash([byte[]]$Bytes) {
  $sha=[Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Get-IqMap($Object) {
  $map=@{}; if($null -ne $Object){ foreach($property in $Object.PSObject.Properties){ $map[$property.Name]=[string]$property.Value } }; return $map
}
function Test-IqMapEqual([hashtable]$Left,[hashtable]$Right) {
  if($Left.Count -ne $Right.Count){ return $false }
  foreach($key in $Left.Keys){ if(!$Right.ContainsKey($key) -or $Left[$key] -cne $Right[$key]){ return $false } }; return $true
}
function Get-IqUserEnv($Snapshot) {
  $managed=@('FIREBASE_CONFIG','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','GCP_PROJECT','FUNCTION_REGION','FUNCTION_TARGET','FUNCTION_SIGNATURE_TYPE','FUNCTION_NAME','K_SERVICE','K_REVISION','K_CONFIGURATION','PORT','EVENTARC_CLOUD_EVENT_SOURCE','LOG_EXECUTION_ID')
  $all=Get-IqMap $Snapshot.serviceConfig.environmentVariables; $user=@{}
  foreach($key in $all.Keys){ if($key -notin $managed){ if($key -notin @('PAY0_FIREBASE_WEB_API_KEY','PAY0_OPERATION_TIMING')){throw 'REMOTE_ENV_KEY_UNREVIEWED'}; $user[$key]=$all[$key] } }
  if(!$user.ContainsKey('PAY0_FIREBASE_WEB_API_KEY') -or $user.PAY0_FIREBASE_WEB_API_KEY -notmatch '^[A-Za-z0-9_-]{20,200}$'){throw 'API_KEY_CONTRACT_INVALID'}
  return $user
}
function Get-IqConfigFingerprint($Snapshot) {
  $s=$Snapshot.serviceConfig
  $secrets=@($s.secretEnvironmentVariables | ForEach-Object { "$($_.key):$($_.secret):$($_.version)" } | Sort-Object)
  if(($secrets -join '|') -cne 'IQ_CREDENTIALS_KEY:IQ_CREDENTIALS_KEY:2|TELEGRAM_BOT_TOKEN:TELEGRAM_BOT_TOKEN:1'){throw 'SECRET_BINDING_CHANGED'}
  return (@($s.timeoutSeconds,$s.availableMemory,$s.maxInstanceCount,$s.maxInstanceRequestConcurrency,$s.serviceAccountEmail,($secrets -join '|')) | ConvertTo-Json -Compress)
}
function Get-IqPlan([hashtable]$Snapshots) {
  $envs=@{}; $configs=@{}
  foreach($name in $script:IqNames){
    $s=$Snapshots[$name]; if(!$s -or $s.state -cne 'ACTIVE'){throw 'ENDPOINT_NOT_ACTIVE'}
    if($s.serviceConfig.revision -cne $script:IqExpected[$name][0] -or [string]$s.buildConfig.source.storageSource.generation -cne $script:IqExpected[$name][1]){throw 'REMOTE_SOURCE_CHANGED'}
    $envs[$name]=Get-IqUserEnv $s; $configs[$name]=Get-IqConfigFingerprint $s
    if($name -eq 'processIqPagoDepositOnDemandTask') { if($envs[$name].ContainsKey('PAY0_OPERATION_TIMING')){throw 'ONDEMAND_TIMING_CHANGED'} }
    elseif($envs[$name].PAY0_OPERATION_TIMING -cne '1'){throw 'AUTOMATIC_TIMING_CHANGED'}
  }
  if(!(Test-IqMapEqual $envs[$script:IqNames[0]] $envs[$script:IqNames[1]])){throw 'GROUP_ENV_MISMATCH'}
  if($envs[$script:IqNames[0]].PAY0_FIREBASE_WEB_API_KEY -cne $envs[$script:IqNames[2]].PAY0_FIREBASE_WEB_API_KEY){throw 'API_KEY_GROUP_MISMATCH'}
  return @{ Envs=$envs; Configs=$configs; Groups=@(@($script:IqNames[0],$script:IqNames[1]),@($script:IqNames[2])) }
}
function ConvertTo-IqDotenv([hashtable]$Map) {
  $lines=@(); foreach($key in @($Map.Keys | Sort-Object)){
    if($key -notin @('PAY0_FIREBASE_WEB_API_KEY','PAY0_OPERATION_TIMING') -or $Map[$key] -notmatch '^[A-Za-z0-9_-]+$'){throw 'DOTENV_SERIALIZATION_INVALID'}
    $lines += "$key=$($Map[$key])"
  }; return [Text.Encoding]::UTF8.GetBytes(($lines -join "`n")+"`n")
}
function Set-IqFileCas([string]$Target,[string]$ExpectedHash,[byte[]]$Bytes) {
  if(!(Test-Path -LiteralPath $Target) -or (Get-IqHash ([IO.File]::ReadAllBytes($Target))) -cne $ExpectedHash){throw 'LOCAL_ENV_CONFLICT'}
  $pending=$Target+'.iq-pending-'+[guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllBytes($pending,$Bytes)
  try {
    for($attempt=0;$attempt -lt 5;$attempt++){
      if((Get-IqHash ([IO.File]::ReadAllBytes($Target))) -cne $ExpectedHash){throw 'LOCAL_ENV_CONFLICT'}
      try { [IO.File]::Replace($pending,$Target,[NullString]::Value);break }
      catch [IO.IOException] {
        if($attempt -eq 4){throw 'LOCAL_ATOMIC_REPLACE_FAILED'}
        Start-Sleep -Milliseconds 100
      }
    }
  } finally { if(Test-Path -LiteralPath $pending){[IO.File]::Delete($pending)} }
}
function Invoke-IqEnvPhase([string]$Target,[byte[]]$Original,[byte[]]$Staged,[scriptblock]$Action,[scriptblock]$Journal) {
  $originalHash=Get-IqHash $Original; $stagedHash=Get-IqHash $Staged; $owns=$false
  & $Journal 'BEFORE_ENV_CHANGE'
  try {
    Set-IqFileCas $Target $originalHash $Staged; $owns=$true
    & $Journal 'ENV_STAGED'
    & $Action
  } finally {
    if($owns){
      if((Get-IqHash ([IO.File]::ReadAllBytes($Target))) -cne $stagedHash){ & $Journal 'RESTORE_CONFLICT_BACKUP_RETAINED'; throw 'LOCAL_ENV_CONFLICT_BACKUP_RETAINED' }
      Set-IqFileCas $Target $stagedHash $Original
      & $Journal 'ENV_RESTORED'
    }
  }
}
function Get-IqLiveSnapshot([string]$Name) {
  if($Name -notin $script:IqNames){throw 'FUNCTION_SCOPE_INVALID'}
  $token=(& gcloud.cmd auth print-access-token --project pay-0-system --quiet 2>$null | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $token -notmatch '^[A-Za-z0-9._~-]{20,4096}$'){throw 'AUTH_UNAVAILABLE'}
  $fields='state,buildConfig(source(storageSource(generation))),serviceConfig(revision,serviceAccountEmail,timeoutSeconds,availableMemory,maxInstanceCount,maxInstanceRequestConcurrency,environmentVariables,secretEnvironmentVariables(key,secret,version))'
  try {
    return Invoke-RestMethod -Method Get -Uri ('https://cloudfunctions.googleapis.com/v2/projects/pay-0-system/locations/us-central1/functions/'+$Name+'?fields='+[Uri]::EscapeDataString($fields)) -Headers @{Authorization="Bearer $token";'x-goog-user-project'='pay-0-system'} -TimeoutSec 30 -MaximumRedirection 0
  } catch {throw 'METADATA_READ_FAILED'} finally {$token=$null}
}
function Assert-IqPostflight($Before,$After,[hashtable]$ExpectedEnv,[string]$Config) {
  if($After.state -cne 'ACTIVE' -or $After.serviceConfig.revision -ceq $Before.serviceConfig.revision -or [string]$After.buildConfig.source.storageSource.generation -ceq [string]$Before.buildConfig.source.storageSource.generation){throw 'REVISION_POSTFLIGHT_FAILED'}
  if(!(Test-IqMapEqual (Get-IqUserEnv $After) $ExpectedEnv) -or (Get-IqConfigFingerprint $After) -cne $Config){throw 'CONFIG_POSTFLIGHT_FAILED'}
}
if($LibraryOnly){return}
try {
  $repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $worktree=[IO.Path]::GetFullPath((Join-Path $repository '.worktrees/pay0-remediation-integration-20261009'))
  $head=(& git -C $worktree rev-parse HEAD 2>$null | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $head -cne $script:IqHead){throw 'CANDIDATE_HEAD_CHANGED'}
  if((& git -C $worktree status --porcelain --untracked-files=no | Out-String).Trim()){throw 'CANDIDATE_DIRTY'}
  $target=Join-Path $worktree 'functions/.env.pay-0-system'
  $envFiles=@(Get-ChildItem -LiteralPath (Join-Path $worktree 'functions') -Force -File -Filter '.env*')
  if($envFiles.Count -ne 1 -or $envFiles[0].Name -cne '.env.pay-0-system'){throw 'DOTENV_SCOPE_AMBIGUOUS'}
  $original=[IO.File]::ReadAllBytes($target); $originalHash=Get-IqHash $original
  # Parse without printing values, rejecting duplicates/ambiguous/multiline assignments.
  $local=@{}; foreach($line in ([Text.Encoding]::UTF8.GetString($original) -split '\r?\n')){
    if(!$line.Trim() -or $line.TrimStart().StartsWith('#')){continue}
    if($line -notmatch '^([A-Z0-9_]+)=([A-Za-z0-9_-]+)$'){throw 'LOCAL_DOTENV_FORMAT_UNREVIEWED'}
    if($matches[1] -notin @('PAY0_FIREBASE_WEB_API_KEY','TELEGRAM_DOWNLOAD_TRANSPORT_MODE') -or $local.ContainsKey($matches[1])){throw 'LOCAL_DOTENV_KEY_UNREVIEWED'}
    $local[$matches[1]]=$matches[2]
  }
  $snapshots=@{}; foreach($name in $script:IqNames){$snapshots[$name]=Get-IqLiveSnapshot $name}
  $plan=Get-IqPlan $snapshots
  if($local.PAY0_FIREBASE_WEB_API_KEY -cne $plan.Envs[$script:IqNames[0]].PAY0_FIREBASE_WEB_API_KEY){throw 'LOCAL_API_KEY_MISMATCH'}
  if($Mode -eq 'Preflight'){Write-Output 'IQ_DEPOSIT_PREFLIGHT_PASS groups=2+1 cloudWrites=0 dotenvWrites=0';return}
  $privateBase=Join-Path $repository '.firebase/iq-deposit-deploy'
  $runDir=Join-Path $privateBase ([guid]::NewGuid().ToString('N'))
  [IO.Directory]::CreateDirectory($runDir)|Out-Null
  & git -C $repository check-ignore --quiet ($runDir+'/original.env')
  if($LASTEXITCODE -ne 0){throw 'PRIVATE_BACKUP_NOT_IGNORED'}
  [IO.File]::WriteAllBytes((Join-Path $runDir 'original.env'),$original)
  $stageBytes=@();foreach($group in $plan.Groups){$stageBytes+=,(ConvertTo-IqDotenv $plan.Envs[$group[0]])}
  $planHash=Get-IqHash ([Text.Encoding]::UTF8.GetBytes(($head+'|'+$originalHash+'|'+((@($stageBytes|ForEach-Object{Get-IqHash $_})) -join '|'))))
  $journalFile=Join-Path $runDir 'journal.jsonl'
  $journal={param($state) [IO.File]::AppendAllText($journalFile,((@{at=[DateTime]::UtcNow.ToString('o');state=$state;mode=$Mode;phase=$phase;head=$head;planHash=$planHash;originalHash=$originalHash}|ConvertTo-Json -Compress)+"`n"))}
  $phase=0;& $journal 'PREPARED'
  for($i=0;$i -lt 2;$i++){[IO.File]::WriteAllBytes((Join-Path $runDir ('group'+($i+1)+'.env')),$stageBytes[$i])}
  if($Mode -eq 'StageDryRun'){
    if((Get-IqHash ([IO.File]::ReadAllBytes($target))) -cne $originalHash){throw 'LOCAL_ENV_CONFLICT'}
    & $journal 'DRY_RUN_COMPLETE';Write-Output 'IQ_DEPOSIT_STAGE_DRY_RUN_PASS cloudWrites=0 originalUnchanged=true';return
  }
  for($i=0;$i -lt 2;$i++){
    $phase=$i+1;$group=$plan.Groups[$i]
    if((& git -C $worktree rev-parse HEAD | Out-String).Trim() -cne $head -or (& git -C $worktree status --porcelain --untracked-files=no | Out-String).Trim()){throw 'CANDIDATE_CHANGED'}
    foreach($name in $group){
      $fresh=Get-IqLiveSnapshot $name
      if($fresh.state -cne 'ACTIVE' -or $fresh.serviceConfig.revision -cne $snapshots[$name].serviceConfig.revision -or [string]$fresh.buildConfig.source.storageSource.generation -cne [string]$snapshots[$name].buildConfig.source.storageSource.generation -or (Get-IqConfigFingerprint $fresh) -cne $plan.Configs[$name] -or !(Test-IqMapEqual (Get-IqUserEnv $fresh) $plan.Envs[$name])){throw 'PREPHASE_REMOTE_CHANGED'}
    }
    $action={
      $savedDebug=$env:DEBUG
      try {
        Remove-Item Env:DEBUG -ErrorAction SilentlyContinue
        & $journal 'DEPLOY_STARTED'
        $selector=(@($group|ForEach-Object{'functions:'+$_}) -join ',')
        Push-Location $worktree
        try { & node scripts/run-firebase-clean-env.mjs deploy --project pay-0-system --only $selector --non-interactive *> (Join-Path $runDir ('deploy-group'+$phase+'.log'));if($LASTEXITCODE -ne 0){throw 'FIREBASE_DEPLOY_FAILED'} } finally {Pop-Location}
        foreach($name in $group){Assert-IqPostflight $snapshots[$name] (Get-IqLiveSnapshot $name) $plan.Envs[$name] $plan.Configs[$name]}
        & $journal 'POSTFLIGHT_PASS'
      } finally {if($null -eq $savedDebug){Remove-Item Env:DEBUG -ErrorAction SilentlyContinue}else{$env:DEBUG=$savedDebug}}
    }
    Invoke-IqEnvPhase $target $original $stageBytes[$i] $action $journal
  }
  & $journal 'COMPLETE';Write-Output 'IQ_DEPOSIT_FUNCTIONS_DEPLOY_PASS groups=2+1 dotenvRestored=true TasksSchedulerPostflight=MANUAL_REQUIRED'
} catch { Write-Error 'IQ_DEPOSIT_FAILED: inspect private journal; no automatic remote rollback or retry performed.';exit 1 }
