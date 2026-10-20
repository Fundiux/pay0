[CmdletBinding()]
param([ValidateSet('LibraryOnly','Preflight','StageDryRun','Execute')][string]$Mode='Preflight',[string]$InputFile='',[string]$ExpectedInputHash='',[switch]$LibraryOnly)
$ErrorActionPreference='Stop'
$hostingMode=$Mode;$hostingLibrary=$LibraryOnly
. (Join-Path $PSScriptRoot 'deploy-iq-deposit-preserving-env.ps1') -LibraryOnly
$Mode=$hostingMode;$LibraryOnly=$hostingLibrary
function Assert-NotesHostingInput([string]$Path,[string]$Hash){
 $repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'));$scope=[IO.Path]::GetFullPath((Join-Path $repo '.firebase/notes-hosting-baseline'))+[IO.Path]::DirectorySeparatorChar
 $resolved=[IO.Path]::GetFullPath($Path)
 if(!$resolved.StartsWith($scope,[StringComparison]::OrdinalIgnoreCase)-or $Hash -cnotmatch '^[a-f0-9]{64}$'){throw 'PRIVATE_INPUT_REQUIRED'}
 & git -C $repo check-ignore --quiet -- $resolved;if($LASTEXITCODE -ne 0){throw 'INPUT_NOT_IGNORED'}
 if((Get-IqHash ([IO.File]::ReadAllBytes($resolved))) -cne $Hash){throw 'INPUT_CHANGED'}
 return $resolved
}
if($LibraryOnly -or $Mode -eq 'LibraryOnly'){return}
$lock=$null;$lockPath=$null
try{
 $inputPath=Assert-NotesHostingInput $InputFile $ExpectedInputHash
 $log=Join-Path ([IO.Path]::GetDirectoryName($inputPath)) ('hosting-'+$Mode+'-'+[guid]::NewGuid().ToString('N')+'.log')
 if($Mode -eq 'Execute'){$lockPath=Join-Path $PSScriptRoot '../.firebase/notes-hosting-baseline/operation.lock';$lock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)}
 $nodeMode=switch($Mode){'Execute'{'--launch'} 'StageDryRun'{'--stage'} default{'--check'}}
 if((Invoke-IqNodeLogged @((Join-Path $PSScriptRoot 'lib/notes-hosting-ssr-update-only.cjs'),$nodeMode,$inputPath,$ExpectedInputHash) $log)-ne 0){throw 'LOCAL_PREFLIGHT_FAILED'}
 Assert-NotesHostingInput $InputFile $ExpectedInputHash|Out-Null
 if($Mode -eq 'Execute'){Write-Output 'NOTES_HOSTING_EXECUTE_PASS reviewPrivatePostflight=true'}else{Write-Output ('NOTES_HOSTING_'+$Mode.ToUpper()+'_PASS productionWrites=0 builds=0')}
}catch{Write-Output 'NOTES_HOSTING_GUARD_FAILED detailsRedacted=true';exit 1}finally{if($null -ne $lock){$lock.Dispose();Remove-Item -LiteralPath $lockPath -Force}}
