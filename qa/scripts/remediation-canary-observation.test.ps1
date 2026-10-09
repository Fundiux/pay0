Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../../services/pay0-sentinel-observation/scripts/run-canary-observation.ps1'
$tokens=$null; $errors=$null
[void][Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'PARSE_FAILED' }
. $source -LibraryOnly -Execute
function Assert-Local([bool]$Value,[string]$Code) { if (-not $Value) { throw $Code } }
Assert-Local ([bool]$Execute -and [bool]$LibraryOnly) 'IMPORT_PRESERVES_CALLER_FLAGS_WITHOUT_EXECUTION'
function Wait-CanaryPropagation { $script:Waits++ }
function Invoke-CanaryGcloud([string[]]$Arguments) {
 Assert-Local (($Arguments -join ' ') -eq 'logging sinks describe pay0-sentinel-observe-v1 --project=pay-0-system --account=operator@example.invalid --format=json --quiet') 'FIXED_SINK_READ'
 $script:SinkReads++
 $filter=Get-ObservationFilter $script:Revision
 $destination='pubsub.googleapis.com/projects/pay0-sentinel-observe/topics/pay0-security-observe-v1'
 $disabled=$script:RequestedMode -eq 'CANARY_DRY_RUN'
 if ($script:Case -eq 'BROAD_FILTER') { $filter+=' OR severity>=DEFAULT' }
 if ($script:Case -eq 'WRONG_ROOT') { $filter=$filter.Replace('canary-observation-root','other-root') }
 if ($script:Case -eq 'WRONG_REVISION_FILTER') { $filter=$filter.Replace($script:Revision,'pay0-security-canary-99999-zzz') }
 if ($script:Case -eq 'WRONG_DESTINATION') { $destination+='_other' }
 if ($script:Case -eq 'WRONG_SINK_MODE' -or ($script:Case -eq 'SINK_CHANGED' -and $script:SinkReads -gt 2)) { $disabled=-not $disabled }
 $sink=@{name='pay0-sentinel-observe-v1';filter=$filter;destination=$destination;disabled=$disabled}
 if ($script:Case -eq 'EXCLUSIONS') { $sink.exclusions=@(@{name='skip';filter='true'}) }
 return [pscustomobject]@{Status=0;Text=($sink | ConvertTo-Json -Depth 5 -Compress)}
}
function Invoke-CanaryHttp([string]$Method,[string]$Uri,[string]$Token,$Body,[bool]$ReadJson,[bool]$QuotaProject) {
 $status=200; $data=$null
 if ($Uri -eq $script:CanaryRunBase) {
  $full='projects/pay-0-system/locations/us-central1/services/pay0-security-canary/revisions/'+$script:Revision
  $trafficRevision=$script:Revision
  if ($script:Case -eq 'WRONG_TRAFFIC') { $trafficRevision='pay0-security-canary-99999-zzz' }
  $data=@{uri=$script:CanaryAllowedUrls[0];latestReadyRevision=$full;latestCreatedRevision=$full;trafficStatuses=@(@{revision=$trafficRevision;percent=100})}
 } elseif ($Uri.Contains('/revisions/')) {
  $mode=$script:RequestedMode
  if ($script:Case -eq 'WRONG_MODE') { $mode='DISABLED' }
  $data=@{serviceAccount=$script:CanaryAccount;containers=@(@{env=@(@{name='OBSERVATION_PUBLISHER_MODE';value=$mode},@{name='PAY0_SOURCE_PROJECT_ID';value='pay-0-system'})})}
 } elseif ($Uri.EndsWith('/roles/canaryRuntimeVerifier')) {
  $perms=@('iam.serviceAccounts.getAccessToken','iam.serviceAccounts.getOpenIdToken')
  if ($script:Case -eq 'BROAD_ROLE') { $perms+='iam.serviceAccounts.signBlob' }
  $data=@{includedPermissions=$perms}
 } elseif ($Uri.Contains(':getIamPolicy')) {
  $key='SA'; if ($Uri.StartsWith('https://run.')) { $key='RUN' }
  $data=$script:Policies[$key]
 } elseif ($Uri.EndsWith(':setIamPolicy')) {
  $script:Sets++
  $key='SA'; if ($Uri.StartsWith('https://run.')) { $key='RUN' }
  Assert-Local ($Body.policy.etag -eq $script:Policies[$key].etag -and $Body.updateMask -eq 'bindings,etag') 'ETAG_PRESERVED'
  $adding=$Body.policy.bindings.Count -gt 1
  if ($adding) {
   $binding=$Body.policy.bindings[1]
   $stamp=[DateTimeOffset]::Parse(($binding.condition.expression -split "'")[1])
   Assert-Local ($stamp -gt [DateTimeOffset]::UtcNow.AddMinutes(19) -and $stamp -le [DateTimeOffset]::UtcNow.AddMinutes(20)) 'TTL20'
   if ($key -eq 'RUN') { Assert-Local ($binding.role -eq 'roles/run.invoker' -and $binding.members[0] -eq ('serviceAccount:'+$script:CanaryAccount)) 'EXACT_RUN_BINDING' }
   else { Assert-Local ($binding.role -eq $script:CanaryRole -and $binding.members[0] -eq 'user:operator@example.invalid') 'EXACT_SA_BINDING' }
  }
  if ($script:Case -ne 'CLEANUP_FAIL' -or $key -ne 'RUN' -or $adding) {
   $script:Policies[$key]=($Body.policy | ConvertTo-Json -Depth 30) | ConvertFrom-Json
   $script:Policies[$key].etag='e'+$script:Sets
  }
  if ($script:Case -eq 'AMBIGUOUS_BINDING' -and $script:Sets -eq 1) { $status=0 }
 } elseif ($Uri.EndsWith(':generateIdToken')) {
  $script:Mints++
  Assert-Local ($QuotaProject -and $Body.audience -eq $script:CanaryUrl -and $Body.includeEmail) 'FIXED_ID_AUDIENCE'
  if ($script:Case -eq 'MINT_FAIL') { $status=403 }
  $claims=@{aud=$script:CanaryUrl;email=$script:CanaryAccount;iss='https://accounts.google.com';exp=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()+3600} | ConvertTo-Json -Compress
  $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($claims)).TrimEnd('=').Replace('+','-').Replace('/','_')
  $data=@{token='e30.'+$encoded+'.fakeSignature'}
 } elseif ($Uri.EndsWith('/canary')) {
  $script:Posts++
  Assert-Local ($Method -eq 'POST' -and $null -eq $Body -and $ReadJson -and -not $QuotaProject -and $Token.StartsWith('e30.')) 'EMPTY_POST_NO_CALLER_DATA'
  $code='LOGGING_ACCEPTED'; if ($script:RequestedMode -eq 'CANARY_DRY_RUN') { $code='LOGGING_DRY_RUN_ACCEPTED' }
  if ($script:Case -eq 'WRONG_CODE') { $code='PUBLISHER_DISABLED' }
  if ($script:Case -eq 'AMBIGUOUS_POST') { $status=0 }
  if ($script:Case -eq 'POST403') { $status=403 }
  $data=@{code=$code}
 } else { throw 'UNEXPECTED_OPERATION_OR_ACCESS_MINT' }
 # Match the JSON object shape returned by the real helper, never hashtable semantics.
 if ($null -ne $data) { $data=($data | ConvertTo-Json -Depth 30) | ConvertFrom-Json }
 return [pscustomobject]@{Status=$status;Data=$data}
}
$cases=@('DRY','CANARY','BROAD_FILTER','WRONG_ROOT','WRONG_REVISION_FILTER','WRONG_DESTINATION','WRONG_SINK_MODE','EXCLUSIONS','WRONG_MODE','WRONG_TRAFFIC','BROAD_ROLE','MINT_FAIL','AMBIGUOUS_BINDING','AMBIGUOUS_POST','POST403','WRONG_CODE','SINK_CHANGED','CLEANUP_FAIL')
foreach ($case in $cases) {
 $script:Case=$case; $script:RequestedMode='CANARY'; $limit=2
 if ($case -eq 'DRY') { $script:RequestedMode='CANARY_DRY_RUN'; $limit=1 }
 $script:Revision='pay0-security-canary-00002-abc'
 $script:Waits=0; $script:Sets=0; $script:SinkReads=0; $script:Posts=0; $script:Mints=0
 $script:Policies=@{}
 foreach ($key in @('SA','RUN')) { $script:Policies[$key]='{"version":3,"etag":"initial","bindings":[{"role":"roles/viewer","members":["user:unrelated@example.invalid"]}]}' | ConvertFrom-Json }
 $result=Invoke-ObservationRun 'operator@example.invalid' 'synthetic-operator-token' $script:RequestedMode $script:Revision $limit
 Assert-Local ($result.Accepted -eq ($case -in @('DRY','CANARY','AMBIGUOUS_BINDING','CLEANUP_FAIL'))) ('RESULT_'+$case)
 Assert-Local ($result.CleanupVerified -eq ($case -ne 'CLEANUP_FAIL')) ('CLEANUP_'+$case)
 Assert-Local ($result.PostsAttempted -eq $script:Posts -and $script:Posts -le $limit) 'ABSOLUTE_POST_BOUND'
 foreach ($key in @('SA','RUN')) {
  Assert-Local ($script:Policies[$key].bindings[0].role -eq 'roles/viewer') 'UNRELATED_PRESERVED'
  if ($key -ne 'RUN' -or $case -ne 'CLEANUP_FAIL') { Assert-Local ($script:Policies[$key].bindings.Count -eq 1) 'CLEANUP_VERIFIED' }
 }
 if ($case -in @('BROAD_FILTER','WRONG_ROOT','WRONG_REVISION_FILTER','WRONG_DESTINATION','WRONG_SINK_MODE','EXCLUSIONS','WRONG_MODE','WRONG_TRAFFIC','BROAD_ROLE')) { Assert-Local ($script:Posts -eq 0 -and $script:Sets -eq 0) 'PREFLIGHT_NO_MUTATION' }
 if ($case -eq 'MINT_FAIL') { Assert-Local ($script:Mints -eq 7 -and $script:Waits -eq 6 -and $script:Posts -eq 0) 'BOUNDED_MINT' }
 if ($case -in @('AMBIGUOUS_POST','POST403','WRONG_CODE','SINK_CHANGED')) { Assert-Local ($script:Posts -eq 1) 'NO_POST_RETRY' }
 if ($case -eq 'CANARY') { Assert-Local ($script:Posts -eq 2 -and $script:SinkReads -eq 3) 'RECHECK_EACH_POST' }
}
foreach ($argsCase in @(@('CANARY_DRY_RUN','pay0-security-canary-00002-abc',2),@('CANARY','pay0-security-canary-00002-abc',3),@('CANARY','anything',1),@('DISABLED','pay0-security-canary-00002-abc',1))) {
 $rejected=$false
 try { $null=Invoke-ObservationRun 'operator@example.invalid' 'fake' $argsCase[0] $argsCase[1] $argsCase[2] } catch { $rejected=$true }
 Assert-Local $rejected 'INVALID_ARGUMENTS_REJECTED'
}
[Console]::WriteLine('LOCAL_CANARY_OBSERVATION:PASS_23_CASES_NO_REMOTE_CALLS')
