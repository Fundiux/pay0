[CmdletBinding()]
param([ValidateSet('LibraryOnly','Preflight','Execute')][string]$Mode='Preflight',[string]$ExpectedHead='',[string]$ExpectedEnvHash='',[switch]$LibraryOnly)
$ErrorActionPreference='Stop'
$hugoRequestedMode=$Mode;$hugoRequestedLibraryOnly=$LibraryOnly
. (Join-Path $PSScriptRoot 'deploy-iq-deposit-preserving-env.ps1') -LibraryOnly
$Mode=$hugoRequestedMode;$LibraryOnly=$hugoRequestedLibraryOnly
# Reuse only hash/map/serialization/CAS/native capture utilities, never IQ plans,
# snapshots, deployment selectors or runtime configuration.
$script:HugoNames=@('linkAgent007VerifiedExperience','createAgent007LearningExperience','createAgent007LearningDraft','linkAgent007LearningOutcome')
$script:HugoPins=@{
 linkAgent007VerifiedExperience=@('linkagent007verifiedexperience-00002-fop','1790583858009779')
 createAgent007LearningExperience=@('createagent007learningexperience-00002-kim','1790583858403624')
 createAgent007LearningDraft=@('createagent007learningdraft-00002-sul','1790583861348821')
 linkAgent007LearningOutcome=@('linkagent007learningoutcome-00002-qad','1790583861314161')
}
function Get-HugoUserEnv($Snapshot) {
 $managed=@('FIREBASE_CONFIG','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','GCP_PROJECT','FUNCTION_REGION','FUNCTION_TARGET','FUNCTION_SIGNATURE_TYPE','FUNCTION_NAME','K_SERVICE','K_REVISION','K_CONFIGURATION','PORT','EVENTARC_CLOUD_EVENT_SOURCE','LOG_EXECUTION_ID')
 $user=@{};$all=Get-IqMap $Snapshot.serviceConfig.environmentVariables
 foreach($key in $all.Keys){if($key -notin $managed){if($key -cne 'PAY0_FIREBASE_WEB_API_KEY'){throw 'REMOTE_ENV_KEY_UNREVIEWED'};$user[$key]=$all[$key]}}
 if($user.Count -ne 1 -or $user.PAY0_FIREBASE_WEB_API_KEY -cnotmatch '^[A-Za-z0-9_-]{20,200}$'){throw 'REMOTE_ENV_INVALID'}
 return $user
}
function Get-HugoConfig($Snapshot,[string]$Name) {
 if($Name -cnotin $script:HugoNames -or !$Snapshot -or $Snapshot.state -cne 'ACTIVE'){throw 'ENDPOINT_NOT_ACTIVE'}
 $s=$Snapshot.serviceConfig;$b=$Snapshot.buildConfig
 if($Snapshot.name -cne ('projects/pay-0-system/locations/us-central1/functions/'+$Name) -or $b.runtime -cne 'nodejs22' -or $b.entryPoint -cne $Name){throw 'RUNTIME_IDENTITY_CHANGED'}
 if($b.source.storageSource.bucket -cne 'gcf-v2-sources-751158244178-us-central1' -or $b.source.storageSource.object -cne ($Name+'/function-source.zip')){throw 'SOURCE_LOCATION_CHANGED'}
 if(@($s.secretEnvironmentVariables|Where-Object{$null -ne $_}).Count -ne 0 -or @($s.secretVolumes|Where-Object{$null -ne $_}).Count -ne 0){throw 'SECRET_BINDING_CHANGED'}
 $config=[ordered]@{runtime=$b.runtime;entryPoint=$b.entryPoint;timeoutSeconds=$s.timeoutSeconds;availableMemory=$s.availableMemory;availableCpu=$s.availableCpu;minInstanceCount=$s.minInstanceCount;maxInstanceCount=$s.maxInstanceCount;maxInstanceRequestConcurrency=$s.maxInstanceRequestConcurrency;ingressSettings=$s.ingressSettings;vpcConnector=$s.vpcConnector;vpcConnectorEgressSettings=$s.vpcConnectorEgressSettings;serviceAccountEmail=$s.serviceAccountEmail;secretBindings=@();secretVolumes=@()}
 if([string]$s.timeoutSeconds -cne '30' -or $s.availableMemory -cne '256Mi' -or [string]$s.availableCpu -cne '1' -or [string]$s.maxInstanceCount -cne '20' -or [string]$s.maxInstanceRequestConcurrency -cne '80'){throw 'RUNTIME_LIMIT_CHANGED'}
 if($null -ne $s.minInstanceCount -or $s.ingressSettings -cne 'ALLOW_ALL' -or $null -ne $s.vpcConnector -or $null -ne $s.vpcConnectorEgressSettings -or $s.serviceAccountEmail -cne '751158244178-compute@developer.gserviceaccount.com'){throw 'NETWORK_IDENTITY_CHANGED'}
 return ($config|ConvertTo-Json -Depth 6 -Compress)
}
function Get-HugoPlan([hashtable]$Snapshots) {
 if($Snapshots.Count -ne 4){throw 'SNAPSHOT_SCOPE_INVALID'}
 $configs=@{};$envs=@{}
 foreach($name in $script:HugoNames){
  $s=$Snapshots[$name];$configs[$name]=Get-HugoConfig $s $name;$envs[$name]=Get-HugoUserEnv $s
  if($s.serviceConfig.revision -cne $script:HugoPins[$name][0] -or [string]$s.buildConfig.source.storageSource.generation -cne $script:HugoPins[$name][1]){throw 'REMOTE_SOURCE_CHANGED'}
  if(!(Test-IqMapEqual $envs[$name] $envs[$script:HugoNames[0]])){throw 'GROUP_ENV_MISMATCH'}
 }
 return @{Selector=(($script:HugoNames|ForEach-Object{'functions:'+$_}) -join ',');Env=$envs[$script:HugoNames[0]];Configs=$configs}
}
function Get-HugoArguments {
 return @('scripts/run-firebase-clean-env.mjs','deploy','--project','pay-0-system','--only',(($script:HugoNames|ForEach-Object{'functions:'+$_}) -join ','),'--non-interactive')
}
function Assert-HugoSnapshot($Before,$After,[string]$Name,[hashtable]$Env,[string]$Config,[bool]$MustChange) {
 if((Get-HugoConfig $After $Name) -cne $Config -or !(Test-IqMapEqual (Get-HugoUserEnv $After) $Env)){throw 'CONFIG_POSTFLIGHT_FAILED'}
 $sameRevision=$Before.serviceConfig.revision -ceq $After.serviceConfig.revision
 $sameGeneration=[string]$Before.buildConfig.source.storageSource.generation -ceq [string]$After.buildConfig.source.storageSource.generation
 if(($MustChange -and ($sameRevision -or $sameGeneration)) -or (!$MustChange -and (!$sameRevision -or !$sameGeneration))){throw 'REVISION_POSTFLIGHT_FAILED'}
}
function Assert-HugoWorkspace([string]$Worktree,[string]$Head) {
 if($Head -cnotmatch '^[0-9a-f]{40}$'){throw 'CANDIDATE_HEAD_REQUIRED'}
 $actual=(& git -C $Worktree rev-parse HEAD 2>$null|Out-String).Trim()
 if($LASTEXITCODE -ne 0 -or $actual -cne $Head){throw 'CANDIDATE_HEAD_CHANGED'}
 $status=(& git -C $Worktree status --porcelain --untracked-files=normal 2>$null|Out-String).Trim()
 if($LASTEXITCODE -ne 0 -or $status){throw 'CANDIDATE_DIRTY'}
}
function Assert-HugoLocalEnv([byte[]]$Bytes,[string]$Hash,[hashtable]$Expected) {
 if($Hash -cnotmatch '^[0-9a-f]{64}$' -or (Get-IqHash $Bytes) -cne $Hash){throw 'LOCAL_ENV_BASELINE_CHANGED'}
 $text=[Text.UTF8Encoding]::new($false,$true).GetString($Bytes).TrimStart([char]0xfeff);$map=@{}
 foreach($line in ($text -split '\r?\n')){
  if($line -match '^\s*(#.*)?$'){continue}
  if($line -cnotmatch '^([A-Z][A-Z0-9_]*)=([A-Za-z0-9_-]+)$'){throw 'LOCAL_ENV_SYNTAX_UNREVIEWED'}
  $key=$Matches[1];$value=$Matches[2]
  if($map.ContainsKey($key) -or $key -cnotin @('PAY0_FIREBASE_WEB_API_KEY','TELEGRAM_DOWNLOAD_TRANSPORT_MODE')){throw 'LOCAL_ENV_KEYS_UNREVIEWED'}
  $map[$key]=$value
 }
 if($map.PAY0_FIREBASE_WEB_API_KEY -cne $Expected.PAY0_FIREBASE_WEB_API_KEY){throw 'LOCAL_API_KEY_MISMATCH'}
 if($map.ContainsKey('TELEGRAM_DOWNLOAD_TRANSPORT_MODE') -and $map.TELEGRAM_DOWNLOAD_TRANSPORT_MODE -cne 'POST_FRAGMENT'){throw 'LOCAL_TRANSPORT_UNREVIEWED'}
}
function Save-HugoBackup([string]$RunDir,[byte[]]$Original) {
 $file=Join-Path $RunDir 'original.env';$stream=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$stream.Write($Original,0,$Original.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 if((Get-IqHash ([IO.File]::ReadAllBytes($file))) -cne (Get-IqHash $Original)){throw 'BACKUP_VERIFY_FAILED'}
}
function Invoke-HugoPhase([string]$Target,[byte[]]$Original,[hashtable]$Plan,[scriptblock]$Deploy,[scriptblock]$Postflight,[scriptblock]$Journal) {
 $argsExpected=Get-HugoArguments
 if($Plan.Selector -cne $argsExpected[5] -or $Plan.Env.Count -ne 1 -or !$Plan.Env.ContainsKey('PAY0_FIREBASE_WEB_API_KEY')){throw 'SELECTOR_OR_ENV_INVALID'}
 $staged=ConvertTo-IqDotenv $Plan.Env
 $action={
  & $Journal 'HUGO_DEPLOY_STARTED'
  $exit=& $Deploy (Get-HugoArguments)
  if($exit -isnot [int] -or $exit -ne 0){& $Journal 'HUGO_DEPLOY_FAILED_NO_RETRY';throw 'FIREBASE_DEPLOY_FAILED'}
  & $Postflight
  & $Journal 'HUGO_POSTFLIGHT_PASS'
 }
 Invoke-IqEnvPhase $Target $Original $staged $action $Journal
 if((Get-IqHash ([IO.File]::ReadAllBytes($Target))) -cne (Get-IqHash $Original)){throw 'RESTORATION_HASH_FAILED'}
}
function Get-HugoLiveSnapshot([string]$Name) {
 if($Name -cnotin $script:HugoNames){throw 'FUNCTION_SCOPE_INVALID'}
 $token=(& gcloud.cmd auth print-access-token --project pay-0-system --quiet 2>$null|Out-String).Trim()
 if($LASTEXITCODE -ne 0 -or $token -cnotmatch '^[A-Za-z0-9._~-]{20,4096}$'){throw 'AUTH_UNAVAILABLE'}
 $fields='name,state,buildConfig(runtime,entryPoint,source(storageSource(bucket,object,generation))),serviceConfig(revision,serviceAccountEmail,timeoutSeconds,availableMemory,availableCpu,minInstanceCount,ingressSettings,vpcConnector,vpcConnectorEgressSettings,maxInstanceCount,maxInstanceRequestConcurrency,environmentVariables,secretEnvironmentVariables,secretVolumes)'
 try{return Invoke-RestMethod -Method Get -Uri ('https://cloudfunctions.googleapis.com/v2/projects/pay-0-system/locations/us-central1/functions/'+$Name+'?fields='+[Uri]::EscapeDataString($fields)) -Headers @{Authorization="Bearer $token";'x-goog-user-project'='pay-0-system'} -TimeoutSec 30 -MaximumRedirection 0}
 catch{throw 'METADATA_READ_FAILED'}finally{$token=$null}
}
if($LibraryOnly -or $Mode -eq 'LibraryOnly'){return}
try {
 $repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'));$worktree=Join-Path $repository '.worktrees/pay0-remediation-integration-20261009'
 Assert-HugoWorkspace $worktree $ExpectedHead
 $target=Join-Path $worktree 'functions/.env.pay-0-system'
 $envFiles=@(Get-ChildItem -LiteralPath (Join-Path $worktree 'functions') -Force -File -Filter '.env*')
 if($envFiles.Count -ne 1 -or $envFiles[0].Name -cne '.env.pay-0-system'){throw 'DOTENV_SCOPE_AMBIGUOUS'}
 $original=[IO.File]::ReadAllBytes($target);$snapshots=@{}
 foreach($name in $script:HugoNames){$snapshots[$name]=Get-HugoLiveSnapshot $name}
 $plan=Get-HugoPlan $snapshots;Assert-HugoLocalEnv $original $ExpectedEnvHash $plan.Env
 if($Mode -eq 'Preflight'){Write-Output 'HUGO_PREFLIGHT_PASS functions=4 cloudWrites=0 dotenvWrites=0';return}
 $privateBase=Join-Path $repository '.firebase/hugo-evidence-deploy';[IO.Directory]::CreateDirectory($privateBase)|Out-Null
 & git -C $repository check-ignore --quiet ($privateBase+'/original.env');if($LASTEXITCODE -ne 0){throw 'PRIVATE_BACKUP_NOT_IGNORED'}
 $lockPath=Join-Path $privateBase 'deploy.lock';$lock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try {
  $runDir=Join-Path $privateBase ([guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($runDir)|Out-Null
  Save-HugoBackup $runDir $original;$journalFile=Join-Path $runDir 'journal.jsonl'
  $journal={param($state)[IO.File]::AppendAllText($journalFile,(([ordered]@{at=[DateTime]::UtcNow.ToString('o');state=$state;head=$ExpectedHead;originalHash=$ExpectedEnvHash;selector=$plan.Selector}|ConvertTo-Json -Compress)+"`n"))}
  & $journal 'PREPARED'
  Assert-HugoWorkspace $worktree $ExpectedHead
  foreach($name in $script:HugoNames){Assert-HugoSnapshot $snapshots[$name] (Get-HugoLiveSnapshot $name) $name $plan.Env $plan.Configs[$name] $false}
  $deploy={param([string[]]$arguments)
   $savedDebug=$env:DEBUG
   try{Remove-Item Env:DEBUG -ErrorAction SilentlyContinue;Push-Location $worktree;try{return (Invoke-IqNodeLogged $arguments (Join-Path $runDir 'deploy-private.log'))}finally{Pop-Location}}
   finally{if($null -eq $savedDebug){Remove-Item Env:DEBUG -ErrorAction SilentlyContinue}else{$env:DEBUG=$savedDebug}}
  }
  $postflight={foreach($name in $script:HugoNames){Assert-HugoSnapshot $snapshots[$name] (Get-HugoLiveSnapshot $name) $name $plan.Env $plan.Configs[$name] $true}}
  Invoke-HugoPhase $target $original $plan $deploy $postflight $journal
  & $journal 'COMPLETE_ENV_RESTORED';Write-Output 'HUGO_DEPLOY_PASS functions=4 dotenvRestored=true'
 }finally{$lock.Dispose();[IO.File]::Delete($lockPath)}
}catch{Write-Error 'HUGO_DEPLOY_FAILED: inspect private journal; no automatic retry or remote rollback.';exit 1}
