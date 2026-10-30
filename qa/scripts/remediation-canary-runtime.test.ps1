Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../../services/pay0-sentinel-observation/scripts/verify-canary-runtime.ps1'
$tokens=$null; $parseErrors=$null
[void][Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'PARSE_FAILED' }
. $source -LibraryOnly
function Assert-Local([bool]$Value,[string]$Code) { if (-not $Value) { throw $Code } }
Add-Type -AssemblyName System.Net.Http
Add-Type -ReferencedAssemblies System.Net.Http -TypeDefinition @'
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
public sealed class CanaryFakeHandler:HttpMessageHandler {
 public static int Status=503;
 public static bool Quota;
 protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken) {
  Quota=request.Headers.Contains("x-goog-user-project");
  return Task.FromResult(new HttpResponseMessage((HttpStatusCode)Status){Content=new StringContent("{\"code\":\"PUBLISHER_DISABLED\"}")});
 }
}
'@
function New-CanaryHttpTransport {
 $handler=New-Object CanaryFakeHandler
 return [pscustomobject]@{Handler=$handler;Client=(New-Object Net.Http.HttpClient($handler))}
}
$script:CanaryUrl='https://pay0-security-canary-local.run.app'
$r=Invoke-CanaryHttp 'POST' ($script:CanaryUrl+'/canary') 'fake-only-token' $null $true $false
Assert-Local ($r.Status -eq 503 -and $r.Data.code -eq 'PUBLISHER_DISABLED' -and -not [CanaryFakeHandler]::Quota) 'REAL_ADAPTER_503_CODE'
[CanaryFakeHandler]::Status=200
$r=Invoke-CanaryHttp 'GET' 'https://firestore.googleapis.com/v1/fake' 'fake-only-token' $null $false $false
Assert-Local ($r.Status -eq 200 -and $null -eq $r.Data) 'FINANCIAL_BODY_NEVER_READ'
$r=Invoke-CanaryHttp 'POST' 'https://untrusted.invalid/canary' 'fake-only-token' $null $true $false
Assert-Local ($r.Status -eq 0) 'HOST_ALLOWLIST'
function Wait-CanaryPropagation { $script:Waits++ }
function Invoke-CanaryHttp([string]$Method,[string]$Uri,[string]$Token,$Body,[bool]$ReadJson,[bool]$QuotaProject) {
 $data=$null; $status=200
 if ($Uri -eq $script:CanaryRunBase) {
  $script:ServiceReads++
  $revision=$script:CanaryRevision
  if ($script:Case -eq 'REVISION_CHANGED' -and $script:ServiceReads -gt 1) { $revision+='changed' }
  $uri=$script:CanaryAllowedUrls[0]
  if ($script:Case -eq 'SECOND_URL') { $uri=$script:CanaryAllowedUrls[1] }
  if ($script:Case -eq 'EVIL_URL') { $uri=$script:CanaryAllowedUrls[0]+'.evil.invalid' }
  $trafficRevision=$script:CanaryRevisionId
  if ($script:Case -eq 'WRONG_TRAFFIC') { $trafficRevision+='other' }
  $data=[pscustomobject]@{uri=$uri;latestReadyRevision=$revision;latestCreatedRevision=$revision;trafficStatuses=@([pscustomobject]@{revision=$trafficRevision;percent=100})}
 } elseif ($Uri -eq ('https://run.googleapis.com/v2/'+$script:CanaryRevision)) {
  $mode='DISABLED'; if ($script:Case -eq 'ENABLED') { $mode='CANARY' }
  $data=[pscustomobject]@{serviceAccount=$script:CanaryAccount;containers=@([pscustomobject]@{env=@([pscustomobject]@{name='OBSERVATION_PUBLISHER_MODE';value=$mode})})}
 } elseif ($Uri.EndsWith('/roles/canaryRuntimeVerifier')) {
  $perms=@('iam.serviceAccounts.getAccessToken','iam.serviceAccounts.getOpenIdToken')
  if ($script:Case -eq 'BROAD_ROLE') { $perms+='iam.serviceAccounts.signBlob' }
  $data=[pscustomobject]@{includedPermissions=$perms}
 } elseif ($Uri.Contains(':getIamPolicy')) {
  $key='SA'; if ($Uri.StartsWith('https://run.')) { $key='RUN'; Assert-Local ($Method -eq 'GET' -and $Uri.EndsWith('?options.requestedPolicyVersion=3')) 'RUN_POLICY_GET' }
  else { Assert-Local ($Method -eq 'POST' -and $Body.options.requestedPolicyVersion -eq 3) 'SA_POLICY_GET' }
  $data=$script:Policies[$key]
 } elseif ($Uri.EndsWith(':setIamPolicy')) {
  $key='SA'; if ($Uri.StartsWith('https://run.')) { $key='RUN' }
  $script:Sets++
  Assert-Local ($Body.policy.etag -eq $script:Policies[$key].etag -and $Body.updateMask -eq 'bindings,etag') 'ETAG_NARROW_MASK'
  $temp=@($Body.policy.bindings | Where-Object { (Get-CanaryProperty $_ 'role') -ne 'roles/viewer' })
  $adding=$temp.Count -gt 0
  if ($adding) {
   $binding=$temp[0]
   $stamp=[DateTimeOffset]::Parse(($binding.condition.expression -split "'")[1])
   Assert-Local ($stamp -gt [DateTimeOffset]::UtcNow.AddMinutes(19) -and $stamp -le [DateTimeOffset]::UtcNow.AddMinutes(20)) 'BINDING_TTL'
   if ($key -eq 'SA') { Assert-Local ($binding.role -eq $script:CanaryRole -and $binding.members[0] -eq 'user:operator@example.invalid') 'SA_MEMBER_ROLE' }
   else { Assert-Local ($binding.role -eq 'roles/run.invoker' -and $binding.members[0] -eq ('serviceAccount:'+$script:CanaryAccount)) 'RUN_MEMBER_ROLE' }
  }
  if ($script:Case -eq 'SECOND_ADD_DENIED' -and $key -eq 'RUN' -and $adding) { return [pscustomobject]@{Status=403;Data=$null} }
  if ($script:Case -ne 'RUN_CLEANUP_FAIL' -or $key -ne 'RUN' -or $adding) {
   $script:Policies[$key]=($Body.policy | ConvertTo-Json -Depth 30) | ConvertFrom-Json
   $script:Policies[$key].etag='etag'+$script:Sets
  }
  if ($script:Case -eq 'AMBIGUOUS_ADD' -and $script:Sets -eq 1) { $status=0 }
 } elseif ($Uri.EndsWith(':generateAccessToken')) {
  $script:AccessMints++
  Assert-Local ($Body.lifetime -eq '600s' -and $QuotaProject) 'ACCESS_LIFETIME'
  if ($script:Case -eq 'MINT_FAIL' -or $script:AccessMints -lt 3) { $status=403 }
  else { $data=[pscustomobject]@{accessToken='synthetic-access-token-abcdefghijklmn';expireTime=[DateTimeOffset]::UtcNow.AddSeconds(600).ToString('o')} }
 } elseif ($Uri.EndsWith(':generateIdToken')) {
  Assert-Local ($Body.audience -eq $script:CanaryUrl -and $Body.includeEmail -eq $true -and -not $Body.ContainsKey('lifetime')) 'ID_PROVIDER_LIFETIME'
  $aud=$script:CanaryUrl; if ($script:Case -eq 'BAD_AUDIENCE') { $aud='https://wrong.invalid' }
  $claims=@{aud=$aud;email=$script:CanaryAccount;iss='https://accounts.google.com';exp=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()+3600} | ConvertTo-Json -Compress
  $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($claims)).TrimEnd('=').Replace('+','-').Replace('/','_')
  $data=[pscustomobject]@{token='e30.'+$encoded+'.fakeSignature'}
 } elseif ($Uri.EndsWith('/canary')) {
  $script:Posts++
  Assert-Local ($Method -eq 'POST' -and $null -eq $Body -and $ReadJson -and -not $QuotaProject -and $Token.StartsWith('e30.')) 'EMPTY_AUTH_POST'
  $status=503; $code='PUBLISHER_DISABLED'
  if ($script:Case -eq 'POST_PROPAGATION' -and $script:Posts -lt 3) { $status=403 }
  if ($script:Case -eq 'WRONG_503') { $code='UPSTREAM_ERROR' }
  $data=[pscustomobject]@{code=$code}
 } elseif ($Uri.Contains('/documents/sentinelIsolationProbes/') -or $Uri.Contains('/o/sentinelIsolationProbes%2F')) {
  $script:Probes++
  Assert-Local ($Method -eq 'GET' -and -not $ReadJson -and -not $QuotaProject -and $Token -eq 'synthetic-access-token-abcdefghijklmn') 'NEGATIVE_PROBE'
  $status=403
  if ($script:Case -eq 'NEGATIVE_404' -and $Uri.Contains('/databases/sentinel-observation/')) { $status=404 }
 } else { throw 'UNEXPECTED_OPERATION' }
 return [pscustomobject]@{Status=$status;Data=$data}
}
$cases=@('SUCCESS','SECOND_URL','EVIL_URL','WRONG_TRAFFIC','AMBIGUOUS_ADD','POST_PROPAGATION','MINT_FAIL','BAD_AUDIENCE','ENABLED','BROAD_ROLE','REVISION_CHANGED','SECOND_ADD_DENIED','RUN_CLEANUP_FAIL','WRONG_503','NEGATIVE_404')
foreach ($case in $cases) {
 $script:Case=$case; $script:Waits=0; $script:Sets=0; $script:Posts=0; $script:Probes=0; $script:AccessMints=0; $script:ServiceReads=0
 $script:Policies=@{}
 foreach ($key in @('SA','RUN')) { $script:Policies[$key]='{"version":3,"etag":"initial","bindings":[{"role":"roles/viewer","members":["user:unrelated@example.invalid"]}]}' | ConvertFrom-Json }
 $result=Invoke-CanaryVerification 'operator@example.invalid' 'fake-operator-token'
 Assert-Local ($result.ProbesPassed -eq ($case -in @('SUCCESS','SECOND_URL','AMBIGUOUS_ADD','POST_PROPAGATION','RUN_CLEANUP_FAIL'))) ('PROBE_RESULT_'+$case)
 Assert-Local ($result.CleanupVerified -eq ($case -ne 'RUN_CLEANUP_FAIL')) ('CLEANUP_RESULT_'+$case)
 foreach ($key in @('SA','RUN')) {
  Assert-Local ($script:Policies[$key].bindings[0].role -eq 'roles/viewer') 'PRESERVE_UNRELATED'
  if ($key -ne 'RUN' -or $case -ne 'RUN_CLEANUP_FAIL') { Assert-Local ($script:Policies[$key].bindings.Count -eq 1) 'EXACT_CLEANUP' }
 }
 if ($case -in @('ENABLED','BROAD_ROLE','EVIL_URL','WRONG_TRAFFIC')) { Assert-Local ($script:Sets -eq 0 -and $script:Posts -eq 0) 'PREFLIGHT_NO_MUTATION' }
 if ($case -eq 'REVISION_CHANGED') { Assert-Local ($script:Posts -eq 0) 'ROLLOUT_NO_POST' }
 if ($case -eq 'MINT_FAIL') { Assert-Local ($script:AccessMints -eq 7 -and $script:Waits -eq 6 -and $script:Posts -eq 0) 'BOUNDED_RETRY' }
 if ($case -eq 'POST_PROPAGATION') { Assert-Local ($script:Posts -eq 3 -and $script:ServiceReads -eq 4) 'RECHECK_EVERY_POST' }
 if ($case -eq 'SUCCESS') { Assert-Local ($script:Posts -eq 1 -and $script:Probes -eq 3) 'SUCCESS_MATRIX' }
}
$condition=[pscustomobject]@{title='unique';description='exact';expression='exact'}
$policy=[pscustomobject]@{etag='test';version=3;bindings=@(
 [pscustomobject]@{role=$script:CanaryRole;condition=$condition;members=@('user:operator@example.invalid','user:concurrent@example.invalid')},
 [pscustomobject]@{role=$script:CanaryRole;condition=[pscustomobject]@{title='other';description='exact';expression='exact'};members=@('user:operator@example.invalid')}
)}
$cleaned=New-CanaryPolicy $policy 'user:operator@example.invalid' $condition $true
Assert-Local ($cleaned.bindings.Count -eq 2 -and $cleaned.bindings[0].members.Count -eq 1 -and $cleaned.bindings[0].members[0] -eq 'user:concurrent@example.invalid' -and $cleaned.bindings[1].members[0] -eq 'user:operator@example.invalid') 'EXACT_MEMBER_CONDITION_CLEANUP'
$policy.bindings[0].condition=[pscustomobject]@{title='unique';description='exact';expression='concurrent-change'}
$script:Policies['SA']=$policy
$target=[pscustomobject]@{Kind='SA';Base=$script:CanarySaBase;Role=$script:CanaryRole;Member='user:operator@example.invalid'}
Assert-Local (-not (Test-CanaryTargetBinding $target 'fake-only-token' $condition $true)) 'CONCURRENT_CONDITION_FAILS_CLEANUP_CERTIFICATION'
[Console]::WriteLine('LOCAL_CANARY_RUNTIME:PASS_20_CASES_NO_REMOTE_CALLS')
