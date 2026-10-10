$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $repo 'scripts/resume-iq-deposit-on-demand.ps1') -LibraryOnly
$checks=0
function Check([bool]$Value,[string]$Name){if(!$Value){throw "TEST_FAILED:$Name"};$script:checks++}
function Reject([scriptblock]$Action,[string]$Expected){try{&$Action;throw 'MISSING_REJECTION'}catch{if($_.Exception.Message -notlike "*$Expected*"){throw}};$script:checks++}
function Fixtures {
 $rows=@{}
 foreach($name in $script:IqNames){$on=$name -eq $script:IqResumeName;$envs=@{PAY0_FIREBASE_WEB_API_KEY='SYNTHETIC_PUBLIC_KEY_123456789'};if(!$on){$envs.PAY0_OPERATION_TIMING='1'}
 $rows[$name]=@{state='ACTIVE';buildConfig=@{source=@{storageSource=@{generation=$script:IqResumePins[$name][1]}}};serviceConfig=@{revision=$script:IqResumePins[$name][0];environmentVariables=$envs;timeoutSeconds=540;availableMemory='2Gi';availableCpu='1';minInstanceCount=$null;ingressSettings='ALLOW_ALL';vpcConnector=$null;vpcConnectorEgressSettings=$null;maxInstanceCount=$(if($on){1}else{20});maxInstanceRequestConcurrency=$(if($on){1}else{80});serviceAccountEmail='751158244178-compute@developer.gserviceaccount.com';secretEnvironmentVariables=@(@{key='IQ_CREDENTIALS_KEY';secret='IQ_CREDENTIALS_KEY';version='2'},@{key='TELEGRAM_BOT_TOKEN';secret='TELEGRAM_BOT_TOKEN';version='1'})}}|ConvertTo-Json -Depth 12|ConvertFrom-Json
 };return $rows
}
$rows=Fixtures;$plan=Get-IqResumePlan $rows
Check ($plan.Selector -ceq 'functions:processIqPagoDepositOnDemandTask') 'singleSelector'
Check (!$plan.PreservationCertified -and $plan.Drift -ceq 'GROUP1_AUTOMATIC_MAX20_OPEN') 'driftOpen'
Check (!$plan.Envs[$script:IqResumeName].ContainsKey('PAY0_OPERATION_TIMING')) 'timingAbsent'
$config=Get-IqResumeConfig $rows[$script:IqResumeName]
Check ($config.Contains('"vpcConnector":null') -and $config.Contains('"minInstanceCount":null')) 'namedNullPreserved'
foreach($name in $script:IqNames){
 $r=Fixtures;$r[$name].serviceConfig.revision='wrong';Reject {Get-IqResumePlan $r} 'REMOTE_SOURCE_CHANGED'
 $r=Fixtures;$r[$name].state='DEPLOYING';Reject {Get-IqResumePlan $r} 'ENDPOINT_NOT_ACTIVE'
 $r=Fixtures;$r[$name].serviceConfig.maxInstanceCount=99;Reject {Get-IqResumePlan $r} 'RUNTIME_LIMIT_CHANGED'
 $r=Fixtures;$r[$name].serviceConfig.secretEnvironmentVariables[0].version='99';Reject {Get-IqResumePlan $r} 'SECRET_BINDING_CHANGED'
}
$r=Fixtures;$r[$script:IqResumeName].serviceConfig.environmentVariables|Add-Member PAY0_OPERATION_TIMING '1';Reject {Get-IqResumePlan $r} 'ONDEMAND_TIMING_CHANGED'
$r=Fixtures;$r[$script:IqNames[0]].serviceConfig.environmentVariables.PAY0_OPERATION_TIMING='0';Reject {Get-IqResumePlan $r} 'GROUP1_TIMING_CHANGED'
$r=Fixtures;$r[$script:IqResumeName].serviceConfig.environmentVariables.PAY0_FIREBASE_WEB_API_KEY='SYNTHETIC_OTHER_KEY_123456789';Reject {Get-IqResumePlan $r} 'API_KEY_GROUP_MISMATCH'
$before=$rows[$script:IqResumeName];$after=$before|ConvertTo-Json -Depth 12|ConvertFrom-Json
$after.serviceConfig.revision='processiqpagodepositondemandtask-00035-fake';$after.buildConfig.source.storageSource.generation='999999'
Assert-IqResumeSnapshot $before $after $plan.Envs[$script:IqResumeName] $plan.Configs[$script:IqResumeName] $true;$checks++
Reject {Assert-IqResumeSnapshot $before $after $plan.Envs[$script:IqResumeName] $plan.Configs[$script:IqResumeName] $false} 'REVISION_POSTFLIGHT_FAILED'
foreach($field in @('timeoutSeconds','availableMemory','availableCpu','minInstanceCount','ingressSettings','vpcConnector','vpcConnectorEgressSettings','maxInstanceCount','maxInstanceRequestConcurrency','serviceAccountEmail')){
 $changed=$after|ConvertTo-Json -Depth 12|ConvertFrom-Json;$changed.serviceConfig.$field='CHANGED'
 Reject {Assert-IqResumeSnapshot $before $changed $plan.Envs[$script:IqResumeName] $plan.Configs[$script:IqResumeName] $true} 'CONFIG_POSTFLIGHT_FAILED'
}
$dir=Join-Path $repo ('.firebase/iq-resume-tests/'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($dir)|Out-Null
$target=Join-Path $dir 'fixture.env';$original=[Text.Encoding]::UTF8.GetBytes("# synthetic bytes`r`nSYNTHETIC=fixture`r`n");$hash=Get-IqHash $original
$script:events=[Collections.Generic.List[string]]::new();$journal={param($state)$script:events.Add($state)}
try {
 [IO.File]::WriteAllBytes($target,$original);Save-IqResumeBackup $dir $original
 Check ((Get-IqHash ([IO.File]::ReadAllBytes((Join-Path $dir 'original.env')))) -ceq $hash) 'backupExact'
 Reject {Save-IqResumeBackup $dir $original} 'already exists'
 $script:deploys=0;$deploy={param([string[]]$arguments)$script:deploys++;Check (($arguments -join '|') -ceq ((Get-IqResumeArguments) -join '|')) 'exactArgs';Check (($arguments|Where-Object{$_ -like 'functions:*'}).Count -eq 1) 'noGroup1';return [int]0}
 Invoke-IqResumePhase $target $original $plan $deploy {} $journal
 Check ($script:deploys -eq 1) 'once';Check ((Get-IqHash ([IO.File]::ReadAllBytes($target))) -ceq $hash) 'restoredSuccess'
 Check ($events.Contains('ONDEMAND_POSTFLIGHT_PASS_GROUP1_DRIFT_OPEN') -and $events[$events.Count-1] -ceq 'ENV_RESTORED') 'journalOrder'
 Reject {Invoke-IqResumePhase $target $original $plan {return [int]1} {} $journal} 'FIREBASE_DEPLOY_FAILED'
 Check ((Get-IqHash ([IO.File]::ReadAllBytes($target))) -ceq $hash) 'restoredFailure'
 Reject {Invoke-IqResumePhase $target $original $plan {return [int]0} {throw 'SYNTHETIC_POSTFLIGHT_DRIFT'} $journal} 'SYNTHETIC_POSTFLIGHT_DRIFT'
 Check ((Get-IqHash ([IO.File]::ReadAllBytes($target))) -ceq $hash) 'restoredPostflightFailure'
 $bad=@{Selector='functions:processIqPagoDepositAutomaticTask';Envs=$plan.Envs}
 Reject {Invoke-IqResumePhase $target $original $bad $deploy {} $journal} 'SELECTOR_INVALID'
 Check ($script:deploys -eq 1) 'noRetryOrWrongSelector'
}finally{if([IO.Path]::GetFullPath($dir).StartsWith((Join-Path $repo '.firebase/iq-resume-tests/'))){Remove-Item -LiteralPath $dir -Recurse -Force}}
Write-Output "PASS IQ_ONDEMAND_RESUME_LOCAL checks=$checks remoteCalls=0"
