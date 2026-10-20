Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../../services/pay0-sentinel-observation/scripts/verify-runtime-iam.ps1'
$tokens = $null; $parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'POWERSHELL_PARSE_FAILED' }
. $source -LibraryOnly
[Console]::WriteLine('LOCAL_TEST_MODE:FAKE_TRANSPORT_NO_REMOTE_CALLS')
function Assert-Local([bool]$Value, [string]$Code) { if (-not $Value) { throw $Code } }
Add-Type -AssemblyName System.Net.Http
Add-Type -ReferencedAssemblies System.Net.Http -TypeDefinition @'
using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
public sealed class SentinelLocalHttpHandler : HttpMessageHandler {
  public static bool Quota;
  public static int Status = 200;
  protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
    Quota = request.Headers.Contains("x-goog-user-project");
    if (request.Headers.Authorization.Scheme != "Bearer") throw new Exception("LOCAL_AUTH_SCHEME");
    return Task.FromResult(new HttpResponseMessage((HttpStatusCode)Status) { Content = new StringContent("{\"local\":true}") });
  }
}
'@
function New-SentinelHttpTransport {
    $handler = New-Object SentinelLocalHttpHandler
    return [pscustomobject]@{ Handler = $handler; Client = (New-Object System.Net.Http.HttpClient($handler)) }
}
$http = Invoke-SentinelHttp 'POST' 'https://iam.googleapis.com/v1/local-fixture' 'synthetic-token-never-real' @{ local = $true } $true $true
Assert-Local ($http.Status -eq 200 -and $http.Data.local -eq $true -and [SentinelLocalHttpHandler]::Quota) 'REAL_HTTP_ADAPTER_FAKE_HANDLER'
[SentinelLocalHttpHandler]::Status = 403
$http = Invoke-SentinelHttp 'GET' 'https://firestore.googleapis.com/v1/local-fixture' 'synthetic-token-never-real' $null $false $false
Assert-Local ($http.Status -eq 403 -and $null -eq $http.Data -and -not [SentinelLocalHttpHandler]::Quota) 'PROBE_HTTP_NO_BODY_NO_QUOTA'
function Wait-SentinelPropagation { $script:Waits++ }
function Invoke-SentinelHttp([string]$Method, [string]$Uri, [string]$Token, $Body, [bool]$ReadJson, [bool]$QuotaProject) {
    # All remote operations are replaced, including policy mutations and mint.
    Assert-Local ($Uri.StartsWith('https://')) 'HTTPS_REQUIRED'
    $status = 200; $data = $null
    if ($Uri.EndsWith('/roles/sentinelRuntimeVerifier')) {
        $permissions = @('iam.serviceAccounts.getAccessToken'); if ($script:Scenario -eq 'BROAD_ROLE') { $permissions += 'iam.serviceAccounts.signBlob' }
        $data = [pscustomobject]@{ includedPermissions = $permissions }
    } elseif ($Uri.EndsWith(':getIamPolicy')) {
        Assert-Local ($Body.options.requestedPolicyVersion -eq 3) 'POLICY_V3_REQUIRED'
        $data = $script:Policy
    } elseif ($Uri.EndsWith(':setIamPolicy')) {
        $script:Sets++
        Assert-Local ($Body.policy.etag -eq $script:Policy.etag) 'ETAG_REQUIRED'
        Assert-Local ($Body.updateMask -eq 'bindings,etag') 'NARROW_UPDATE_MASK'
        $added = @($Body.policy.bindings | Where-Object { $_.role -eq $script:SentinelRole }).Count -gt 0
        if ($added) {
            $binding = @($Body.policy.bindings | Where-Object { $_.role -eq $script:SentinelRole })[0]
            Assert-Local ($binding.members[0] -eq 'user:operator@example.invalid') 'EXACT_OPERATOR'
            Assert-Local ($binding.condition.expression -match "^request.time < timestamp\('[0-9T:Z-]+'\)$") 'EXPIRY_REQUIRED'
            $stamp = [DateTimeOffset]::Parse(($binding.condition.expression -split "'")[1])
            Assert-Local ($stamp -gt [DateTimeOffset]::UtcNow.AddMinutes(19) -and $stamp -le [DateTimeOffset]::UtcNow.AddMinutes(20)) 'TWENTY_MINUTES'
        }
        if ($script:Scenario -ne 'CLEANUP_UNCONFIRMED' -or $added) {
            $script:Policy = ($Body.policy | ConvertTo-Json -Depth 100) | ConvertFrom-Json
            $script:Policy.etag = 'etag' + $script:Sets
        }
        if ($script:Scenario -eq 'AMBIGUOUS_ADD' -and $script:Sets -eq 1) { $status = 0 }
    } elseif ($Uri.EndsWith(':generateAccessToken')) {
        $script:Mints++
        Assert-Local ($QuotaProject -and $Body.lifetime -eq '600s' -and $Body.scope[0] -eq 'https://www.googleapis.com/auth/cloud-platform') 'MINT_CONTRACT'
        Assert-Local ($Uri.Contains('/projects/-/serviceAccounts/')) 'MINT_WILDCARD_REQUIRED'
        if ($script:Scenario -eq 'MINT_FAIL' -or $script:Mints -lt 5) { $status = 403 }
        else { $data = [pscustomobject]@{ accessToken = 'synthetic-runtime-token-abcdefghijklmn'; expireTime = [DateTimeOffset]::UtcNow.AddSeconds(600).ToString('o') } }
    } elseif ($Uri.Contains('/documents/sentinelIsolationProbes/') -or $Uri.Contains('/o/sentinelIsolationProbes%2F')) {
        $script:Probes++
        Assert-Local ($Method -eq 'GET' -and -not $ReadJson -and -not $QuotaProject) 'SAFE_PROBE_CONTRACT'
        Assert-Local ($Token -eq 'synthetic-runtime-token-abcdefghijklmn') 'RUNTIME_IDENTITY'
        Assert-Local ($Uri -notmatch '__sentinel') 'NON_RESERVED_COLLECTION'
        $status = 403; if ($Uri.Contains('/databases/sentinel-observation/')) { $status = 404 }
    } elseif ($Uri.EndsWith(':beginTransaction')) {
        Assert-Local (-not $QuotaProject -and $ReadJson -and $null -ne $Body.options.readWrite) 'BEGIN_READWRITE_NO_WRITES'
        $data = [pscustomobject]@{ transaction = 'synthetic-transaction' }
    } elseif ($Uri.EndsWith(':rollback')) {
        $script:Rollbacks++
        Assert-Local (-not $QuotaProject -and $Body.transaction -eq 'synthetic-transaction') 'ROLLBACK_CONTRACT'
        if ($script:Scenario -eq 'ROLLBACK_FAIL') { $status = 503 }
    } else { throw 'UNEXPECTED_REMOTE_OPERATION' }
    return [pscustomobject]@{ Status = $status; Data = $data }
}

