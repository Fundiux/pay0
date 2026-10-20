[CmdletBinding()]
param(
 [ValidateSet('LibraryOnly','Preflight','StageDryRun','Execute')][string]$Mode='Preflight',
 [string]$ExpectedHead='', [string]$ExpectedEnvHash='', [string]$ExpectedProvenanceHash='',
 [string]$ExpectedSourceHash='', [string]$ExpectedCliHash='', [string]$ExpectedWrapperHash='',
 [string]$ExpectedManifestFile='', [string]$ExpectedManifestHash='', [switch]$LibraryOnly
)
$ErrorActionPreference='Stop'
$notesMode=$Mode;$notesLibrary=$LibraryOnly
. (Join-Path $PSScriptRoot 'deploy-iq-deposit-preserving-env.ps1') -LibraryOnly
$Mode=$notesMode;$LibraryOnly=$notesLibrary
$script:NotesName='listClientDispersionNotes'
$script:NotesResource='projects/pay-0-system/locations/us-central1/functions/listClientDispersionNotes'
function Get-NotesLocalEnv([byte[]]$Bytes,[string]$ExpectedHash) {
 if($ExpectedHash -cnotmatch '^[a-f0-9]{64}$' -or (Get-IqHash $Bytes) -cne $ExpectedHash){throw 'LOCAL_ENV_PIN_CHANGED'}
 $text=[Text.UTF8Encoding]::new($false,$true).GetString($Bytes).TrimStart([char]0xfeff);$values=@{}
 foreach($line in ($text -split '\r?\n')){
  if($line -match '^\s*(#.*)?$'){continue}
  if($line -cnotmatch '^([A-Z][A-Z0-9_]*)=([A-Za-z0-9_-]+)$'){throw 'LOCAL_ENV_SYNTAX'}
  $key=$Matches[1];$value=$Matches[2]
  if($key -cnotin @('PAY0_FIREBASE_WEB_API_KEY','TELEGRAM_DOWNLOAD_TRANSPORT_MODE') -or $values.ContainsKey($key)){throw 'LOCAL_ENV_SCOPE'}
  $values[$key]=$value
 }
 if($values.PAY0_FIREBASE_WEB_API_KEY -cnotmatch '^[A-Za-z0-9_-]{20,200}$'){throw 'LOCAL_ENV_KEY'}
 if($values.ContainsKey('TELEGRAM_DOWNLOAD_TRANSPORT_MODE') -and $values.TELEGRAM_DOWNLOAD_TRANSPORT_MODE -cne 'POST_FRAGMENT'){throw 'LOCAL_TRANSPORT'}
 return @{PAY0_FIREBASE_WEB_API_KEY=$values.PAY0_FIREBASE_WEB_API_KEY}
}
function Invoke-NotesPhase([string]$Target,[byte[]]$Original,[hashtable]$Env,[scriptblock]$Action,[scriptblock]$Journal) {
 if($Env.Count -ne 1 -or $Env.PAY0_FIREBASE_WEB_API_KEY -cnotmatch '^[A-Za-z0-9_-]{20,200}$'){throw 'STAGED_ENV_SCOPE'}
 $bytes=[Text.Encoding]::UTF8.GetBytes("PAY0_FIREBASE_WEB_API_KEY=$($Env.PAY0_FIREBASE_WEB_API_KEY)"+[char]10)
 Invoke-IqEnvPhase $Target $Original $bytes $Action $Journal
 if((Get-IqHash ([IO.File]::ReadAllBytes($Target))) -cne (Get-IqHash $Original)){throw 'RESTORATION_HASH_FAILED'}
}
function Get-NotesMetadata([string]$Uri,[bool]$AllowAbsent=$false) {
 if($Uri -cnotmatch '^https://(cloudfunctions|run)\.googleapis\.com/v2/projects/pay-0-system/locations/us-central1/(functions/listClientDispersionNotes|services/listclientdispersionnotes(?:/revisions/listclientdispersionnotes-[a-z0-9-]+)?)\?fields='){throw 'METADATA_SCOPE'}
 $token=(& gcloud.cmd auth print-access-token --project pay-0-system --quiet 2>$null|Out-String).Trim()
 if($LASTEXITCODE -ne 0 -or $token -cnotmatch '^[A-Za-z0-9._~-]{20,4096}$'){throw 'AUTH_UNAVAILABLE'}
 try{return Invoke-RestMethod -Method Get -Uri $Uri -Headers @{Authorization="Bearer $token";'x-goog-user-project'='pay-0-system'} -MaximumRedirection 0 -TimeoutSec 30}
 catch {
  $status=$null;try{$status=[int]$_.Exception.Response.StatusCode}catch{}
  if($AllowAbsent -and $status -eq 404){return @{absent=$true}}
  throw 'METADATA_READ_FAILED'
 }finally{$token=$null}
}
function Get-NotesFunctionUri {
 $fields='name,state,buildConfig(runtime,entryPoint,source(storageSource(bucket,object,generation))),serviceConfig(revision,service,serviceAccountEmail,timeoutSeconds,availableMemory,availableCpu,minInstanceCount,maxInstanceCount,maxInstanceRequestConcurrency,ingressSettings,vpcConnector,vpcConnectorEgressSettings,environmentVariables,secretEnvironmentVariables,secretVolumes)'
 return ('https://cloudfunctions.googleapis.com/v2/'+$script:NotesResource+'?fields='+[Uri]::EscapeDataString($fields))
}
function Assert-NotesAbsent($Result){if(!$Result -or $Result.absent -ne $true){throw 'CREATE_ONLY_ENDPOINT_EXISTS'}}
function Assert-NotesPostflight($Snapshot,[hashtable]$Env) {
 if(!$Snapshot -or $Snapshot.name -cne $script:NotesResource -or $Snapshot.state -cne 'ACTIVE' -or $Snapshot.buildConfig.runtime -cne 'nodejs22' -or $Snapshot.buildConfig.entryPoint -cne $script:NotesName){throw 'POSTFLIGHT_IDENTITY'}
 $s=$Snapshot.serviceConfig
 if([string]$s.timeoutSeconds -cne '60' -or $s.availableMemory -cne '256Mi' -or [string]$s.availableCpu -cne '1' -or [string]$s.maxInstanceRequestConcurrency -cne '1'){throw 'POSTFLIGHT_LIMITS'}
 if(($null -ne $s.minInstanceCount -and [string]$s.minInstanceCount -cne '0') -or $s.ingressSettings -cne 'ALLOW_ALL' -or $s.vpcConnector -or $s.vpcConnectorEgressSettings){throw 'POSTFLIGHT_NETWORK'}
 if($s.serviceAccountEmail -cne '751158244178-compute@developer.gserviceaccount.com' -or @($s.secretEnvironmentVariables|Where-Object{$null -ne $_}).Count -or @($s.secretVolumes|Where-Object{$null -ne $_}).Count){throw 'POSTFLIGHT_BINDINGS'}
 $managed=@('FIREBASE_CONFIG','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','GCP_PROJECT','FUNCTION_REGION','FUNCTION_TARGET','FUNCTION_SIGNATURE_TYPE','FUNCTION_NAME','K_SERVICE','K_REVISION','K_CONFIGURATION','PORT','EVENTARC_CLOUD_EVENT_SOURCE','LOG_EXECUTION_ID');$actual=@{}
 $map=Get-IqMap $s.environmentVariables;foreach($key in $map.Keys){if($key -cnotin $managed){$actual[$key]=$map[$key]}}
 if(!(Test-IqMapEqual $actual $Env)){throw 'POSTFLIGHT_ENV'}
 $source=$Snapshot.buildConfig.source.storageSource
 if($source.bucket -cne 'gcf-v2-sources-751158244178-us-central1' -or $source.object -cne 'listClientDispersionNotes/function-source.zip' -or [string]$source.generation -cnotmatch '^[1-9][0-9]*$'){throw 'POSTFLIGHT_SOURCE'}
 if($s.service -cne 'projects/pay-0-system/locations/us-central1/services/listclientdispersionnotes' -or $s.revision -cnotmatch '^listclientdispersionnotes-[a-z0-9-]+$'){throw 'POSTFLIGHT_SERVICE'}
 # Intentionally no max default inferred. Even a valid observed value needs explicit review.
 if($null -ne $s.maxInstanceCount -and [string]$s.maxInstanceCount -cnotmatch '^[1-9][0-9]*$'){throw 'POSTFLIGHT_MAX_FORMAT'}
 return @{maxObserved=$s.maxInstanceCount;maxStatus='REQUIRES_REVIEW';hostingApproved=$false}
}
if($LibraryOnly -or $Mode -eq 'LibraryOnly'){return}
try {
 $repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'));$worktree=Join-Path $repo '.worktrees/pay0-remediation-integration-20261009'
 foreach($pin in @($ExpectedEnvHash,$ExpectedProvenanceHash,$ExpectedSourceHash,$ExpectedCliHash,$ExpectedWrapperHash,$ExpectedManifestHash)){if($pin -cnotmatch '^[a-f0-9]{64}$'){throw 'PIN_REQUIRED'}}
 if($ExpectedHead -cnotmatch '^[a-f0-9]{40}$'){throw 'HEAD_REQUIRED'}
 $target=Join-Path $worktree 'functions/.env.pay-0-system';$files=@(Get-ChildItem -LiteralPath (Join-Path $worktree 'functions') -Force -File -Filter '.env*')
 if($files.Count -ne 1 -or $files[0].Name -cne '.env.pay-0-system'){throw 'DOTENV_SCOPE_AMBIGUOUS'}
 $original=[IO.File]::ReadAllBytes($target);$userEnv=Get-NotesLocalEnv $original $ExpectedEnvHash
 $privateBase=Join-Path $repo '.firebase/notes-deploy'
 & git -C $repo check-ignore --quiet -- ($privateBase+'/input.json');if($LASTEXITCODE -ne 0){throw 'PRIVATE_SCOPE_NOT_IGNORED'}
 [IO.Directory]::CreateDirectory($privateBase)|Out-Null
 $lockPath=Join-Path $privateBase 'operation.lock';$lock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try {
  $runDir=Join-Path $privateBase ([guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($runDir)|Out-Null
  $inputPath=Join-Path $runDir 'input.json';$guard=Join-Path $PSScriptRoot 'lib/dispersion-notes-create-only.cjs'
  $input=@{worktree=$worktree;head=$ExpectedHead;provenanceSha=$ExpectedProvenanceHash;sourceSha=$ExpectedSourceHash;cliSha=$ExpectedCliHash;wrapperSha=$ExpectedWrapperHash;manifest=$ExpectedManifestFile;manifestSha=$ExpectedManifestHash;receipt=(Join-Path $runDir 'guard.jsonl')}
  [IO.File]::WriteAllText($inputPath,($input|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
  if((Invoke-IqNodeLogged @($guard,'--check',$inputPath) (Join-Path $runDir 'candidate-private.log')) -ne 0){throw 'CANDIDATE_FAILED'}
  if($Mode -ne 'StageDryRun'){Assert-NotesAbsent (Get-NotesMetadata (Get-NotesFunctionUri) $true)}
  if($Mode -eq 'Preflight'){Write-Output 'NOTES_PREFLIGHT_PASS functions=1 cloudWrites=0 maxStatus=REQUIRES_REVIEW hostingApproved=false';return}
  $backup=Join-Path $runDir 'original.env';$stream=[IO.File]::Open($backup,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$stream.Write($original,0,$original.Length);$stream.Flush($true)}finally{$stream.Dispose()}
  if((Get-IqHash ([IO.File]::ReadAllBytes($backup))) -cne $ExpectedEnvHash){throw 'BACKUP_HASH'}
  $journalFile=Join-Path $runDir 'journal.jsonl';$journal={param($state)[IO.File]::AppendAllText($journalFile,((@{state=$state;at=[DateTime]::UtcNow.ToString('o');head=$ExpectedHead}|ConvertTo-Json -Compress)+[char]10))}
  $action={
   if((Invoke-IqNodeLogged @($guard,'--check',$inputPath) (Join-Path $runDir 'staged-private.log')) -ne 0){throw 'STAGED_CANDIDATE_FAILED'}
   if($Mode -eq 'StageDryRun'){& $journal 'STAGE_DRY_RUN_PASS';return}
   Assert-NotesAbsent (Get-NotesMetadata (Get-NotesFunctionUri) $true)
   & $journal 'CREATE_STARTED'
   if((Invoke-IqNodeLogged @($guard,'--launch',$inputPath) (Join-Path $runDir 'deploy-private.log')) -ne 0){& $journal 'CREATE_FAILED_NO_RETRY';throw 'CLI_CREATE_FAILED'}
   $snapshot=Get-NotesMetadata (Get-NotesFunctionUri);$status=Assert-NotesPostflight $snapshot $userEnv
   $base='https://run.googleapis.com/v2/projects/pay-0-system/locations/us-central1/services/listclientdispersionnotes'
   $service=Get-NotesMetadata ($base+'?fields='+[Uri]::EscapeDataString('name,latestReadyRevision,latestCreatedRevision,terminalCondition,trafficStatuses,scaling,template(scaling,maxInstanceRequestConcurrency,timeout,serviceAccount,containers(resources),vpcAccess)'))
   $revision=Get-NotesMetadata ($base+'/revisions/'+$snapshot.serviceConfig.revision+'?fields='+[Uri]::EscapeDataString('name,conditions,scaling,maxInstanceRequestConcurrency,timeout,serviceAccount,containers(resources),vpcAccess'))
   # Private metadata reference for independent postflight and exact-generation ZIP verification.
   [IO.File]::WriteAllText((Join-Path $runDir 'postflight-private.json'),(@{function=$snapshot;service=$service;revision=$revision}|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
   & $journal 'FUNCTION_CONFIG_PASS_RUN_SCALING_AND_SOURCE_ZIP_REVIEW_REQUIRED'
  }
  Invoke-NotesPhase $target $original $userEnv $action $journal
  & $journal 'ENV_RESTORED_COMPLETE'
  Write-Output ('NOTES_'+$Mode.ToUpperInvariant()+'_COMPLETED functions=1 dotenvRestored=true hostingApproved=false independentRunAndZipReviewRequired=true')
 }finally{$lock.Dispose();[IO.File]::Delete($lockPath)}
}catch{Write-Error 'NOTES_DEPLOY_FAILED detailsRedacted=true; inspect private journal; no automatic retry or rollback.';exit 1}
