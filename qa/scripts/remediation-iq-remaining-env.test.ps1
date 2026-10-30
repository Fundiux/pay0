$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $repo 'scripts/deploy-iq-remaining-preserving-env.ps1') -LibraryOnly -ExpectedHead 'a276e0397bb2e7e7494ae9dd7588efa8a0537c93'
function Invoke-RemainingGet {throw 'NETWORK_FORBIDDEN'}
$script:checks=0
function Check([bool]$Condition,[string]$Name){if(!$Condition){throw ('TEST_FAILED:'+ $Name)};$script:checks++}
function Reject([scriptblock]$Action,[string]$Code){try{& $Action|Out-Null;throw 'EXPECTED_REJECTION_MISSING'}catch{if($_.Exception.Message -notlike ('*'+$Code+'*')){throw}};$script:checks++}
function Clone($Object){return($Object|ConvertTo-Json -Depth 20|ConvertFrom-Json)}
function Fixtures {
 $rows=@{}
 foreach($name in $script:RemainingNames){
  $pin=$script:RemainingPins[$name];$envMap=@{PAY0_FIREBASE_WEB_API_KEY='SYNTHETIC_PUBLIC_API_KEY_123456789';GCLOUD_PROJECT='pay-0-system'}
  if($name -ceq 'processIqCreateOnDemandTask'){$envMap.PAY0_OPERATION_TIMING='1'}
  $secrets=@(@{key='IQ_CREDENTIALS_KEY';projectId='pay-0-system';secret='IQ_CREDENTIALS_KEY';version='2'})
  if($name -cin $script:RemainingSolicitud){$secrets+=@{key='TELEGRAM_BOT_TOKEN';projectId='pay-0-system';secret='TELEGRAM_BOT_TOKEN';version='1'}}
  $rows[$name]=Clone @{name=('projects/pay-0-system/locations/us-central1/functions/'+$name);state='ACTIVE';buildConfig=@{runtime='nodejs22';entryPoint=$name;source=@{storageSource=@{bucket='gcf-v2-sources-751158244178-us-central1';object=($name+'/function-source.zip');generation=$pin[1]}}};serviceConfig=@{revision=$pin[0];environmentVariables=$envMap;timeoutSeconds=$pin[4];availableMemory='2Gi';availableCpu='1';maxInstanceCount=$pin[2];maxInstanceRequestConcurrency=$pin[3];ingressSettings='ALLOW_ALL';serviceAccountEmail='751158244178-compute@developer.gserviceaccount.com';secretEnvironmentVariables=$secrets}}
 };return $rows
}
function Jobs {
 $rows=@{};foreach($name in @('processIqCreateQueue','processIqDispersionCreate','syncTodayIqInvoicesNow','checkPaymentComplementsDaily')){
  $schedule=switch($name){'processIqCreateQueue'{'every 1 minutes'};'processIqDispersionCreate'{'every 5 minutes'};'syncTodayIqInvoicesNow'{'every 24 hours'};default{'0 19 * * 1-5'}}
  $rows[$name]=Clone @{name=('projects/pay-0-system/locations/us-central1/jobs/firebase-schedule-'+$name+'-us-central1');state=$(if($name -cin @('processIqCreateQueue','processIqDispersionCreate')){'ENABLED'}else{'PAUSED'});schedule=$schedule;timeZone='America/Mexico_City';attemptDeadline='540s'}
 }
 $rows.processIqCreateOnDemandTask=Clone @{name='projects/pay-0-system/locations/us-central1/queues/processIqCreateOnDemandTask';state='RUNNING';rateLimits=@{maxConcurrentDispatches=1;maxDispatchesPerSecond=1;maxBurstSize=10};retryConfig=@{maxAttempts=1;minBackoff='60s';maxBackoff='300s';maxDoublings=16}}
 return $rows
}
$rows=Fixtures;$plan=Get-RemainingPlan $rows
Check ($plan.Groups.Count -eq 2 -and $plan.Groups[0].Count -eq 5 -and $plan.Groups[1].Count -eq 1) 'groups5+1'
Check (($plan.Groups[0] -join '|') -ceq 'createSolicitudIq|processIqCreateQueue|createClientDispersionIq|processIqDispersionCreate|executeUserCommissionDispersion') 'financialCohortsPreserved'
Check ($plan.Groups[1][0] -ceq 'processIqCreateOnDemandTask') 'timedTaskOnly'
foreach($name in $script:RemainingNames){Check ($plan.Envs[$name].ContainsKey('PAY0_OPERATION_TIMING') -eq ($name -ceq 'processIqCreateOnDemandTask')) ('envPresence:'+ $name)}
foreach($g in @(0,1)){$a=Get-RemainingArguments $g;Check ($a.Count -eq 7 -and $a[3] -ceq 'pay-0-system' -and $a[6] -ceq '--non-interactive') 'normalFirebase';Check (!$a[5].Contains('Automatic') -and !$a[5].Contains('Pago')) 'noDepositScope'}
Reject {Get-RemainingArguments 2} 'GROUP_SCOPE_INVALID'
$rows=Fixtures;$rows.processIqCreateOnDemandTask.serviceConfig.environmentVariables.PAY0_OPERATION_TIMING='0';$zero=Get-RemainingPlan $rows
Check ($zero.Envs.processIqCreateOnDemandTask.PAY0_OPERATION_TIMING -ceq '0') 'preserveDisabledExactValue'
$rows=Fixtures;$rows.createSolicitudIq.serviceConfig.environmentVariables|Add-Member PAY0_OPERATION_TIMING '1';Reject {Get-RemainingPlan $rows} 'TIMING_PRESENCE_CHANGED'
$rows=Fixtures;$rows.processIqCreateOnDemandTask.serviceConfig.environmentVariables.PSObject.Properties.Remove('PAY0_OPERATION_TIMING');Reject {Get-RemainingPlan $rows} 'TIMING_PRESENCE_CHANGED'
$rows=Fixtures;$rows.processIqCreateOnDemandTask.serviceConfig.environmentVariables.PAY0_OPERATION_TIMING="1`nINJECT=x";Reject {Get-RemainingPlan $rows} 'TIMING_FORMAT_UNREVIEWED'
$rows=Fixtures;$rows.createSolicitudIq.serviceConfig.environmentVariables|Add-Member TELEGRAM_DOWNLOAD_TRANSPORT_MODE 'POST_FRAGMENT';Reject {Get-RemainingPlan $rows} 'REMOTE_ENV_KEY_UNREVIEWED'
$rows=Fixtures;$rows.processIqCreateQueue.serviceConfig.environmentVariables.PAY0_FIREBASE_WEB_API_KEY='SYNTHETIC_OTHER_PUBLIC_KEY_123456';Reject {Get-RemainingPlan $rows} 'GROUP_ENV_MISMATCH'
$rows=Fixtures;$rows.processIqCreateOnDemandTask.serviceConfig.environmentVariables.PAY0_FIREBASE_WEB_API_KEY='SYNTHETIC_OTHER_PUBLIC_KEY_123456';Reject {Get-RemainingPlan $rows} 'API_KEY_GROUP_MISMATCH'
$rows=Fixtures;$rows.createSolicitudIq.buildConfig.source.storageSource.generation='changed';Reject {Get-RemainingPlan $rows} 'REMOTE_SOURCE_CHANGED'
$rows=Fixtures;$rows.createSolicitudIq.serviceConfig.secretEnvironmentVariables[0].version='latest';Reject {Get-RemainingPlan $rows} 'SECRET_BINDING_CHANGED'
$rows=Fixtures;$rows.createSolicitudIq.serviceConfig.secretEnvironmentVariables[0].projectId='other';Reject {Get-RemainingPlan $rows} 'SECRET_BINDING_CHANGED'
$rows=Fixtures;$rows.createSolicitudIq.serviceConfig|Add-Member secretVolumes @(@{secret='unexpected'});Reject {Get-RemainingPlan $rows} 'SECRET_BINDING_CHANGED'
$rows=Fixtures;$rows.Remove('createSolicitudIq');Reject {Get-RemainingPlan $rows} 'SNAPSHOT_SCOPE_INVALID'
foreach($name in $script:RemainingNames){
 $rows=Fixtures;$before=$rows[$name];$config=Get-RemainingConfig $before $name;$envMap=Get-RemainingEnv $before $name
 $after=Clone $before;Reject {Assert-RemainingSnapshot $before $after $name $envMap $config $true} 'REVISION_CHANGED'
 $after.serviceConfig.revision='new';$after.buildConfig.source.storageSource.generation='new';Assert-RemainingSnapshot $before $after $name $envMap $config $true;$checks++
 Reject {Assert-RemainingSnapshot $before $after $name $envMap $config $false} 'REVISION_CHANGED'
 foreach($field in @('maxInstanceCount','maxInstanceRequestConcurrency','timeoutSeconds','availableCpu')){$changed=Clone $before;$changed.serviceConfig.$field=999;Reject {Get-RemainingConfig $changed $name} 'RUNTIME_LIMIT_CHANGED'}
 foreach($field in @('minInstanceCount','vpcConnector','vpcConnectorEgressSettings')){$changed=Clone $before;$changed.serviceConfig|Add-Member -NotePropertyName $field -NotePropertyValue 'changed';Reject {Get-RemainingConfig $changed $name} 'NETWORK_IDENTITY_CHANGED'}
}
# The next phase compares the exact successful postflight snapshot, not merely
# a revision different from the original deployment.
$rows=Fixtures;$before=$rows.createClientDispersionIq;$config=Get-RemainingConfig $before 'createClientDispersionIq';$expectedEnv=Get-RemainingEnv $before 'createClientDispersionIq'
$phaseOne=Clone $before;$phaseOne.serviceConfig.revision='phase-one';$phaseOne.buildConfig.source.storageSource.generation='phase-one'
Assert-RemainingSnapshot $before $phaseOne 'createClientDispersionIq' $expectedEnv $config $true;$checks++
Assert-RemainingSnapshot $phaseOne (Clone $phaseOne) 'createClientDispersionIq' $expectedEnv $config $false;$checks++
$intervening=Clone $phaseOne;$intervening.serviceConfig.revision='external-deployment';$intervening.buildConfig.source.storageSource.generation='external-deployment'
Reject {Assert-RemainingSnapshot $phaseOne $intervening 'createClientDispersionIq' $expectedEnv $config $false} 'REVISION_CHANGED'
$intervening=Clone $phaseOne;$intervening.serviceConfig.environmentVariables.PAY0_FIREBASE_WEB_API_KEY='SYNTHETIC_CHANGED_PUBLIC_KEY_1234'
Reject {Assert-RemainingSnapshot $phaseOne $intervening 'createClientDispersionIq' $expectedEnv $config $false} 'CONFIG_CHANGED'
$rows=Fixtures;$timed=$rows.processIqCreateOnDemandTask;$timedConfig=Get-RemainingConfig $timed 'processIqCreateOnDemandTask';$timedEnv=Get-RemainingEnv $timed 'processIqCreateOnDemandTask';$changed=Clone $timed;$changed.serviceConfig.environmentVariables.PAY0_OPERATION_TIMING='0'
Reject {Assert-RemainingSnapshot $timed $changed 'processIqCreateOnDemandTask' $timedEnv $timedConfig $false} 'CONFIG_CHANGED'
foreach($name in @('IQ_CREDENTIALS_KEY','TELEGRAM_BOT_TOKEN')){
 $number=if($name -ceq 'IQ_CREDENTIALS_KEY'){'2'}else{'1'}
 foreach($project in @('pay-0-system','751158244178')){Assert-RemainingSecret ([pscustomobject]@{state='ENABLED';name="projects/$project/secrets/$name/versions/$number"}) $name;$checks++}
 Reject {Assert-RemainingSecret ([pscustomobject]@{state='DISABLED';name="projects/pay-0-system/secrets/$name/versions/$number"}) $name} 'LATEST_SECRET_VERSION_CHANGED'
 Reject {Assert-RemainingSecret ([pscustomobject]@{state='ENABLED';name="projects/pay-0-system/secrets/$name/versions/99"}) $name} 'LATEST_SECRET_VERSION_CHANGED'
}
$jobs=Jobs;$fingerprint=Get-RemainingJobFingerprint $jobs;Check ([bool]$fingerprint) 'jobsFingerprint'
$jobs.syncTodayIqInvoicesNow.state='ENABLED';Reject {Get-RemainingJobFingerprint $jobs} 'SCHEDULER_CHANGED'
$jobs=Jobs;$jobs.processIqCreateQueue.schedule='every 5 minutes';Reject {Get-RemainingJobFingerprint $jobs} 'SCHEDULER_CHANGED'
$jobs=Jobs;$jobs.processIqCreateOnDemandTask.rateLimits.maxConcurrentDispatches=2;Reject {Get-RemainingJobFingerprint $jobs} 'QUEUE_CHANGED'
$jobs=Jobs;$jobs.processIqCreateOnDemandTask.retryConfig.maxAttempts=3;Reject {Get-RemainingJobFingerprint $jobs} 'QUEUE_CHANGED'
$jobs=Jobs;$jobs.processIqCreateQueue|Add-Member retryConfig ([pscustomobject]@{retryCount=2});Check ((Get-RemainingJobFingerprint $jobs) -cne $fingerprint) 'retryDriftFingerprinted'
$dir=Join-Path $repo ('.firebase/iq-remaining-env-tests/'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($dir)|Out-Null
$file=Join-Path $dir 'fixture.env';$original=[Text.Encoding]::UTF8.GetBytes("# exact original`r`nSYNTHETIC=original`r`n");[IO.File]::WriteAllBytes($file,$original)
$script:events=[Collections.Generic.List[string]]::new();$journal={param($state)$script:events.Add($state)};$script:deployCount=0;$script:postCount=0
try{
 $plan=Get-RemainingPlan (Fixtures)
 Reject {Invoke-RemainingPhase 0 $file $original $plan.Envs.processIqCreateOnDemandTask {throw 'MUST_NOT_RUN'} {} $journal} 'PHASE_ENV_INVALID'
 Reject {Invoke-RemainingPhase 1 $file $original $plan.Envs.createSolicitudIq {throw 'MUST_NOT_RUN'} {} $journal} 'PHASE_ENV_INVALID'
 for($phaseIndex=0;$phaseIndex -lt 2;$phaseIndex++){
  $expectedArgs=Get-RemainingArguments $phaseIndex
  $deploy={param([string[]]$parameters)Check (($parameters -join '|') -ceq ($expectedArgs -join '|')) 'exactSelector';$script:deployCount++;return 0}
  $post={Check ((Get-IqHash ([IO.File]::ReadAllBytes($file))) -cne (Get-IqHash $original)) 'stagedAtPostflight';$script:postCount++}
  Invoke-RemainingPhase $phaseIndex $file $original $plan.Envs[$plan.Groups[$phaseIndex][0]] $deploy $post $journal
  Check ((Get-IqHash ([IO.File]::ReadAllBytes($file))) -ceq (Get-IqHash $original)) 'restoredEachPhase'
 }
 Check ($deployCount -eq 2 -and $postCount -eq 2) 'twoPhases'
 Reject {Invoke-RemainingPhase 0 $file $original $plan.Envs.createSolicitudIq {param($p)return 7} {throw 'POST_MUST_NOT_RUN'} $journal} 'FIREBASE_DEPLOY_FAILED'
 Check ((Get-IqHash ([IO.File]::ReadAllBytes($file))) -ceq (Get-IqHash $original)) 'failureRestore'
 Reject {Invoke-RemainingPhase 0 $file $original $plan.Envs.createSolicitudIq {param($p)return 0} {throw 'POST_MISMATCH'} $journal} 'POST_MISMATCH'
 Check ((Get-IqHash ([IO.File]::ReadAllBytes($file))) -ceq (Get-IqHash $original)) 'postflightFailureRestore'
 $external=[Text.Encoding]::UTF8.GetBytes('EXTERNAL=mutation')
 Reject {Invoke-RemainingPhase 0 $file $original $plan.Envs.createSolicitudIq {param($p)[IO.File]::WriteAllBytes($file,$external);return 0} {} $journal} 'LOCAL_ENV_CONFLICT_BACKUP_RETAINED'
 Check ((Get-IqHash ([IO.File]::ReadAllBytes($file))) -ceq (Get-IqHash $external)) 'externalMutationRetained'
 Reject {Invoke-RemainingPhase 0 $file $original $plan.Envs.createSolicitudIq {throw 'MUST_NOT_RUN'} {} $journal} 'LOCAL_ENV_CONFLICT'
 Check ($events.Contains('BEFORE_ENV_CHANGE') -and $events.Contains('RESTORE_CONFLICT_BACKUP_RETAINED')) 'journalEvidence'
}finally{
 $full=[IO.Path]::GetFullPath($dir);$allowed=[IO.Path]::GetFullPath((Join-Path $repo '.firebase/iq-remaining-env-tests'))+[IO.Path]::DirectorySeparatorChar
 if(!$full.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'CLEANUP_SCOPE_INVALID'}
 Remove-Item -LiteralPath $full -Recurse -Force
}
Write-Output "IQ_REMAINING_ENV_FAKE_PASS checks=$checks network=0 deploy=0 realDotenvWrites=0"