foreach ($case in @('SUCCESS', 'AMBIGUOUS_ADD', 'MINT_FAIL', 'ROLLBACK_FAIL', 'CLEANUP_UNCONFIRMED', 'BROAD_ROLE')) {
    $script:Scenario = $case; $script:Mints = 0; $script:Waits = 0; $script:Sets = 0; $script:Probes = 0; $script:Rollbacks = 0
    $script:Policy = '{"version":3,"etag":"initial","bindings":[{"role":"roles/viewer","members":["user:unrelated@example.invalid"]}],"auditConfigs":[]}' | ConvertFrom-Json
    $result = Invoke-SentinelVerification 'operator@example.invalid' 'synthetic-operator-token-abcdefghijklmn'
    Assert-Local ($script:Policy.bindings[0].role -eq 'roles/viewer' -and $script:Policy.bindings[0].members[0] -eq 'user:unrelated@example.invalid') 'UNRELATED_BINDING_PRESERVED'
    Assert-Local ($result.ProbesPassed -eq ($case -in @('SUCCESS', 'AMBIGUOUS_ADD', 'CLEANUP_UNCONFIRMED'))) 'PROBE_RESULT_CONTRACT'
    Assert-Local ($result.CleanupVerified -eq ($case -ne 'CLEANUP_UNCONFIRMED')) 'CLEANUP_RESULT_CONTRACT'
    if ($case -eq 'MINT_FAIL') { Assert-Local ($script:Mints -eq 7 -and $script:Waits -eq 6 -and $script:Probes -eq 0) 'BOUNDED_PROPAGATION' }
    if ($case -eq 'SUCCESS') { Assert-Local ($script:Mints -eq 5 -and $script:Waits -eq 4 -and $script:Probes -eq 4 -and $script:Rollbacks -eq 1) 'SUCCESS_MATRIX' }
    if ($case -eq 'BROAD_ROLE') { Assert-Local ($script:Sets -eq 0) 'NO_ROLE_EXPANSION' }
}

$condition = [pscustomobject]@{ title = 'unique'; expression = 'exact'; description = 'exact' }
$policy = [pscustomobject]@{ version = 3; etag = 'e'; bindings = @(
    [pscustomobject]@{ role = $script:SentinelRole; condition = $condition; members = @('user:operator@example.invalid', 'user:other@example.invalid') },
    [pscustomobject]@{ role = $script:SentinelRole; condition = [pscustomobject]@{title='other';expression='other';description='other'}; members = @('user:operator@example.invalid') }
) }
$cleaned = New-SentinelPolicy $policy 'user:operator@example.invalid' $condition $true
Assert-Local ($cleaned.bindings.Count -eq 2 -and $cleaned.bindings[0].members.Count -eq 1 -and $cleaned.bindings[0].members[0] -eq 'user:other@example.invalid' -and $cleaned.bindings[1].members[0] -eq 'user:operator@example.invalid') 'EXACT_CLEANUP_ONLY'
$added = New-SentinelPolicy $policy 'user:operator@example.invalid' $condition $false
Assert-Local ($added.bindings.Count -eq 2 -and @($added.bindings | Where-Object { (Test-SentinelCondition $_ $condition) -and $_.members.Count -eq 2 }).Count -eq 1) 'MERGE_CONCURRENT_MEMBER_NO_DUPLICATE_BINDING'
[Console]::WriteLine('LOCAL_RUNTIME_IAM_CONTRACT:PASS_10_CASES_NO_REMOTE_CALLS')
