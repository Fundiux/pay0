'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// PowerShell library-only harness; all paths/data are synthetic and local.
const script = String.raw`
$ErrorActionPreference='Stop'
. ./scripts/deploy-dispersion-document-core.ps1 -Mode LibraryOnly
function Get-DocumentLiveSnapshot {throw 'NETWORK_FORBIDDEN'}
function Invoke-RestMethod {throw 'NETWORK_FORBIDDEN'}
function gcloud.cmd {throw 'NETWORK_FORBIDDEN'}
$script:checks=0
function Check([bool]$ok,[string]$label){if(!$ok){throw ('TEST_FAILED_'+$label)};$script:checks++}
function Reject([scriptblock]$fn,[string]$expected){try{&$fn;throw 'MISSING_REJECTION'}catch{if($_.Exception.Message -notlike ('*'+$expected+'*')){throw}};$script:checks++}
function Fixtures {
 $rows=@{}
 foreach($name in $script:DocumentNames){$rows[$name]=@{name=('projects/pay-0-system/locations/us-central1/functions/'+$name);state='ACTIVE';buildConfig=@{runtime='nodejs22';entryPoint=$name;source=@{storageSource=@{bucket='gcf-v2-sources-751158244178-us-central1';object=($name+'/function-source.zip');generation=$script:DocumentPins[$name][1]}}};serviceConfig=@{revision=$script:DocumentPins[$name][0];environmentVariables=@{PAY0_FIREBASE_WEB_API_KEY='SYNTHETIC_PUBLIC_KEY_123456789';K_SERVICE='managed'};timeoutSeconds=60;availableMemory='256Mi';availableCpu='1';minInstanceCount=$null;maxInstanceCount=20;maxInstanceRequestConcurrency=80;ingressSettings='ALLOW_ALL';vpcConnector=$null;vpcConnectorEgressSettings=$null;serviceAccountEmail='751158244178-compute@developer.gserviceaccount.com';secretEnvironmentVariables=@();secretVolumes=@()}}|ConvertTo-Json -Depth 12|ConvertFrom-Json;if($name -ceq 'finalizeDispersionDocumentUpload'){$rows[$name].serviceConfig.secretEnvironmentVariables=@([pscustomobject]@{key='TELEGRAM_BOT_TOKEN';projectId='pay-0-system';secret='TELEGRAM_BOT_TOKEN';version='1'})}};return $rows
}
$rows=Fixtures;$plan=Get-DocumentPlan $rows;$name=$script:DocumentNames[0]
$expected='functions:initDispersionDocumentUpload,functions:finalizeDispersionDocumentUpload,functions:deactivateDispersionDocument'
Check ($plan.Selector -ceq $expected) 'selector'
Check ((Get-DocumentArguments)[5] -ceq $expected) 'arguments'
Check ($plan.Env.Count -eq 1) 'envScope'
Check ($plan.Configs[$name].Contains('"minInstanceCount":null') -and $plan.Configs[$name].Contains('"vpcConnector":null')) 'namedNulls'
foreach($n in $script:DocumentNames){
 $r=Fixtures;$r[$n].serviceConfig.revision='wrong';Reject {Get-DocumentPlan $r} 'REMOTE_SOURCE_CHANGED'
 $r=Fixtures;$r[$n].buildConfig.source.storageSource.generation='0';Reject {Get-DocumentPlan $r} 'REMOTE_SOURCE_CHANGED'
 $r=Fixtures;$r[$n].state='UPDATING';Reject {Get-DocumentPlan $r} 'ENDPOINT_NOT_ACTIVE'
}
foreach($field in @('timeoutSeconds','availableMemory','availableCpu','maxInstanceCount','maxInstanceRequestConcurrency')){$r=Fixtures;$r[$name].serviceConfig.$field='wrong';Reject {Get-DocumentPlan $r} 'RUNTIME_LIMIT_CHANGED'}
foreach($field in @('minInstanceCount','ingressSettings','vpcConnector','vpcConnectorEgressSettings','serviceAccountEmail')){$r=Fixtures;$r[$name].serviceConfig.$field='wrong';Reject {Get-DocumentPlan $r} 'NETWORK_IDENTITY_CHANGED'}
$r=Fixtures;$r[$name].serviceConfig.minInstanceCount=0;Reject {Get-DocumentPlan $r} 'NETWORK_IDENTITY_CHANGED'
$r=Fixtures;$r[$name].buildConfig.runtime='nodejs20';Reject {Get-DocumentPlan $r} 'RUNTIME_IDENTITY_CHANGED'
$r=Fixtures;$r[$name].buildConfig.entryPoint='other';Reject {Get-DocumentPlan $r} 'RUNTIME_IDENTITY_CHANGED'
$r=Fixtures;$r[$name].buildConfig.source.storageSource.bucket='other';Reject {Get-DocumentPlan $r} 'SOURCE_LOCATION_CHANGED'
$r=Fixtures;$r[$name].serviceConfig.secretEnvironmentVariables=@(@{key='SYNTHETIC'});Reject {Get-DocumentPlan $r} 'SECRET_BINDING_CHANGED'
foreach($field in @('key','projectId','secret','version')){$r=Fixtures;$r.finalizeDispersionDocumentUpload.serviceConfig.secretEnvironmentVariables[0].$field='WRONG';Reject {Get-DocumentPlan $r} 'SECRET_BINDING_CHANGED'}
Assert-DocumentSecretVersion ([pscustomobject]@{name='projects/751158244178/secrets/TELEGRAM_BOT_TOKEN/versions/1';state='ENABLED'});$checks++
foreach($version in @(@{name='projects/751158244178/secrets/TELEGRAM_BOT_TOKEN/versions/2';state='ENABLED'},@{name='projects/751158244178/secrets/TELEGRAM_BOT_TOKEN/versions/1';state='DISABLED'},@{name='projects/other-project/secrets/TELEGRAM_BOT_TOKEN/versions/1';state='ENABLED'})){Reject {Assert-DocumentSecretVersion ([pscustomobject]$version)} 'LATEST_SECRET_VERSION_CHANGED'}
$r=Fixtures;$r[$name].serviceConfig.secretVolumes=@(@{mountPath='/fake'});Reject {Get-DocumentPlan $r} 'SECRET_BINDING_CHANGED'
$r=Fixtures;$r[$name].serviceConfig.environmentVariables|Add-Member TELEGRAM_DOWNLOAD_TRANSPORT_MODE POST_FRAGMENT;Reject {Get-DocumentPlan $r} 'REMOTE_ENV_KEY_UNREVIEWED'
$r=Fixtures;$r[$script:DocumentNames[1]].serviceConfig.environmentVariables.PAY0_FIREBASE_WEB_API_KEY='OTHER_SYNTHETIC_KEY_123456789';Reject {Get-DocumentPlan $r} 'GROUP_ENV_MISMATCH'
$original=[Text.Encoding]::UTF8.GetBytes("# synthetic bytes and CRLF preserved"+[char]13+[char]10+"PAY0_FIREBASE_WEB_API_KEY=SYNTHETIC_PUBLIC_KEY_123456789"+[char]13+[char]10+"TELEGRAM_DOWNLOAD_TRANSPORT_MODE=POST_FRAGMENT"+[char]13+[char]10)
$hash=Get-IqHash $original;Assert-DocumentLocalEnv $original $hash $plan.Env;$checks++
Reject {Assert-DocumentLocalEnv $original ('0'*64) $plan.Env} 'LOCAL_ENV_BASELINE_CHANGED'
foreach($suffix in @('PAY0_FIREBASE_WEB_API_KEY=duplicate','OTHER=synthetic','export OTHER=synthetic','TELEGRAM_DOWNLOAD_TRANSPORT_MODE=BRIDGE')){
 $b=[Text.Encoding]::UTF8.GetBytes([Text.Encoding]::UTF8.GetString($original)+$suffix);Reject {Assert-DocumentLocalEnv $b (Get-IqHash $b) $plan.Env} 'LOCAL_ENV_'
}
Reject {Assert-DocumentWorkspace '.' ''} 'CANDIDATE_HEAD_REQUIRED'
$after=$rows[$name]|ConvertTo-Json -Depth 12|ConvertFrom-Json
Reject {Assert-DocumentSnapshot $rows[$name] $after $name $plan.Env $plan.Configs[$name] $true} 'REVISION_POSTFLIGHT_FAILED'
$after.serviceConfig.revision='new';$after.buildConfig.source.storageSource.generation='999999'
Assert-DocumentSnapshot $rows[$name] $after $name $plan.Env $plan.Configs[$name] $true;$checks++
Reject {Assert-DocumentSnapshot $rows[$name] $after $name $plan.Env $plan.Configs[$name] $false} 'REVISION_POSTFLIGHT_FAILED'
$after.serviceConfig.maxInstanceCount=21;Reject {Assert-DocumentSnapshot $rows[$name] $after $name $plan.Env $plan.Configs[$name] $true} 'RUNTIME_LIMIT_CHANGED'
$after.serviceConfig.maxInstanceCount=20;$after.serviceConfig.environmentVariables.PAY0_FIREBASE_WEB_API_KEY='OTHER_SYNTHETIC_KEY_123456789';Reject {Assert-DocumentSnapshot $rows[$name] $after $name $plan.Env $plan.Configs[$name] $true} 'CONFIG_POSTFLIGHT_FAILED'
$dir=Join-Path ([IO.Path]::GetTempPath()) ('pay0-document-helper-test-'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($dir)|Out-Null
$target=Join-Path $dir 'synthetic.env';$script:events=[Collections.Generic.List[string]]::new();$journal={param($state)$script:events.Add($state)}
try {
 [IO.File]::WriteAllBytes($target,$original);Save-DocumentBackup $dir $original
 Check ((Get-IqHash ([IO.File]::ReadAllBytes((Join-Path $dir 'original.env')))) -ceq $hash) 'backupExact'
 Reject {Save-DocumentBackup $dir $original} 'already exists'
 $script:deploys=0;$deploy={param([string[]]$arguments)$script:deploys++;Check (($arguments -join '|') -ceq ((Get-DocumentArguments) -join '|')) 'exactArgs';$stage=[Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($target));Check ($stage -ceq ("PAY0_FIREBASE_WEB_API_KEY=SYNTHETIC_PUBLIC_KEY_123456789"+[char]10)) 'stagedOnlyPublicKey';return [int]0}
 Invoke-DocumentPhase $target $original $plan $deploy {} $journal
 Check ($script:deploys -eq 1) 'singleDeploy';Check ((Get-IqHash ([IO.File]::ReadAllBytes($target))) -ceq $hash) 'restoredSuccess'
 Check ($events.Contains('DOCUMENT_POSTFLIGHT_PASS') -and $events[$events.Count-1] -ceq 'ENV_RESTORED') 'journalOrder'
 Reject {Invoke-DocumentPhase $target $original $plan {return [int]1} {} $journal} 'FIREBASE_DEPLOY_FAILED'
 Check ((Get-IqHash ([IO.File]::ReadAllBytes($target))) -ceq $hash) 'restoredDeployFailure'
 Reject {Invoke-DocumentPhase $target $original $plan {return '0'} {} $journal} 'FIREBASE_DEPLOY_FAILED'
 Check ((Get-IqHash ([IO.File]::ReadAllBytes($target))) -ceq $hash) 'restoredInvalidExitType'
 Reject {Invoke-DocumentPhase $target $original $plan {throw 'SYNTHETIC_ABORT'} {} $journal} 'SYNTHETIC_ABORT'
 Check ((Get-IqHash ([IO.File]::ReadAllBytes($target))) -ceq $hash) 'restoredAbort'
 Reject {Invoke-DocumentPhase $target $original $plan {return [int]0} {throw 'SYNTHETIC_POSTFLIGHT'} $journal} 'SYNTHETIC_POSTFLIGHT'
 Check ((Get-IqHash ([IO.File]::ReadAllBytes($target))) -ceq $hash) 'restoredPostflightFailure'
 $bad=@{Selector='functions:other';Env=$plan.Env};Reject {Invoke-DocumentPhase $target $original $bad $deploy {} $journal} 'SELECTOR_OR_ENV_INVALID'
 Check ($script:deploys -eq 1) 'noWrongSelectorOrRetry'
 $bad=@{Selector=$plan.Selector;Env=@{PAY0_FIREBASE_WEB_API_KEY='SYNTHETIC_PUBLIC_KEY_123456789';PAY0_OPERATION_TIMING='1'}};Reject {Invoke-DocumentPhase $target $original $bad $deploy {} $journal} 'SELECTOR_OR_ENV_INVALID'
 [IO.File]::WriteAllText($target,'concurrent edit');Reject {Invoke-DocumentPhase $target $original $plan $deploy {} $journal} 'LOCAL_ENV_CONFLICT'
 Check ([IO.File]::ReadAllText($target) -ceq 'concurrent edit') 'preserveConcurrentBeforeStage'
 [IO.File]::WriteAllBytes($target,$original)
 Reject {Invoke-DocumentPhase $target $original $plan {[IO.File]::WriteAllText($target,'concurrent edit');return [int]0} {} $journal} 'LOCAL_ENV_CONFLICT_BACKUP_RETAINED'
 Check ([IO.File]::ReadAllText($target) -ceq 'concurrent edit') 'preserveConcurrentBeforeRestore'
 Check ((Get-IqHash ([IO.File]::ReadAllBytes((Join-Path $dir 'original.env')))) -ceq $hash) 'backupRetained'
}finally{if([IO.Path]::GetFullPath($dir).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()))){Remove-Item -LiteralPath $dir -Recurse -Force}}
Write-Output "DOCUMENT_DEPLOY_HELPER_PASS checks=$checks remoteCalls=0"
`;
const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 30000 });
assert.equal(result.status, 0, result.stdout + result.stderr);
assert.match(result.stdout, /DOCUMENT_DEPLOY_HELPER_PASS checks=\d+ remoteCalls=0/);
process.stdout.write(result.stdout);
