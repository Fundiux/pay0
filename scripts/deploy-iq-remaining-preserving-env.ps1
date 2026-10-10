[CmdletBinding()]
param([ValidateSet('Preflight','StageDryRun','Execute')][string]$Mode='Preflight',[string]$ExpectedHead='',[string]$ExpectedEnvHash='',[switch]$LibraryOnly)
$ErrorActionPreference='Stop'
$remainingMode=$Mode;$remainingLibrary=$LibraryOnly;$remainingHead=$ExpectedHead;$remainingHash=$ExpectedEnvHash
. (Join-Path $PSScriptRoot 'deploy-dispersion-document-core.ps1') -LibraryOnly
$Mode=$remainingMode;$LibraryOnly=$remainingLibrary;$ExpectedHead=$remainingHead;$ExpectedEnvHash=$remainingHash
# Only reuse local CAS/hash/native/backup/workspace utilities; no other release plan.
$script:RemainingHead=$ExpectedHead
$script:RemainingNames=@('createSolicitudIq','processIqCreateQueue','createClientDispersionIq','processIqDispersionCreate','executeUserCommissionDispersion','processIqCreateOnDemandTask')
$script:RemainingPins=@{
 createSolicitudIq=@('createsolicitudiq-00057-tar','1790638545651227',20,1,300)
 processIqCreateQueue=@('processiqcreatequeue-00019-dut','1791410577000980',20,80,540)
 createClientDispersionIq=@('createclientdispersioniq-00022-hoy','1790638546049323',1,1,540)
 processIqDispersionCreate=@('processiqdispersioncreate-00011-nor','1790638545671737',1,1,540)
 executeUserCommissionDispersion=@('executeusercommissiondispersion-00002-fow','1790638545592528',2,80,540)
 processIqCreateOnDemandTask=@('processiqcreateondemandtask-00009-qey','1791410490996895',1,1,540)
}
$script:RemainingSolicitud=@('createSolicitudIq','processIqCreateQueue','processIqCreateOnDemandTask')
function Get-RemainingEnv($Snapshot,[string]$Name){
 if($Name -cnotin $script:RemainingNames){throw 'FUNCTION_SCOPE_INVALID'}
 $envMap=Get-IqUserEnv $Snapshot
 $timed=$Name -ceq 'processIqCreateOnDemandTask'
 if($envMap.ContainsKey('PAY0_OPERATION_TIMING') -ne $timed){throw 'TIMING_PRESENCE_CHANGED'}
 # Preserve exact bytes in memory. Only bounded dotenv-safe flag syntax is accepted;
 # the application enables timing solely for 1. Never emit the flag value.
 if($timed -and $envMap.PAY0_OPERATION_TIMING -cnotmatch '^[A-Za-z0-9_-]{1,64}$'){throw 'TIMING_FORMAT_UNREVIEWED'}
 return $envMap
}
function Get-RemainingConfig($Snapshot,[string]$Name){
 if($Name -cnotin $script:RemainingNames -or !$Snapshot -or $Snapshot.state -cne 'ACTIVE'){throw 'ENDPOINT_NOT_ACTIVE'}
 $s=$Snapshot.serviceConfig;$b=$Snapshot.buildConfig;$pin=$script:RemainingPins[$Name]
 if($Snapshot.name -cne ('projects/pay-0-system/locations/us-central1/functions/'+$Name) -or $b.runtime -cne 'nodejs22' -or $b.entryPoint -cne $Name){throw 'RUNTIME_IDENTITY_CHANGED'}
 if($b.source.storageSource.bucket -cne 'gcf-v2-sources-751158244178-us-central1' -or $b.source.storageSource.object -cne ($Name+'/function-source.zip')){throw 'SOURCE_LOCATION_CHANGED'}
 $secret=(@($s.secretEnvironmentVariables|Where-Object{$null -ne $_}|ForEach-Object{"$($_.key):$($_.projectId):$($_.secret):$($_.version)"}|Sort-Object)-join '|')
 $expected='IQ_CREDENTIALS_KEY:pay-0-system:IQ_CREDENTIALS_KEY:2'
 if($Name -cin $script:RemainingSolicitud){$expected+='|TELEGRAM_BOT_TOKEN:pay-0-system:TELEGRAM_BOT_TOKEN:1'}
 if($secret -cne $expected -or @($s.secretVolumes|Where-Object{$null -ne $_}).Count -ne 0){throw 'SECRET_BINDING_CHANGED'}
 if([string]$s.maxInstanceCount -cne [string]$pin[2] -or [string]$s.maxInstanceRequestConcurrency -cne [string]$pin[3] -or [string]$s.timeoutSeconds -cne [string]$pin[4] -or $s.availableMemory -cne '2Gi' -or [string]$s.availableCpu -cne '1'){throw 'RUNTIME_LIMIT_CHANGED'}
 if($null -ne $s.minInstanceCount -or $s.ingressSettings -cne 'ALLOW_ALL' -or $null -ne $s.vpcConnector -or $null -ne $s.vpcConnectorEgressSettings -or $s.serviceAccountEmail -cne '751158244178-compute@developer.gserviceaccount.com'){throw 'NETWORK_IDENTITY_CHANGED'}
 $result=[ordered]@{runtime=$b.runtime;entryPoint=$b.entryPoint;timeout=$s.timeoutSeconds;memory=$s.availableMemory;cpu=$s.availableCpu;max=$s.maxInstanceCount;concurrency=$s.maxInstanceRequestConcurrency;min=$s.minInstanceCount;ingress=$s.ingressSettings;vpc=$s.vpcConnector;egress=$s.vpcConnectorEgressSettings;identity=$s.serviceAccountEmail;secrets=$secret}
 return($result|ConvertTo-Json -Compress)
}
function Get-RemainingPlan([hashtable]$Snapshots){
 if($Snapshots.Count -ne 6){throw 'SNAPSHOT_SCOPE_INVALID'}
 $envs=@{};$configs=@{}
 foreach($name in $script:RemainingNames){
  $s=$Snapshots[$name];$configs[$name]=Get-RemainingConfig $s $name;$envs[$name]=Get-RemainingEnv $s $name
  if($s.serviceConfig.revision -cne $script:RemainingPins[$name][0] -or [string]$s.buildConfig.source.storageSource.generation -cne $script:RemainingPins[$name][1]){throw 'REMOTE_SOURCE_CHANGED'}
  if($name -cne 'processIqCreateOnDemandTask' -and !(Test-IqMapEqual $envs[$name] $envs[$script:RemainingNames[0]])){throw 'GROUP_ENV_MISMATCH'}
  if($envs[$name].PAY0_FIREBASE_WEB_API_KEY -cne $envs[$script:RemainingNames[0]].PAY0_FIREBASE_WEB_API_KEY){throw 'API_KEY_GROUP_MISMATCH'}
 }
 return @{Envs=$envs;Configs=$configs;Groups=@(@($script:RemainingNames[0..4]),@('processIqCreateOnDemandTask'))}
}
function Get-RemainingArguments([int]$Group){
 if($Group -notin @(0,1)){throw 'GROUP_SCOPE_INVALID'}
 $names=if($Group -eq 0){@($script:RemainingNames[0..4])}else{@('processIqCreateOnDemandTask')}
 return @('scripts/run-firebase-clean-env.mjs','deploy','--project','pay-0-system','--only',(($names|ForEach-Object{'functions:'+$_}) -join ','),'--non-interactive')
}
function Assert-RemainingSnapshot($Before,$After,[string]$Name,[hashtable]$Env,[string]$Config,[bool]$Changed){
 if((Get-RemainingConfig $After $Name) -cne $Config -or !(Test-IqMapEqual (Get-RemainingEnv $After $Name) $Env)){throw 'CONFIG_CHANGED'}
 $revisionSame=$Before.serviceConfig.revision -ceq $After.serviceConfig.revision
 $sourceSame=[string]$Before.buildConfig.source.storageSource.generation -ceq [string]$After.buildConfig.source.storageSource.generation
 if(($Changed -and ($revisionSame -or $sourceSame)) -or (!$Changed -and (!$revisionSame -or !$sourceSame))){throw 'REVISION_CHANGED'}
}
function Invoke-RemainingGet([ValidateSet('Function','Secret','Scheduler','Queue')][string]$Kind,[string]$Name){
 switch($Kind){
  'Function'{if($Name -cnotin $script:RemainingNames){throw 'FUNCTION_SCOPE_INVALID'};$url='https://cloudfunctions.googleapis.com/v2/projects/pay-0-system/locations/us-central1/functions/'+$Name;$fields='name,state,buildConfig(runtime,entryPoint,source(storageSource(bucket,object,generation))),serviceConfig(revision,serviceAccountEmail,timeoutSeconds,availableMemory,availableCpu,minInstanceCount,ingressSettings,vpcConnector,vpcConnectorEgressSettings,maxInstanceCount,maxInstanceRequestConcurrency,environmentVariables,secretEnvironmentVariables,secretVolumes)'}
  'Secret'{if($Name -cnotin @('IQ_CREDENTIALS_KEY','TELEGRAM_BOT_TOKEN')){throw 'SECRET_SCOPE_INVALID'};$url='https://secretmanager.googleapis.com/v1/projects/pay-0-system/secrets/'+$Name+'/versions/latest';$fields='name,state'}
  'Scheduler'{if($Name -cnotin @('processIqCreateQueue','processIqDispersionCreate','syncTodayIqInvoicesNow','checkPaymentComplementsDaily')){throw 'JOB_SCOPE_INVALID'};$url='https://cloudscheduler.googleapis.com/v1/projects/pay-0-system/locations/us-central1/jobs/firebase-schedule-'+$Name+'-us-central1';$fields='name,state,schedule,timeZone,attemptDeadline,retryConfig'}
  'Queue'{if($Name -cne 'processIqCreateOnDemandTask'){throw 'QUEUE_SCOPE_INVALID'};$url='https://cloudtasks.googleapis.com/v2/projects/pay-0-system/locations/us-central1/queues/'+$Name;$fields='name,state,rateLimits,retryConfig'}
 }
 $token=(& gcloud.cmd auth print-access-token --project pay-0-system --quiet 2>$null|Out-String).Trim()
 if($LASTEXITCODE -ne 0 -or $token -cnotmatch '^[A-Za-z0-9._~-]{20,4096}$'){throw 'AUTH_UNAVAILABLE'}
 try{return Invoke-RestMethod -Method Get -Uri ($url+'?fields='+[Uri]::EscapeDataString($fields)) -Headers @{Authorization="Bearer $token";'x-goog-user-project'='pay-0-system'} -TimeoutSec 30 -MaximumRedirection 0}
 catch{throw 'READ_METADATA_FAILED'}finally{$token=$null}
}
function Assert-RemainingSecret($Version,[string]$Name){
 $number=if($Name -ceq 'IQ_CREDENTIALS_KEY'){'2'}elseif($Name -ceq 'TELEGRAM_BOT_TOKEN'){'1'}else{throw 'SECRET_SCOPE_INVALID'}
 $allowed=@("projects/pay-0-system/secrets/$Name/versions/$number","projects/751158244178/secrets/$Name/versions/$number")
 if(!$Version -or $Version.state -cne 'ENABLED' -or $Version.name -cnotin $allowed){throw 'LATEST_SECRET_VERSION_CHANGED'}
}
function Get-RemainingJobs {
 $rows=@{};foreach($name in @('processIqCreateQueue','processIqDispersionCreate','syncTodayIqInvoicesNow','checkPaymentComplementsDaily')){$rows[$name]=Invoke-RemainingGet Scheduler $name}
 $rows['processIqCreateOnDemandTask']=Invoke-RemainingGet Queue 'processIqCreateOnDemandTask';return $rows
}
function Get-RemainingJobFingerprint([hashtable]$Rows){
 if($Rows.Count -ne 5){throw 'JOB_SCOPE_INVALID'}
 $out=[ordered]@{}
 foreach($name in @('processIqCreateQueue','processIqDispersionCreate','syncTodayIqInvoicesNow','checkPaymentComplementsDaily')){
  $r=$Rows[$name];$state=if($name -cin @('processIqCreateQueue','processIqDispersionCreate')){'ENABLED'}else{'PAUSED'}
  $schedule=switch($name){'processIqCreateQueue'{'every 1 minutes'};'processIqDispersionCreate'{'every 5 minutes'};'syncTodayIqInvoicesNow'{'every 24 hours'};default{'0 19 * * 1-5'}}
  if(!$r -or $r.name -cne ('projects/pay-0-system/locations/us-central1/jobs/firebase-schedule-'+$name+'-us-central1') -or $r.state -cne $state -or $r.schedule -cne $schedule -or $r.timeZone -cne 'America/Mexico_City' -or $r.attemptDeadline -cne '540s'){throw 'SCHEDULER_CHANGED'}
  $retry=[ordered]@{};foreach($key in @('retryCount','maxRetryDuration','minBackoffDuration','maxBackoffDuration','maxDoublings')){$retry[$key]=$r.retryConfig.$key}
  $out[$name]=[ordered]@{state=$r.state;schedule=$r.schedule;zone=$r.timeZone;deadline=$r.attemptDeadline;retry=$retry}
 }
 $q=$Rows['processIqCreateOnDemandTask'];$rate=$q.rateLimits;$retry=$q.retryConfig
 if(!$q -or $q.name -cne 'projects/pay-0-system/locations/us-central1/queues/processIqCreateOnDemandTask' -or $q.state -cne 'RUNNING' -or $rate.maxConcurrentDispatches -ne 1 -or $rate.maxDispatchesPerSecond -ne 1 -or $rate.maxBurstSize -ne 10 -or $retry.maxAttempts -ne 1 -or $retry.minBackoff -cne '60s' -or $retry.maxBackoff -cne '300s' -or $retry.maxDoublings -ne 16 -or $null -ne $retry.maxRetryDuration){throw 'QUEUE_CHANGED'}
 $out['queue']=[ordered]@{state=$q.state;concurrent=$rate.maxConcurrentDispatches;rate=$rate.maxDispatchesPerSecond;burst=$rate.maxBurstSize;attempts=$retry.maxAttempts;min=$retry.minBackoff;max=$retry.maxBackoff;doublings=$retry.maxDoublings;duration=$retry.maxRetryDuration}
 return($out|ConvertTo-Json -Depth 8 -Compress)
}
function Invoke-RemainingPhase([int]$PhaseIndex,[string]$Target,[byte[]]$Original,[hashtable]$Env,[scriptblock]$Deploy,[scriptblock]$Postflight,[scriptblock]$Journal){
 $arguments=Get-RemainingArguments $PhaseIndex
 if(!$Env.ContainsKey('PAY0_FIREBASE_WEB_API_KEY') -or $Env.ContainsKey('PAY0_OPERATION_TIMING') -ne ($PhaseIndex -eq 1) -or $Env.Count -ne (1+$PhaseIndex)){throw 'PHASE_ENV_INVALID'}
 $staged=ConvertTo-IqDotenv $Env
 $action={& $Journal 'DEPLOY_STARTED';$code=& $Deploy $arguments;if($code -isnot [int] -or $code -ne 0){& $Journal 'DEPLOY_FAILED_NO_RETRY';throw 'FIREBASE_DEPLOY_FAILED'};& $Postflight;& $Journal 'POSTFLIGHT_PASS'}
 Invoke-IqEnvPhase $Target $Original $staged $action $Journal
 if((Get-IqHash ([IO.File]::ReadAllBytes($Target))) -cne (Get-IqHash $Original)){throw 'RESTORATION_HASH_FAILED'}
}
if($LibraryOnly){return}
try{
 $repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'));$worktree=Join-Path $repository '.worktrees/pay0-remediation-integration-20261009'
 Assert-DocumentWorkspace $worktree $script:RemainingHead
 $target=Join-Path $worktree 'functions/.env.pay-0-system';$envFiles=@(Get-ChildItem -LiteralPath (Join-Path $worktree 'functions') -Force -File -Filter '.env*')
 if($envFiles.Count -ne 1 -or $envFiles[0].Name -cne '.env.pay-0-system'){throw 'DOTENV_SCOPE_AMBIGUOUS'}
 $original=[IO.File]::ReadAllBytes($target);$snapshots=@{};foreach($name in $script:RemainingNames){$snapshots[$name]=Invoke-RemainingGet Function $name}
 $plan=Get-RemainingPlan $snapshots;Assert-DocumentLocalEnv $original $ExpectedEnvHash $plan.Envs[$script:RemainingNames[0]]
 foreach($secret in @('IQ_CREDENTIALS_KEY','TELEGRAM_BOT_TOKEN')){Assert-RemainingSecret (Invoke-RemainingGet Secret $secret) $secret}
 $jobFingerprint=Get-RemainingJobFingerprint (Get-RemainingJobs)
 if($Mode -eq 'Preflight'){Write-Output 'IQ_REMAINING_PREFLIGHT_PASS functions=6 groups=5+1 cloudWrites=0 dotenvWrites=0';return}
 $privateBase=Join-Path $repository '.firebase/iq-remaining-deploy';[IO.Directory]::CreateDirectory($privateBase)|Out-Null
 & git -C $repository check-ignore --quiet ($privateBase+'/original.env');if($LASTEXITCODE -ne 0){throw 'PRIVATE_BACKUP_NOT_IGNORED'}
 $lockPath=Join-Path $privateBase 'deploy.lock';$lock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{
  $runDir=Join-Path $privateBase ([guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($runDir)|Out-Null;Save-DocumentBackup $runDir $original
  $stageHashes=@();for($i=0;$i -lt 2;$i++){$bytes=ConvertTo-IqDotenv $plan.Envs[$plan.Groups[$i][0]];[IO.File]::WriteAllBytes((Join-Path $runDir ('group'+$i+'.env')),$bytes);$stageHashes+=Get-IqHash $bytes}
  $planHash=Get-IqHash ([Text.Encoding]::UTF8.GetBytes(($script:RemainingHead+'|'+$ExpectedEnvHash+'|'+($stageHashes -join '|')+'|'+$jobFingerprint+'|'+($script:RemainingNames -join '|')+'|'+(($script:RemainingNames|ForEach-Object{$plan.Configs[$_]}) -join '|'))))
  $phase=0;$journalFile=Join-Path $runDir 'journal.jsonl';$journal={param($state)[IO.File]::AppendAllText($journalFile,(([ordered]@{at=[DateTime]::UtcNow.ToString('o');state=$state;phase=$phase;head=$script:RemainingHead;planHash=$planHash;originalHash=$ExpectedEnvHash}|ConvertTo-Json -Compress)+"`n"))};& $journal 'PREPARED'
  if($Mode -eq 'StageDryRun'){if((Get-IqHash ([IO.File]::ReadAllBytes($target))) -cne $ExpectedEnvHash){throw 'LOCAL_ENV_CONFLICT'};& $journal 'DRY_RUN_COMPLETE';Write-Output 'IQ_REMAINING_STAGE_PASS originalUnchanged=true cloudWrites=0';return}
  for($i=0;$i -lt 2;$i++){
   $phase=$i+1;$group=$plan.Groups[$i];Assert-DocumentWorkspace $worktree $script:RemainingHead
   foreach($name in $script:RemainingNames){Assert-RemainingSnapshot $snapshots[$name] (Invoke-RemainingGet Function $name) $name $plan.Envs[$name] $plan.Configs[$name] $false}
   foreach($secret in @('IQ_CREDENTIALS_KEY','TELEGRAM_BOT_TOKEN')){Assert-RemainingSecret (Invoke-RemainingGet Secret $secret) $secret}
   if((Get-RemainingJobFingerprint (Get-RemainingJobs)) -cne $jobFingerprint){throw 'JOBS_CHANGED'}
   $deploy={param([string[]]$arguments)$savedDebug=$env:DEBUG;try{Remove-Item Env:DEBUG -ErrorAction SilentlyContinue;Push-Location $worktree;try{return(Invoke-IqNodeLogged $arguments (Join-Path $runDir ('deploy-group'+$phase+'.log')))}finally{Pop-Location}}finally{if($null -eq $savedDebug){Remove-Item Env:DEBUG -ErrorAction SilentlyContinue}else{$env:DEBUG=$savedDebug}}}
   $postflight={Assert-DocumentWorkspace $worktree $script:RemainingHead;foreach($name in $script:RemainingNames){$after=Invoke-RemainingGet Function $name;Assert-RemainingSnapshot $snapshots[$name] $after $name $plan.Envs[$name] $plan.Configs[$name] ($name -cin $group);$snapshots[$name]=$after};foreach($secret in @('IQ_CREDENTIALS_KEY','TELEGRAM_BOT_TOKEN')){Assert-RemainingSecret (Invoke-RemainingGet Secret $secret) $secret};if((Get-RemainingJobFingerprint (Get-RemainingJobs)) -cne $jobFingerprint){throw 'JOBS_CHANGED'}}
   Invoke-RemainingPhase $i $target $original $plan.Envs[$group[0]] $deploy $postflight $journal
  }
  & $journal 'COMPLETE';Write-Output 'IQ_REMAINING_DEPLOY_PASS functions=6 groups=5+1 dotenvRestored=true jobsPreserved=true'
 }finally{$lock.Dispose();[IO.File]::Delete($lockPath)}
}catch{Write-Error 'IQ_REMAINING_FAILED: inspect private journal; no automatic remote rollback, retry or financial action.';exit 1}
