$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $repo 'scripts/deploy-iq-deposit-preserving-env.ps1') -LibraryOnly
$checks=0
function Check([bool]$Condition,[string]$Name){if(!$Condition){throw "TEST_FAILED:$Name"};$script:checks++}
function Reject([scriptblock]$Action,[string]$Expected){try{& $Action;throw 'EXPECTED_REJECTION_MISSING'}catch{if($_.Exception.Message -notlike ('*'+$Expected+'*')){throw}};$script:checks++}
function Fixtures {
  $rows=@{}
  foreach($name in $script:IqNames){
    $e=@{PAY0_FIREBASE_WEB_API_KEY='SYNTHETIC_PUBLIC_API_KEY_123456789';GCLOUD_PROJECT='pay-0-system'}
    if($name -ne 'processIqPagoDepositOnDemandTask'){$e.PAY0_OPERATION_TIMING='1'}
    $r=@{state='ACTIVE';buildConfig=@{source=@{storageSource=@{generation=$script:IqExpected[$name][1]}}};serviceConfig=@{revision=$script:IqExpected[$name][0];environmentVariables=$e;timeoutSeconds=540;availableMemory='2Gi';availableCpu='1';ingressSettings='ALLOW_ALL';maxInstanceRequestConcurrency=$(if($name -eq 'processIqPagoDepositOnDemandTask'){1}else{80});serviceAccountEmail='synthetic@example.invalid';secretEnvironmentVariables=@(@{key='IQ_CREDENTIALS_KEY';secret='IQ_CREDENTIALS_KEY';version='2'},@{key='TELEGRAM_BOT_TOKEN';secret='TELEGRAM_BOT_TOKEN';version='1'})}}
    if($name -eq 'processIqPagoDepositOnDemandTask'){$r.serviceConfig.maxInstanceCount=1}
    elseif($name -eq 'processIqPagoDepositCreateQueue'){$r.serviceConfig.maxInstanceCount=20}
    $rows[$name]=$r|ConvertTo-Json -Depth 12|ConvertFrom-Json
  };return $rows
}
$rows=Fixtures;$plan=Get-IqPlan $rows
Check ($plan.Groups.Count -eq 2 -and $plan.Groups[0].Count -eq 2 -and $plan.Groups[1].Count -eq 1) 'groups2+1'
Check (!$plan.Envs.processIqPagoDepositOnDemandTask.ContainsKey('PAY0_OPERATION_TIMING')) 'preserveAbsent'
Check ($plan.Envs.processIqPagoDepositAutomaticTask.PAY0_OPERATION_TIMING -eq '1') 'preserveEnabled'
$serialized=[Text.Encoding]::UTF8.GetString((ConvertTo-IqDotenv $plan.Envs.processIqPagoDepositAutomaticTask))
Check (!$serialized.Contains('TELEGRAM_DOWNLOAD_TRANSPORT_MODE') -and !$serialized.Contains('GCLOUD_PROJECT')) 'noUnrelatedEnv'
$rows=Fixtures;$rows.processIqPagoDepositAutomaticTask.serviceConfig.environmentVariables|Add-Member extra 'unreviewed'
Reject {Get-IqPlan $rows} 'REMOTE_ENV_KEY_UNREVIEWED'
$rows=Fixtures;$rows.processIqPagoDepositAutomaticTask.serviceConfig.environmentVariables.PAY0_FIREBASE_WEB_API_KEY='SYNTHETIC_DIFFERENT_KEY_123456789'
Reject {Get-IqPlan $rows} 'GROUP_ENV_MISMATCH'
$rows=Fixtures;$rows.processIqPagoDepositOnDemandTask.serviceConfig.environmentVariables|Add-Member PAY0_OPERATION_TIMING '1'
Reject {Get-IqPlan $rows} 'ONDEMAND_TIMING_CHANGED'
$rows=Fixtures;$rows.processIqPagoDepositCreateQueue.serviceConfig.revision='unexpected'
Reject {Get-IqPlan $rows} 'REMOTE_SOURCE_CHANGED'
$rows=Fixtures;$rows.processIqPagoDepositCreateQueue.serviceConfig.secretEnvironmentVariables[0].version='3'
Reject {Get-IqPlan $rows} 'SECRET_BINDING_CHANGED'
Reject {ConvertTo-IqDotenv @{PAY0_FIREBASE_WEB_API_KEY="unsafe`nINJECT=1"}} 'DOTENV_SERIALIZATION_INVALID'
$rows=Fixtures;$before=$rows.processIqPagoDepositAutomaticTask;$after=$before|ConvertTo-Json -Depth 12|ConvertFrom-Json
Reject {Assert-IqPostflight $before $after $plan.Envs.processIqPagoDepositAutomaticTask $plan.Configs.processIqPagoDepositAutomaticTask} 'REVISION_POSTFLIGHT_FAILED'
$after.serviceConfig.revision='new-revision';$after.buildConfig.source.storageSource.generation='new-generation'
Assert-IqPostflight $before $after $plan.Envs.processIqPagoDepositAutomaticTask $plan.Configs.processIqPagoDepositAutomaticTask;$checks++
$after.serviceConfig.environmentVariables.PAY0_OPERATION_TIMING='0'
Reject {Assert-IqPostflight $before $after $plan.Envs.processIqPagoDepositAutomaticTask $plan.Configs.processIqPagoDepositAutomaticTask} 'CONFIG_POSTFLIGHT_FAILED'
# All newly projected fields are part of prephase and postflight fingerprints.
$drifts=@{availableCpu='2';minInstanceCount=1;ingressSettings='ALLOW_INTERNAL_ONLY';vpcConnector='projects/demo/locations/us-central1/connectors/synthetic';vpcConnectorEgressSettings='ALL_TRAFFIC';maxInstanceCount=20;maxInstanceRequestConcurrency=1}
foreach($field in $drifts.Keys){
  $rows=Fixtures;$before=$rows.processIqPagoDepositAutomaticTask
  $after=$before|ConvertTo-Json -Depth 12|ConvertFrom-Json
  $after.serviceConfig.revision='new-revision';$after.buildConfig.source.storageSource.generation='new-generation'
  $after.serviceConfig|Add-Member -MemberType NoteProperty -Name $field -Value $drifts[$field] -Force
  Check ((Get-IqConfigFingerprint $before) -cne (Get-IqConfigFingerprint $after)) ('prephaseDrift:'+ $field)
  Reject {Assert-IqPostflight $before $after $plan.Envs.processIqPagoDepositAutomaticTask $plan.Configs.processIqPagoDepositAutomaticTask} 'CONFIG_POSTFLIGHT_FAILED'
}
$rows=Fixtures
Check ($null -eq $rows.processIqPagoDepositAutomaticTask.serviceConfig.maxInstanceCount -and $rows.processIqPagoDepositCreateQueue.serviceConfig.maxInstanceCount -eq 20 -and $rows.processIqPagoDepositOnDemandTask.serviceConfig.maxInstanceCount -eq 1) 'endpointSpecificMaxima'
Check ($script:IqHead -ceq 'a71a8b898feb35564faed04a4c14c9bb67639581') 'fixedReviewedHead'
$source=[IO.File]::ReadAllText((Join-Path $repo 'scripts/deploy-iq-deposit-preserving-env.ps1'))
foreach($field in @('availableCpu','minInstanceCount','ingressSettings','vpcConnector','vpcConnectorEgressSettings')){
  Check ($source.Contains(','+$field+',')) ('metadataProjection:'+ $field)
}
$dir=Join-Path $repo ('.firebase/iq-deploy-env-tests/'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($dir)|Out-Null
$file=Join-Path $dir 'original.env';$original=[Text.Encoding]::UTF8.GetBytes("# retained comment`r`nSYNTHETIC=original`r`n");$staged=[Text.Encoding]::UTF8.GetBytes("SYNTHETIC=staged`n");$originalHash=Get-IqHash $original
$script:events=[Collections.Generic.List[string]]::new();$journal={param($s)$script:events.Add($s)}
try {
  [IO.File]::WriteAllBytes($file,$original)
  Invoke-IqEnvPhase $file $original $staged {Check ((Get-IqHash ([IO.File]::ReadAllBytes($file))) -eq (Get-IqHash $staged)) 'stagedInsideAction'} $journal
  Check ((Get-IqHash ([IO.File]::ReadAllBytes($file))) -eq $originalHash) 'exactRestoreSuccess'
  Check ($events[0] -eq 'BEFORE_ENV_CHANGE' -and $events[$events.Count-1] -eq 'ENV_RESTORED') 'journalOrdering'
  Reject {Invoke-IqEnvPhase $file $original $staged {throw 'FAKE_DEPLOY_FAILURE'} $journal} 'FAKE_DEPLOY_FAILURE'
  Check ((Get-IqHash ([IO.File]::ReadAllBytes($file))) -eq $originalHash) 'exactRestoreFailure'
  $external=[Text.Encoding]::UTF8.GetBytes('EXTERNAL=mutation')
  Reject {Invoke-IqEnvPhase $file $original $staged {[IO.File]::WriteAllBytes($file,$external)} $journal} 'LOCAL_ENV_CONFLICT_BACKUP_RETAINED'
  Check ((Get-IqHash ([IO.File]::ReadAllBytes($file))) -eq (Get-IqHash $external)) 'neverOverwriteExternalMutation'
  Reject {Invoke-IqEnvPhase $file $original $staged {throw 'MUST_NOT_RUN'} $journal} 'LOCAL_ENV_CONFLICT'
  Check ((Get-IqHash ([IO.File]::ReadAllBytes($file))) -eq (Get-IqHash $external)) 'conflictBeforeAction'
  $source=[IO.File]::ReadAllText((Join-Path $repo 'scripts/deploy-iq-deposit-preserving-env.ps1'))
  Check ($source.Contains("[string]`$Mode = 'Preflight'") -and $source.Contains("if(`$Mode -eq 'StageDryRun')")) 'defaultReadOnly'
  Check (!$source.Contains('tasks:run') -and !$source.Contains('queues:purge') -and !$source.Contains('Invoke-WebRequest')) 'noFinancialActions'
} finally {
  $resolved=[IO.Path]::GetFullPath($dir);$allowed=[IO.Path]::GetFullPath((Join-Path $repo '.firebase/iq-deploy-env-tests'))+[IO.Path]::DirectorySeparatorChar
  if(!$resolved.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'CLEANUP_SCOPE_INVALID'}
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Output "PASS IQ deploy env fake checks=$checks network=0 deploy=0 realDotenvWrites=0"
