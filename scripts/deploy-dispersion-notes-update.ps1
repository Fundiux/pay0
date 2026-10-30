[CmdletBinding()]
param([ValidateSet('LibraryOnly','PreflightLOCAL','StageDryRunCAS','Execute')][string]$Mode='PreflightLOCAL',[string]$InputFile='',[string]$ExpectedInputHash='',[switch]$LibraryOnly)
$ErrorActionPreference='Stop'
$updateMode=$Mode;$updateLibrary=$LibraryOnly
. (Join-Path $PSScriptRoot 'deploy-dispersion-notes.ps1') -LibraryOnly
$Mode=$updateMode;$LibraryOnly=$updateLibrary
function Assert-NotesUpdatePrivate([string]$File,[string]$Hash) {
 $repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'));$base=Join-Path $repo '.firebase/notes-update'
 $full=[IO.Path]::GetFullPath($File)
 if(!$full.StartsWith($base+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)-or $Hash -cnotmatch '^[a-f0-9]{64}$'){throw 'UPDATE_INPUT_SCOPE'}
 $cursor=$full
 while($cursor -cne $repo){
  if(Test-Path -LiteralPath $cursor){$item=Get-Item -Force -LiteralPath $cursor;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'UPDATE_INPUT_REPARSE'}}
  $next=[IO.Path]::GetDirectoryName($cursor);if(!$next -or $next -ceq $cursor){throw 'UPDATE_INPUT_ANCESTRY'};$cursor=$next
 }
 & git -C $repo check-ignore --quiet -- $full;if($LASTEXITCODE -ne 0){throw 'UPDATE_INPUT_NOT_IGNORED'}
 if((Get-IqHash ([IO.File]::ReadAllBytes($full))) -cne $Hash){throw 'UPDATE_INPUT_CHANGED'}
 return $full
}
if($LibraryOnly -or $Mode -eq 'LibraryOnly'){return}
$lock=$null;$lockPath=$null
try {
 $file=Assert-NotesUpdatePrivate $InputFile $ExpectedInputHash
 $input=Get-Content -Raw -LiteralPath $file|ConvertFrom-Json
 $repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'));$guard=Join-Path $PSScriptRoot 'lib/dispersion-notes-update-launch.cjs'
 $runDir=Join-Path ([IO.Path]::GetDirectoryName($file)) ([guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($runDir)|Out-Null
 if((Invoke-IqNodeLogged @($guard,'--check',$file,$ExpectedInputHash) (Join-Path $runDir 'local-private.log')) -ne 0){throw 'UPDATE_LOCAL_CHECK_FAILED'}
 if($Mode -eq 'PreflightLOCAL'){Write-Output 'NOTES_UPDATE_LOCAL_PASS cloudReads=0 cloudWrites=0 dotenvWrites=0 hostingApproved=false';return}
 $lockPath=Join-Path $repo '.firebase/notes-update/operation.lock';$lock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 $target=Join-Path ([string]$input.candidate.worktree) 'functions/.env.pay-0-system';$original=[IO.File]::ReadAllBytes($target)
 $userEnv=Get-NotesLocalEnv $original ([string]$input.originalEnvSha)
 # Fresh checks before staging; a failed GET does not mutate dotenv.
 if($Mode -eq 'Execute'){
  if((Invoke-IqNodeLogged @($guard,'--fresh',$file,$ExpectedInputHash) (Join-Path $runDir 'fresh-private.log')) -ne 0){throw 'UPDATE_FRESH_CHECK_FAILED'}
 }
 $backup=Join-Path $runDir 'original.env';$stream=[IO.File]::Open($backup,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$stream.Write($original,0,$original.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 if((Get-IqHash ([IO.File]::ReadAllBytes($backup))) -cne [string]$input.originalEnvSha){throw 'UPDATE_BACKUP_HASH'}
 $journalFile=Join-Path $runDir 'journal.jsonl'
 $journal={param($state)[IO.File]::AppendAllText($journalFile,((@{state=$state;at=[DateTime]::UtcNow.ToString('o');inputSha=$ExpectedInputHash}|ConvertTo-Json -Compress)+[char]10))}
 $action={
  Assert-NotesUpdatePrivate $InputFile $ExpectedInputHash|Out-Null
  if((Invoke-IqNodeLogged @($guard,'--stage',$file,$ExpectedInputHash) (Join-Path $runDir 'stage-private.log')) -ne 0){throw 'UPDATE_STAGE_CHECK_FAILED'}
  if($Mode -eq 'StageDryRunCAS'){& $journal 'STAGE_DRY_RUN_PASS';return}
  & $journal 'UPDATE_STARTED'
  if((Invoke-IqNodeLogged @($guard,'--launch',$file,$ExpectedInputHash) (Join-Path $runDir 'deploy-private.log')) -ne 0){& $journal 'UPDATE_FAILED_NO_RETRY';throw 'UPDATE_CLI_FAILED'}
  & $journal 'UPDATE_RUNTIME_PRESERVED_ZIP_REVIEW_PENDING'
 }
 Invoke-NotesPhase $target $original $userEnv $action $journal
 & $journal 'ENV_RESTORED_COMPLETE'
 Write-Output ('NOTES_UPDATE_'+$Mode.ToUpperInvariant()+'_PASS dotenvRestored=true hostingApproved=false independentZipReviewPending=true')
}catch{Write-Output 'NOTES_UPDATE_FAILED detailsRedacted=true noAutomaticRetry=true';exit 1}
finally{if($null -ne $lock){$lock.Dispose();Remove-Item -LiteralPath $lockPath -Force}}
