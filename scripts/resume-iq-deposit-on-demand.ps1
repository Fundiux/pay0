[CmdletBinding()]
param([ValidateSet('Preflight','Execute')][string]$Mode='Preflight',[switch]$LibraryOnly)
# Recovery of the independent third endpoint only. Group1 is already ACTIVE;
# its automatic max=20 drift remains OPEN and is neither reverted nor certified.
# Root verified operational queue concurrency=1 and pauses; this script never
# changes task queues/scheduler state and requires that operational gate to hold.
# No automatic deployment retry. A partial remote outcome requires fresh review.
$ErrorActionPreference='Stop'
$resumeRequestedMode=$Mode;$resumeRequestedLibraryOnly=$LibraryOnly
. (Join-Path $PSScriptRoot 'deploy-iq-deposit-preserving-env.ps1') -LibraryOnly
$Mode=$resumeRequestedMode;$LibraryOnly=$resumeRequestedLibraryOnly
$script:IqResumeHead='a71a8b898feb35564faed04a4c14c9bb67639581'
$script:IqResumeOriginalHash='572b76d72c40c427b9ac33220a9a004f2717bd412b67f53e20ed27d19fd86856'
$script:IqResumeName='processIqPagoDepositOnDemandTask'
$script:IqResumePins=@{
 processIqPagoDepositAutomaticTask=@('processiqpagodepositautomatictask-00002-tud','1791590626272187')
 processIqPagoDepositCreateQueue=@('processiqpagodepositcreatequeue-00021-vuq','1791590513946575')
 processIqPagoDepositOnDemandTask=@('processiqpagodepositondemandtask-00034-jot','1790638545672827')
}
function Get-IqResumeConfig($Snapshot) {
 $s=$Snapshot.serviceConfig
 $secrets=@($s.secretEnvironmentVariables|ForEach-Object{"$($_.key):$($_.secret):$($_.version)"}|Sort-Object)
 if(($secrets -join '|') -cne 'IQ_CREDENTIALS_KEY:IQ_CREDENTIALS_KEY:2|TELEGRAM_BOT_TOKEN:TELEGRAM_BOT_TOKEN:1'){throw 'SECRET_BINDING_CHANGED'}
 # Named properties retain null positions; array serialization drops nulls.
 return ([ordered]@{timeoutSeconds=$s.timeoutSeconds;availableMemory=$s.availableMemory;availableCpu=$s.availableCpu;minInstanceCount=$s.minInstanceCount;ingressSettings=$s.ingressSettings;vpcConnector=$s.vpcConnector;vpcConnectorEgressSettings=$s.vpcConnectorEgressSettings;maxInstanceCount=$s.maxInstanceCount;maxInstanceRequestConcurrency=$s.maxInstanceRequestConcurrency;serviceAccountEmail=$s.serviceAccountEmail;secrets=$secrets}|ConvertTo-Json -Depth 5 -Compress)
}
function Get-IqResumePlan([hashtable]$Snapshots) {
 $envs=@{};$configs=@{}
 foreach($name in $script:IqNames){
  $s=$Snapshots[$name];$ondemand=$name -ceq $script:IqResumeName
  if(!$s -or $s.state -cne 'ACTIVE'){throw 'ENDPOINT_NOT_ACTIVE'}
  if($s.serviceConfig.revision -cne $script:IqResumePins[$name][0] -or [string]$s.buildConfig.source.storageSource.generation -cne $script:IqResumePins[$name][1]){throw 'REMOTE_SOURCE_CHANGED'}
  $configs[$name]=Get-IqResumeConfig $s;$envs[$name]=Get-IqUserEnv $s
  if([string]$s.serviceConfig.timeoutSeconds -cne '540' -or $s.serviceConfig.availableMemory -cne '2Gi' -or [string]$s.serviceConfig.availableCpu -cne '1' -or $s.serviceConfig.serviceAccountEmail -cne '751158244178-compute@developer.gserviceaccount.com'){throw 'CORE_CONFIG_CHANGED'}
  if($null -ne $s.serviceConfig.minInstanceCount -or $s.serviceConfig.ingressSettings -cne 'ALLOW_ALL' -or $null -ne $s.serviceConfig.vpcConnector -or $null -ne $s.serviceConfig.vpcConnectorEgressSettings){throw 'MIN_NETWORK_BASELINE_CHANGED'}
  $expectedMax=if($ondemand){'1'}else{'20'};$expectedConcurrency=if($ondemand){'1'}else{'80'}
  if([string]$s.serviceConfig.maxInstanceCount -cne $expectedMax -or [string]$s.serviceConfig.maxInstanceRequestConcurrency -cne $expectedConcurrency){throw 'RUNTIME_LIMIT_CHANGED'}
  if($ondemand){if($envs[$name].ContainsKey('PAY0_OPERATION_TIMING')){throw 'ONDEMAND_TIMING_CHANGED'}}
  elseif($envs[$name].PAY0_OPERATION_TIMING -cne '1'){throw 'GROUP1_TIMING_CHANGED'}
 }
 if(!(Test-IqMapEqual $envs[$script:IqNames[0]] $envs[$script:IqNames[1]])){throw 'GROUP1_ENV_MISMATCH'}
 if($envs[$script:IqNames[0]].PAY0_FIREBASE_WEB_API_KEY -cne $envs[$script:IqResumeName].PAY0_FIREBASE_WEB_API_KEY){throw 'API_KEY_GROUP_MISMATCH'}
 return @{Envs=$envs;Configs=$configs;Selector='functions:processIqPagoDepositOnDemandTask';Drift='GROUP1_AUTOMATIC_MAX20_OPEN';PreservationCertified=$false}
}
function Assert-IqResumeSnapshot($Before,$After,[hashtable]$Env,[string]$Config,[bool]$MustChange) {
 if(!$After -or $After.state -cne 'ACTIVE'){throw 'ENDPOINT_NOT_ACTIVE'}
 $sameRevision=$After.serviceConfig.revision -ceq $Before.serviceConfig.revision
 $sameGeneration=[string]$After.buildConfig.source.storageSource.generation -ceq [string]$Before.buildConfig.source.storageSource.generation
 if(($MustChange -and ($sameRevision -or $sameGeneration)) -or (!$MustChange -and (!$sameRevision -or !$sameGeneration))){throw 'REVISION_POSTFLIGHT_FAILED'}
 if(!(Test-IqMapEqual (Get-IqUserEnv $After) $Env) -or (Get-IqResumeConfig $After) -cne $Config){throw 'CONFIG_POSTFLIGHT_FAILED'}
}
function Get-IqResumeArguments {
 return @('scripts/run-firebase-clean-env.mjs','deploy','--project','pay-0-system','--only','functions:processIqPagoDepositOnDemandTask','--non-interactive')
}
function Assert-IqResumeWorkspace([string]$Worktree) {
 $head=(& git -C $Worktree rev-parse HEAD 2>$null|Out-String).Trim()
 if($LASTEXITCODE -ne 0 -or $head -cne $script:IqResumeHead){throw 'CANDIDATE_HEAD_CHANGED'}
 $status=(& git -C $Worktree status --porcelain --untracked-files=normal 2>$null|Out-String).Trim()
 if($LASTEXITCODE -ne 0 -or $status){throw 'CANDIDATE_DIRTY'}
}
function Save-IqResumeBackup([string]$RunDir,[byte[]]$Original) {
 $file=Join-Path $RunDir 'original.env';$stream=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$stream.Write($Original,0,$Original.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 if((Get-IqHash ([IO.File]::ReadAllBytes($file))) -cne (Get-IqHash $Original)){throw 'BACKUP_VERIFY_FAILED'}
}
function Invoke-IqResumePhase([string]$Target,[byte[]]$Original,[hashtable]$Plan,[scriptblock]$Deploy,[scriptblock]$Postflight,[scriptblock]$Journal) {
 if($Plan.Selector -cne 'functions:processIqPagoDepositOnDemandTask'){throw 'SELECTOR_INVALID'}
 $staged=ConvertTo-IqDotenv $Plan.Envs[$script:IqResumeName]
 $action={
  & $Journal 'ONDEMAND_DEPLOY_STARTED'
  $exit=& $Deploy (Get-IqResumeArguments)
  if($exit -isnot [int] -or $exit -ne 0){& $Journal 'ONDEMAND_DEPLOY_FAILED_NO_RETRY';throw 'FIREBASE_DEPLOY_FAILED'}
  & $Postflight
  & $Journal 'ONDEMAND_POSTFLIGHT_PASS_GROUP1_DRIFT_OPEN'
 }
 Invoke-IqEnvPhase $Target $Original $staged $action $Journal
 if((Get-IqHash ([IO.File]::ReadAllBytes($Target))) -cne (Get-IqHash $Original)){throw 'RESTORATION_HASH_FAILED'}
}
if($LibraryOnly){return}
try {
 $repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
 $worktree=Join-Path $repository '.worktrees/pay0-remediation-integration-20261009'
 Assert-IqResumeWorkspace $worktree
 $target=Join-Path $worktree 'functions/.env.pay-0-system'
 $envFiles=@(Get-ChildItem -LiteralPath (Join-Path $worktree 'functions') -Force -File -Filter '.env*')
 if($envFiles.Count -ne 1 -or $envFiles[0].Name -cne '.env.pay-0-system'){throw 'DOTENV_SCOPE_AMBIGUOUS'}
 $original=[IO.File]::ReadAllBytes($target)
 if((Get-IqHash $original) -cne $script:IqResumeOriginalHash){throw 'LOCAL_ENV_BASELINE_CHANGED'}
 $snapshots=@{};foreach($name in $script:IqNames){$snapshots[$name]=Get-IqLiveSnapshot $name}
 $plan=Get-IqResumePlan $snapshots
 # Exact known byte hash pins the reviewed dotenv; compare the only staged public key too.
 $localKey=@(([Text.Encoding]::UTF8.GetString($original)-split '\r?\n')|Where-Object{$_ -cmatch '^PAY0_FIREBASE_WEB_API_KEY=[A-Za-z0-9_-]+$'})
 if($localKey.Count -ne 1 -or $localKey[0].Substring('PAY0_FIREBASE_WEB_API_KEY='.Length) -cne $plan.Envs[$script:IqResumeName].PAY0_FIREBASE_WEB_API_KEY){throw 'LOCAL_API_KEY_MISMATCH'}
 if($Mode -eq 'Preflight'){Write-Output 'IQ_ONDEMAND_RESUME_PREFLIGHT_PASS cloudWrites=0 dotenvWrites=0 group1AutomaticMax20=OPEN_DRIFT operationalPauses=ROOT_VERIFIED_NO_CHANGE';return}
 $privateBase=Join-Path $repository '.firebase/iq-deposit-deploy'
 [IO.Directory]::CreateDirectory($privateBase)|Out-Null
 $lockPath=Join-Path $privateBase 'on-demand-resume.lock';$lock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try {
  $runDir=Join-Path $privateBase ('resume-'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($runDir)|Out-Null
  & git -C $repository check-ignore --quiet ($runDir+'/original.env')
  if($LASTEXITCODE -ne 0){throw 'PRIVATE_BACKUP_NOT_IGNORED'}
  Save-IqResumeBackup $runDir $original
  $journalFile=Join-Path $runDir 'journal.jsonl'
  $journal={param($state)[IO.File]::AppendAllText($journalFile,(([ordered]@{at=[DateTime]::UtcNow.ToString('o');state=$state;head=$script:IqResumeHead;originalHash=$script:IqResumeOriginalHash;selector=$plan.Selector;group1Drift='OPEN'}|ConvertTo-Json -Compress)+"`n"))}
  & $journal 'PREPARED_ONDEMAND_ONLY'
  Assert-IqResumeWorkspace $worktree
  foreach($name in $script:IqNames){Assert-IqResumeSnapshot $snapshots[$name] (Get-IqLiveSnapshot $name) $plan.Envs[$name] $plan.Configs[$name] $false}
  $deploy={param([string[]]$arguments)
   $savedDebug=$env:DEBUG
   try{Remove-Item Env:DEBUG -ErrorAction SilentlyContinue;Push-Location $worktree;try{return (Invoke-IqNodeLogged $arguments (Join-Path $runDir 'deploy-on-demand.log'))}finally{Pop-Location}}
   finally{if($null -eq $savedDebug){Remove-Item Env:DEBUG -ErrorAction SilentlyContinue}else{$env:DEBUG=$savedDebug}}
  }
  $postflight={foreach($name in $script:IqNames){Assert-IqResumeSnapshot $snapshots[$name] (Get-IqLiveSnapshot $name) $plan.Envs[$name] $plan.Configs[$name] ($name -ceq $script:IqResumeName)}}
  Invoke-IqResumePhase $target $original $plan $deploy $postflight $journal
  & $journal 'COMPLETE_ONDEMAND_ONLY_ENV_RESTORED_DRIFT_OPEN'
  Write-Output 'IQ_ONDEMAND_RESUME_PASS dotenvRestored=true group1AutomaticMax20=OPEN_DRIFT globalPreservationCertified=false TasksSchedulerPausePostflight=ROOT_REQUIRED'
 }finally{$lock.Dispose();[IO.File]::Delete($lockPath)}
}catch{Write-Error 'IQ_ONDEMAND_RESUME_FAILED: inspect private journal; no automatic retry or remote rollback.';exit 1}
