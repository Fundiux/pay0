[CmdletBinding()]
param([ValidateSet('LibraryOnly','Preflight','Execute')][string]$Mode='Preflight',[string]$ExpectedHead='')
$ErrorActionPreference='Stop'
$script:FsCandidateHash='7863811b85a57ff7dde6e9d3c5925253a90371dfdf4c63fc3a60bebf5ed31876'
$script:FsPins=@{
 firestore=@{Release='projects/pay-0-system/releases/cloud.firestore';Ruleset='projects/pay-0-system/rulesets/042bafab-3487-418e-8245-2416e19d1963';UpdateTime='2026-09-28T08:07:43.649443Z';Hash='96257055c977d62b4afe30cec4443f65d2717c7a99386fe6578c14e7dd48f20c';File='firestore.rules'}
 storage=@{Release='projects/pay-0-system/releases/firebase.storage/pay-0-system.firebasestorage.app';Ruleset='projects/pay-0-system/rulesets/d37e96b3-5266-4a44-8ce6-c903a502a854';UpdateTime='2026-09-28T08:07:42.831469Z';Hash='5876da2001a4c13f1a5947e9e0729a4a9d30f17eed2f890ef1f8f1ef4ccc6282';File='storage.rules'}
}
function Get-FsHash([string]$Text){
 $sha=[Security.Cryptography.SHA256]::Create()
 try{return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text.Replace("`r`n","`n"))))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Assert-FsBaseline([hashtable]$Snapshots){
 foreach($kind in @('firestore','storage')){
  $s=$Snapshots[$kind];$p=$script:FsPins[$kind]
  if(!$s -or $s.Release -cne $p.Release -or $s.Ruleset -cne $p.Ruleset -or $s.UpdateTime -cne $p.UpdateTime -or $s.Hash -cne $p.Hash){throw 'REMOTE_RULES_BASELINE_CHANGED'}
  if($s.File -cne $p.File -or (Get-FsHash $s.Content) -cne $s.Hash){throw 'REMOTE_RULES_SOURCE_INVALID'}
 }
}
function Assert-FsPostflight([hashtable]$Before,[hashtable]$After){
 Assert-FsBaseline $Before
 $b=$Before.storage;$a=$After.storage
 foreach($key in @('Release','Ruleset','UpdateTime','Hash','File')){if(!$a -or $a.$key -cne $b.$key){throw 'STORAGE_RELEASE_CHANGED'}}
 if((Get-FsHash $a.Content) -cne $b.Hash){throw 'STORAGE_SOURCE_CHANGED'}
 $a=$After.firestore
 if(!$a -or $a.Release -cne $script:FsPins.firestore.Release -or $a.File -cne 'firestore.rules' -or $a.Ruleset -cnotmatch '^projects/pay-0-system/rulesets/[0-9a-f-]{36}$' -or $a.Ruleset -ceq $Before.firestore.Ruleset -or !$a.UpdateTime -or $a.UpdateTime -ceq $Before.firestore.UpdateTime){throw 'FIRESTORE_RELEASE_NOT_UPDATED'}
 if($a.Hash -cne $script:FsCandidateHash -or (Get-FsHash $a.Content) -cne $script:FsCandidateHash){throw 'FIRESTORE_POSTFLIGHT_HASH_CHANGED'}
}
function Get-FsArguments([string]$Config){return @('deploy','--project','pay-0-system','--only','firestore:rules','--config',$Config,'--non-interactive')}
function Get-FsMinimalConfig {return @{firestore=@{rules='firestore.rules'}}}
function Assert-FsWorkspace([string]$Worktree,[string]$Head){
 if($Head -cnotmatch '^[0-9a-f]{40}$'){throw 'EXPLICIT_REVIEWED_HEAD_REQUIRED'}
 $actual=(& git -C $Worktree rev-parse HEAD 2>$null|Out-String).Trim()
 if($LASTEXITCODE -ne 0 -or $actual -cne $Head){throw 'CANDIDATE_HEAD_CHANGED'}
 $status=(& git -C $Worktree status --porcelain --untracked-files=normal 2>$null|Out-String).Trim()
 if($LASTEXITCODE -ne 0 -or $status){throw 'CANDIDATE_DIRTY'}
 $file=Join-Path $Worktree 'firestore.rules'
 if(!(Test-Path -LiteralPath $file) -or (Get-FsHash ([IO.File]::ReadAllText($file))) -cne $script:FsCandidateHash){throw 'CANDIDATE_RULES_CHANGED'}
}
function Get-FsToken {
 $saved=$ErrorActionPreference
 try{$ErrorActionPreference='Continue';$token=(& gcloud.cmd auth print-access-token --project pay-0-system --quiet 2>$null|Out-String).Trim();$code=$LASTEXITCODE}finally{$ErrorActionPreference=$saved}
 if($code -ne 0 -or $token -cnotmatch '^[A-Za-z0-9._~-]{20,4096}$'){throw 'AUTH_UNAVAILABLE'}
 return $token
}
function Get-FsJson([string]$Uri,[string]$Token){
 if($Uri -cnotmatch '^https://(?:firebaserules|firestore)\.googleapis\.com/v1/projects/pay-0-system/'){throw 'REMOTE_SCOPE_INVALID'}
 try{return Invoke-RestMethod -Method Get -Uri $Uri -Headers @{Authorization=('Bearer '+$Token)} -TimeoutSec 30 -MaximumRedirection 0}catch{throw 'RULES_METADATA_READ_FAILED'}
}
function Get-FsLiveSnapshot([string]$Kind){
 if($Kind -cnotin @('firestore','storage')){throw 'RULES_KIND_INVALID'}
 $pin=$script:FsPins[$Kind];$token=Get-FsToken
 try{
  $url='https://firebaserules.googleapis.com/v1/'+$pin.Release
  $release=Get-FsJson $url $token
  if($release.name -cne $pin.Release -or $release.rulesetName -cnotmatch '^projects/pay-0-system/rulesets/[0-9a-f-]{36}$'){throw 'RULES_RELEASE_IDENTITY_INVALID'}
  $rules=Get-FsJson ('https://firebaserules.googleapis.com/v1/'+$release.rulesetName) $token
  if($rules.name -cne $release.rulesetName -or @($rules.source.files).Count -ne 1 -or $rules.source.files[0].name -cne $pin.File -or $rules.source.files[0].content -isnot [string]){throw 'RULESET_SOURCE_SHAPE_INVALID'}
  $again=Get-FsJson $url $token
  if($again.rulesetName -cne $release.rulesetName -or $again.updateTime -cne $release.updateTime){throw 'RELEASE_CHANGED_DURING_READ'}
  $text=[string]$rules.source.files[0].content
  return @{Release=$release.name;Ruleset=$release.rulesetName;UpdateTime=[string]$release.updateTime;Hash=(Get-FsHash $text);File=$pin.File;Content=$text}
 }finally{$token=$null}
}
function Get-FsSnapshots {return @{firestore=(Get-FsLiveSnapshot 'firestore');storage=(Get-FsLiveSnapshot 'storage')}}
function Assert-FsDatabaseExists {
 $token=Get-FsToken
 try{$db=Get-FsJson 'https://firestore.googleapis.com/v1/projects/pay-0-system/databases/(default)?fields=name,type' $token
  if($db.name -cne 'projects/pay-0-system/databases/(default)' -or $db.type -cne 'FIRESTORE_NATIVE'){throw 'DEFAULT_DATABASE_UNEXPECTED'}
 }finally{$token=$null}
}
function Assert-FsPrivateDirectory([string]$Root,[string]$Directory){
 $prefix=[IO.Path]::GetFullPath((Join-Path $Root '.firebase/remediation-temp')).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
 $absolute=[IO.Path]::GetFullPath($Directory)
 if(!$absolute.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'PRIVATE_PATH_OUTSIDE_SCOPE'}
 foreach($name in @('before-firestore.rules','before-storage.rules','before-references.json','deploy-private.log','firebase.json')){
  & git -C $Root check-ignore --quiet -- (Join-Path $absolute $name)
  if($LASTEXITCODE -ne 0){throw 'PRIVATE_BACKUP_NOT_IGNORED'}
 }
}
function Write-FsNewFile([string]$Path,[string]$Text){
 $bytes=[Text.UTF8Encoding]::new($false).GetBytes($Text)
 try{$stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)}catch{throw 'PRIVATE_FILE_CREATE_FAILED'}
 try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Save-FsBackup([string]$Directory,[hashtable]$Snapshots){
 Assert-FsBaseline $Snapshots;$references=@{}
 foreach($kind in @('firestore','storage')){
  $s=$Snapshots[$kind];$file=Join-Path $Directory ('before-'+$kind+'.rules');Write-FsNewFile $file $s.Content
  if((Get-FsHash ([IO.File]::ReadAllText($file))) -cne $s.Hash){throw 'BACKUP_HASH_FAILED'}
  $references[$kind]=@{release=$s.Release;ruleset=$s.Ruleset;updateTime=$s.UpdateTime;sha256LF=$s.Hash;sourceFile=[IO.Path]::GetFileName($file)}
 }
 Write-FsNewFile (Join-Path $Directory 'before-references.json') ($references|ConvertTo-Json -Depth 4)
}
function Invoke-FsPhase([hashtable]$Before,[scriptblock]$Recheck,[scriptblock]$Deploy,[scriptblock]$Postflight,[scriptblock]$Journal){
 Assert-FsBaseline $Before
 & $Recheck
 & $Journal 'DEPLOY_STARTED'
 $native=& $Deploy
 if($native -isnot [int] -or $native -ne 0){& $Journal 'DEPLOY_EXIT_FAILED_NO_RETRY';throw 'FIRESTORE_DEPLOY_FAILED'}
 & $Journal 'DEPLOY_EXIT_ZERO'
 $after=& $Postflight
 Assert-FsPostflight $Before $after
 & $Journal 'POSTFLIGHT_PASS_STORAGE_UNCHANGED'
}
function Invoke-FsNative([string]$Worktree,[string]$Config,[string]$Log){
 $arguments=@((Join-Path $Worktree 'scripts/run-firebase-clean-env.mjs'))+(Get-FsArguments $Config)
 $saved=$ErrorActionPreference;$code=$null
 Push-Location $Worktree
 try{$ErrorActionPreference='Continue';$global:LASTEXITCODE=$null;& node @arguments *> $Log;$code=$LASTEXITCODE}finally{$ErrorActionPreference=$saved;Pop-Location}
 if($null -eq $code){throw 'NATIVE_PROCESS_NOT_COMPLETED'}
 return [int]$code
}
if($Mode -eq 'LibraryOnly'){return}
try{
 $root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
 $worktree=(Resolve-Path (Join-Path $root '.worktrees/pay0-remediation-integration-20261009')).Path
 Assert-FsWorkspace $worktree $ExpectedHead
 Assert-FsDatabaseExists
 $before=Get-FsSnapshots;Assert-FsBaseline $before
 if($Mode -eq 'Preflight'){Write-Output ('FIRESTORE_PREFLIGHT_PASS head='+$ExpectedHead+' sha256LF='+$script:FsCandidateHash+' selector=firestore:rules storageUnchanged=true');exit 0}
 $private=Join-Path $root '.firebase/remediation-temp';[IO.Directory]::CreateDirectory($private)|Out-Null
 $lockPath=Join-Path $private 'firestore-release.lock';$lock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{
  $run=Join-Path $private ('firestore-release-'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($run)|Out-Null
  Assert-FsPrivateDirectory $root $run
  Save-FsBackup $run $before
  $config=Join-Path $run 'firebase.json';Write-FsNewFile $config ((Get-FsMinimalConfig)|ConvertTo-Json -Depth 3)
  Write-FsNewFile (Join-Path $run 'firestore.rules') ([IO.File]::ReadAllText((Join-Path $worktree 'firestore.rules')))
  $journal={param($state)[IO.File]::AppendAllText((Join-Path $run 'journal.jsonl'),(([ordered]@{at=[DateTime]::UtcNow.ToString('o');state=$state;head=$ExpectedHead;rulesHash=$script:FsCandidateHash;selector='firestore:rules'}|ConvertTo-Json -Compress)+"`n"))}
  & $journal 'BACKUP_SAVED'
  $recheck={Assert-FsWorkspace $worktree $ExpectedHead;Assert-FsBaseline (Get-FsSnapshots);Assert-FsDatabaseExists
   if((Get-FsHash ([IO.File]::ReadAllText((Join-Path $run 'firestore.rules')))) -cne $script:FsCandidateHash){throw 'STAGED_RULES_CHANGED'}
   if(([IO.File]::ReadAllText($config)) -cne ((Get-FsMinimalConfig)|ConvertTo-Json -Depth 3)){throw 'STAGED_CONFIG_CHANGED'}
  }
  $deploy={return (Invoke-FsNative $worktree $config (Join-Path $run 'deploy-private.log'))}
  $postflight={
   $after=Get-FsSnapshots
   $projection=@{};foreach($kind in @('firestore','storage')){$s=$after[$kind];$projection[$kind]=@{release=$s.Release;ruleset=$s.Ruleset;updateTime=$s.UpdateTime;sha256LF=$s.Hash}}
   Write-FsNewFile (Join-Path $run 'after-references.json') ($projection|ConvertTo-Json -Depth 4)
   return $after
  }
  Invoke-FsPhase $before $recheck $deploy $postflight $journal
  Write-Output ('FIRESTORE_RELEASE_PASS sha256LF='+$script:FsCandidateHash+' storageUnchanged=true')
 }finally{$lock.Dispose();[IO.File]::Delete($lockPath)}
 exit 0
}catch{Write-Error 'FIRESTORE_RELEASE_FAILED: inspect private backup/journal; no retry or rollback was attempted.';exit 1}
