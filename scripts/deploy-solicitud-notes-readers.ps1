[CmdletBinding()]
param([ValidateSet('LibraryOnly','PreflightLOCAL','StageDryRunCAS','Execute')][string]$Mode='PreflightLOCAL',[string]$InputFile='',[string]$ExpectedInputHash='',[switch]$LibraryOnly)
$ErrorActionPreference='Stop'
$readersMode=$Mode;$readersLibrary=$LibraryOnly
# Verify both dependency files before LibraryOnly dot-sourcing. No remote action.
$imports=@{'deploy-dispersion-notes.ps1'='b5bbf00c80eb4adb17c668d18b8332b0d10cc0be5c85464616dc9937f1b382eb';'deploy-iq-deposit-preserving-env.ps1'='b701db3d0ce92d57a236ccfaac11b7cb342b5fca4cb13d6f689e203b47e7750b'}
foreach($name in $imports.Keys){$file=Join-Path $PSScriptRoot $name;if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -cne $imports[$name]){throw 'READERS_LIBRARY_PIN'}}
. (Join-Path $PSScriptRoot 'deploy-dispersion-notes.ps1') -LibraryOnly
$Mode=$readersMode;$LibraryOnly=$readersLibrary
function Assert-ReadersInput([string]$File,[string]$Hash){
 $repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'));$base=Join-Path $repo '.firebase/solicitud-notes-readers-release';$full=[IO.Path]::GetFullPath($File)
 if(!$full.StartsWith($base+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)-or $Hash -cnotmatch '^[a-f0-9]{64}$'){throw 'READERS_INPUT_SCOPE'}
 for($cursor=$full;$cursor -cne $repo;$cursor=[IO.Path]::GetDirectoryName($cursor)){if(!$cursor){throw 'READERS_ANCESTRY'};$item=Get-Item -Force -LiteralPath $cursor -ErrorAction Stop;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'READERS_REPARSE'}}
 & git -C $repo check-ignore --quiet -- $full;if($LASTEXITCODE -ne 0){throw 'READERS_NOT_PRIVATE'}
 if((Get-IqHash ([IO.File]::ReadAllBytes($full))) -cne $Hash){throw 'READERS_INPUT_CHANGED'}
 return $full
}
function Invoke-ReadersPhase([string]$Target,[string]$OriginalState,[byte[]]$Original,[hashtable]$Env,[scriptblock]$Action,[scriptblock]$Journal,[hashtable]$RestoreGuard=@{Verified=$true}){
 if($OriginalState -cnotin @('ABSENT','PRESENT') -or $Env.Count -ne 1 -or $Env.PAY0_FIREBASE_WEB_API_KEY -cnotmatch '^[A-Za-z0-9_-]{20,200}$'){throw 'READERS_ORIGINAL_STATE'}
 $staged=[Text.Encoding]::UTF8.GetBytes('PAY0_FIREBASE_WEB_API_KEY='+$Env.PAY0_FIREBASE_WEB_API_KEY+[char]10);$owns=$false
 & $Journal 'BEFORE_ENV_STAGE'
 try{
  if($OriginalState -ceq 'PRESENT'){
   if((Get-IqHash ([IO.File]::ReadAllBytes($Target))) -cne (Get-IqHash $Original)){throw 'READERS_ORIGINAL_CHANGED'}
   $owns=$true;[IO.File]::WriteAllBytes($Target,$staged)
  }else{
   $stream=[IO.File]::Open($Target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);$owns=$true
   try{$stream.Write($staged,0,$staged.Length);$stream.Flush($true)}finally{$stream.Dispose()}
  }
  & $Journal 'ENV_STAGED'; & $Action
 }finally{
  if($owns){
   if($RestoreGuard.Verified -cne $true){& $Journal 'OWNED_TREE_UNVERIFIED_ENV_RETAINED';throw 'READERS_OWNED_TREE_UNVERIFIED'}
   if((Get-IqHash ([IO.File]::ReadAllBytes($Target))) -cne (Get-IqHash $staged)){& $Journal 'RESTORE_CONFLICT_BACKUP_RETAINED';throw 'READERS_ENV_CONFLICT'}
   if($OriginalState -ceq 'PRESENT'){[IO.File]::WriteAllBytes($Target,$Original);if((Get-IqHash ([IO.File]::ReadAllBytes($Target))) -cne (Get-IqHash $Original)){throw 'READERS_RESTORE_HASH'};& $Journal 'ENV_RESTORED'}else{Remove-Item -LiteralPath $Target -Force;& $Journal 'ENV_ABSENCE_RESTORED'}
  }
 }
}
function Invoke-ReadersOwnedLaunch([string]$Node,[string[]]$Arguments,[string]$Directory,[string]$Log,[hashtable]$RestoreGuard,[scriptblock]$Journal){
 # Load only at Execute, after the pinned --check. LibraryOnly is inert.
 if(!('ReadersOwnedProcess' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'lib/readers-owned-process.cs')}
 $RestoreGuard.Verified=$false
 & $Journal 'OWNED_TREE_STARTING'
 $result=[ReadersOwnedProcess]::Run($Node,$Arguments,$Directory,$Log,2100000,10000)
 $RestoreGuard.Verified=$result.EmptyVerified
 if(!$result.EmptyVerified){& $Journal 'OWNED_TREE_CLEANUP_UNVERIFIED';throw 'READERS_OWNED_TREE_UNVERIFIED'}
 & $Journal 'OWNED_TREE_EMPTY_VERIFIED'
 if($result.TimedOut -or $result.DescendantsStopped -or $result.Failure -or $result.ExitCode -ne 0){throw 'READERS_CHILD_FAILED_NO_RETRY'}
}
if($LibraryOnly -or $Mode -eq 'LibraryOnly'){return}
$lock=$null;$lockPath=$null;$restoreGuard=@{Verified=$true}
try{
 $file=Assert-ReadersInput $InputFile $ExpectedInputHash
 $readersInput=Get-Content -Raw -LiteralPath $file|ConvertFrom-Json
 $repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'));$node=Join-Path $PSScriptRoot 'lib/solicitud-notes-readers-launch.cjs'
 $runDir=Join-Path ([IO.Path]::GetDirectoryName($file)) ([guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($runDir)|Out-Null
 if((Invoke-IqNodeLogged @($node,'--check',$file,$ExpectedInputHash) (Join-Path $runDir 'local-private.log')) -ne 0){throw 'READERS_LOCAL_CHECK'}
 if($Mode -eq 'PreflightLOCAL'){Write-Output 'READERS_PREFLIGHT_PASS cloudReads=0 cloudWrites=0 dotenvWrites=0';return}
 $lockPath=Join-Path $repo '.firebase/solicitud-notes-readers-release/operation.lock';$lock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 $target=Join-Path ([string]$readersInput.candidate.worktree) 'functions/.env.pay-0-system';$original=$null;$originalState=[string]$readersInput.originalEnv.state;$baselineBytes=[IO.File]::ReadAllBytes([string]$readersInput.baselineFile);if((Get-IqHash $baselineBytes) -cne [string]$readersInput.baselineSha){throw 'READERS_BASELINE_PIN'};$baseline=[Text.Encoding]::UTF8.GetString($baselineBytes)|ConvertFrom-Json;$userEnv=@{PAY0_FIREBASE_WEB_API_KEY=[string]$baseline.function.serviceConfig.environmentVariables.PAY0_FIREBASE_WEB_API_KEY};if($originalState -ceq 'PRESENT'){$original=[IO.File]::ReadAllBytes($target);$localEnv=Get-NotesLocalEnv $original ([string]$readersInput.originalEnv.sha256);if($localEnv.PAY0_FIREBASE_WEB_API_KEY -cne $userEnv.PAY0_FIREBASE_WEB_API_KEY){throw 'READERS_PUBLIC_CONFIG_DRIFT'}}elseif($originalState -cne 'ABSENT' -or (Test-Path -LiteralPath $target)){throw 'READERS_ORIGINAL_STATE'}
 if($Mode -eq 'Execute'){if((Invoke-IqNodeLogged @($node,'--fresh',$file,$ExpectedInputHash) (Join-Path $runDir 'fresh-private.log')) -ne 0){throw 'READERS_FRESH_CHECK'}}
 $backup=Join-Path $runDir 'original-state.backup';$backupBytes=if($originalState -ceq 'PRESENT'){$original}else{[Text.Encoding]::UTF8.GetBytes('{"state":"ABSENT"}')};$stream=[IO.File]::Open($backup,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$stream.Write($backupBytes,0,$backupBytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 if((Get-IqHash ([IO.File]::ReadAllBytes($backup))) -cne (Get-IqHash $backupBytes)){throw 'READERS_BACKUP_PIN'}
 $journalFile=Join-Path $runDir 'journal.jsonl';$journal={param($state)[IO.File]::AppendAllText($journalFile,((@{state=$state;at=[DateTime]::UtcNow.ToString('o');inputSha=$ExpectedInputHash;endpoint=$readersInput.endpointId}|ConvertTo-Json -Compress)+[char]10))}
 $action={Assert-ReadersInput $InputFile $ExpectedInputHash|Out-Null;if((Invoke-IqNodeLogged @($node,'--stage',$file,$ExpectedInputHash) (Join-Path $runDir 'stage-private.log')) -ne 0){throw 'READERS_STAGE_CHECK'};if($Mode -eq 'StageDryRunCAS'){& $journal 'STAGE_DRY_RUN_PASS';return};& $journal 'READER_STARTED';Invoke-ReadersOwnedLaunch (Get-Command node.exe).Source @($node,'--launch',$file,$ExpectedInputHash) ([string]$readersInput.candidate.worktree) (Join-Path $runDir 'deploy-private.log') $restoreGuard $journal;& $journal 'READER_VERIFIED'}
 Invoke-ReadersPhase $target $originalState $original $userEnv $action $journal $restoreGuard
 & $journal 'ENV_RESTORED_COMPLETE'
 Write-Output ('READERS_'+$Mode.ToUpperInvariant()+'_PASS dotenvRestored=true hostingApproved=false')
}catch{Write-Output 'READERS_RELEASE_FAILED detailsRedacted=true noAutomaticRetry=true';exit 1}
finally{if($null -ne $lock){$lock.Dispose();if($restoreGuard.Verified){Remove-Item -LiteralPath $lockPath -Force}}}
