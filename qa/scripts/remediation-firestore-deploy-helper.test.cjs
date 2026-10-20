"use strict";
const assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const script=String.raw`
$ErrorActionPreference='Stop'
. ./scripts/deploy-firestore-remediation.ps1 -Mode LibraryOnly
function Invoke-RestMethod {throw 'NETWORK_FORBIDDEN'}
function gcloud.cmd {throw 'NETWORK_FORBIDDEN'}
$script:checks=0
function Check([bool]$ok,[string]$label){if(!$ok){throw ('TEST_FAILED_'+$label)};$script:checks++}
function Reject([scriptblock]$fn,[string]$expected){try{&$fn;throw 'MISSING_REJECTION'}catch{if($_.Exception.Message -notlike ('*'+$expected+'*')){throw}};$script:checks++}
Check ($script:FsPins.firestore.Ruleset.EndsWith('/042bafab-3487-418e-8245-2416e19d1963')) 'firestorePin'
Check ($script:FsPins.storage.Ruleset.EndsWith('/d37e96b3-5266-4a44-8ce6-c903a502a854')) 'storagePin'
Check ($script:FsCandidateHash -ceq '7863811b85a57ff7dde6e9d3c5925253a90371dfdf4c63fc3a60bebf5ed31876') 'candidatePin'
Check ($script:FsPins.firestore.Hash -ceq '96257055c977d62b4afe30cec4443f65d2717c7a99386fe6578c14e7dd48f20c') 'baselineHash'
# Inspect the GET transport with a fake response; no socket, credential or cloud use.
function Invoke-RestMethod {param($Method,$Uri,$Headers,$TimeoutSec,$MaximumRedirection)
 Check ($Method -ceq 'Get' -and $MaximumRedirection -eq 0 -and $TimeoutSec -eq 30) 'getNoRedirect'
 Check ($Headers.Authorization -ceq 'Bearer synthetic-memory-only') 'tokenOnlyInHeader'
 return @{ok=$true}
}
$reply=Get-FsJson 'https://firebaserules.googleapis.com/v1/projects/pay-0-system/releases/cloud.firestore' 'synthetic-memory-only'
Check ($reply.ok -eq $true) 'fakeTransport'
function Invoke-RestMethod {throw 'NETWORK_FORBIDDEN'}
Reject {Get-FsJson 'https://firebaserules.googleapis.com/v1/projects/other/releases/cloud.firestore' 'synthetic'} 'REMOTE_SCOPE_INVALID'
Check ((Get-FsHash ('a'+[char]13+[char]10+'b'+[char]13+[char]10)) -ceq (Get-FsHash ('a'+[char]10+'b'+[char]10))) 'lfNormalization'
$argsExpected=@('deploy','--project','pay-0-system','--only','firestore:rules','--config','synthetic.json','--non-interactive')
Check (((Get-FsArguments 'synthetic.json') -join '|') -ceq ($argsExpected -join '|')) 'narrowSelector'
$config=Get-FsMinimalConfig
Check ($config.Count -eq 1 -and $config.firestore.Count -eq 1 -and $config.firestore.rules -ceq 'firestore.rules') 'noIndexesStorageHooks'
Reject {Assert-FsWorkspace '.' ''} 'EXPLICIT_REVIEWED_HEAD_REQUIRED'
Reject {Assert-FsPrivateDirectory $PWD ([IO.Path]::GetTempPath())} 'PRIVATE_PATH_OUTSIDE_SCOPE'
Reject {Get-FsLiveSnapshot 'other'} 'RULES_KIND_INVALID'
Reject {Get-FsJson 'https://example.invalid/' 'synthetic'} 'REMOTE_SCOPE_INVALID'
# Only fake fixture hashes are rebound inside this library-only test process.
foreach($kind in @('firestore','storage')){$script:FsPins[$kind].Hash=Get-FsHash ('synthetic-before-'+$kind)}
$script:FsCandidateHash=Get-FsHash 'synthetic-after-firestore'
function Fixtures {
 $rows=@{};foreach($kind in @('firestore','storage')){$p=$script:FsPins[$kind];$rows[$kind]=@{Release=$p.Release;Ruleset=$p.Ruleset;UpdateTime=$p.UpdateTime;Hash=$p.Hash;File=$p.File;Content=('synthetic-before-'+$kind)}};return $rows
}
function After {
 $rows=Fixtures;$rows.firestore.Ruleset='projects/pay-0-system/rulesets/11111111-1111-1111-1111-111111111111';$rows.firestore.UpdateTime='2026-10-10T01:00:00Z';$rows.firestore.Content='synthetic-after-firestore';$rows.firestore.Hash=$script:FsCandidateHash;return $rows
}
$before=Fixtures;Assert-FsBaseline $before;$checks++
foreach($kind in @('firestore','storage')){foreach($key in @('Release','Ruleset','UpdateTime','Hash')){$rows=Fixtures;$rows[$kind][$key]='changed';Reject {Assert-FsBaseline $rows} 'REMOTE_RULES_BASELINE_CHANGED'}}
foreach($kind in @('firestore','storage')){foreach($key in @('File','Content')){$rows=Fixtures;$rows[$kind][$key]='changed';Reject {Assert-FsBaseline $rows} 'REMOTE_RULES_SOURCE_INVALID'}}
Assert-FsPostflight $before (After);$checks++
foreach($key in @('Release','Ruleset','UpdateTime','Hash','File')){$rows=After;$rows.storage[$key]='changed';Reject {Assert-FsPostflight $before $rows} 'STORAGE_RELEASE_CHANGED'}
$rows=After;$rows.storage.Content='changed';Reject {Assert-FsPostflight $before $rows} 'STORAGE_SOURCE_CHANGED'
Reject {Assert-FsPostflight $before (Fixtures)} 'FIRESTORE_RELEASE_NOT_UPDATED'
$rows=After;$rows.firestore.Release='other';Reject {Assert-FsPostflight $before $rows} 'FIRESTORE_RELEASE_NOT_UPDATED'
foreach($key in @('Content','Hash')){$rows=After;$rows.firestore[$key]='changed';Reject {Assert-FsPostflight $before $rows} 'FIRESTORE_POSTFLIGHT_HASH_CHANGED'}
$script:deploys=0;$script:posts=0;$script:events=@()
$journal={param($s)$script:events+=,$s}
$deploy={$script:deploys++;return [int]0};$post={$script:posts++;return (After)}
Invoke-FsPhase $before {} $deploy $post $journal
Check ($deploys -eq 1 -and $posts -eq 1 -and $events[-1] -ceq 'POSTFLIGHT_PASS_STORAGE_UNCHANGED') 'singleDeployPostflight'
Reject {Invoke-FsPhase $before {throw 'RACE_BASELINE_CHANGED'} $deploy $post $journal} 'RACE_BASELINE_CHANGED'
Check ($deploys -eq 1) 'noDeployAfterRace'
foreach($bad in @(1,$null,'0')){Reject {Invoke-FsPhase $before {} {return $bad} $post $journal} 'FIRESTORE_DEPLOY_FAILED'}
Check ($posts -eq 1) 'noFalsePostflightOnNativeFailure'
Reject {Invoke-FsPhase $before {} $deploy {return (Fixtures)} $journal} 'FIRESTORE_RELEASE_NOT_UPDATED'
Check ($deploys -eq 2) 'noAutomaticRetry'
$temp=Join-Path ([IO.Path]::GetTempPath()) ('pay0-fake-rules-'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($temp)|Out-Null
try{Save-FsBackup $temp $before;Check ((Get-FsHash ([IO.File]::ReadAllText((Join-Path $temp 'before-firestore.rules')))) -ceq $before.firestore.Hash) 'backupVerified';Reject {Save-FsBackup $temp $before} 'PRIVATE_FILE_CREATE_FAILED'}finally{foreach($name in @('before-firestore.rules','before-storage.rules','before-references.json')){$f=Join-Path $temp $name;if(Test-Path -LiteralPath $f){[IO.File]::Delete($f)}};[IO.Directory]::Delete($temp)}
Write-Output ('FIRESTORE_DEPLOY_HELPER_PASS checks='+$checks+' network=forbidden')
`;
const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',script],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8',timeout:30000});
process.stdout.write(result.stdout||'');if(result.status!==0)process.stderr.write(result.stderr||'');
assert.equal(result.error,undefined);assert.equal(result.status,0);assert.match(result.stdout,/FIRESTORE_DEPLOY_HELPER_PASS/);
