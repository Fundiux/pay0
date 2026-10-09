[CmdletBinding()]
param([switch]$Execute, [switch]$LibraryOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$script:SentinelLogPath = $null
$script:SentinelProject = 'pay0-sentinel-observe'
$script:SentinelAccount = 'pay0-sentinel-observer@pay0-sentinel-observe.iam.gserviceaccount.com'
$script:SentinelRole = 'projects/pay0-sentinel-observe/roles/sentinelRuntimeVerifier'
$script:SentinelIamBase = 'https://iam.googleapis.com/v1/projects/-/serviceAccounts/' + $script:SentinelAccount

function Write-SentinelStatus([string]$Stage, [string]$Status) {
    if ($Stage -cnotmatch '^[A-Z0-9_]+$' -or $Status -cnotmatch '^[A-Z0-9_]+$') { throw 'INVALID_STATUS' }
    $line = $Stage + ':' + $Status
    [Console]::WriteLine($line)
    if ($script:SentinelLogPath) {
        try { Add-Content -LiteralPath $script:SentinelLogPath -Value $line -Encoding Ascii }
        catch { [Console]::WriteLine('LOCAL_LOG:WRITE_FAILED') }
    }
}
function Get-SentinelProperty($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}
function Test-SentinelCondition($Binding, $Condition) {
    $actual = Get-SentinelProperty $Binding 'condition'
    return ((Get-SentinelProperty $Binding 'role') -ceq $script:SentinelRole -and
        (Get-SentinelProperty $actual 'title') -ceq $Condition.title -and
        (Get-SentinelProperty $actual 'expression') -ceq $Condition.expression -and
        (Get-SentinelProperty $actual 'description') -ceq $Condition.description)
}
function Test-SentinelBinding($Policy, [string]$Member, $Condition) {
    foreach ($binding in @(Get-SentinelProperty $Policy 'bindings')) {
        if ((Test-SentinelCondition $binding $Condition) -and @(Get-SentinelProperty $binding 'members') -contains $Member) { return $true }
    }
    return $false
}
function New-SentinelPolicy($Policy, [string]$Member, $Condition, [bool]$Remove) {
    # Clone without printing or saving policy. Preserve etag/other bindings/fields.
    if (-not (Get-SentinelProperty $Policy 'etag')) { throw 'POLICY_ETAG_REQUIRED' }
    $copy = ($Policy | ConvertTo-Json -Depth 100 -Compress) | ConvertFrom-Json
    $bindings = New-Object System.Collections.Generic.List[object]
    $otherMembers = New-Object System.Collections.Generic.List[string]
    foreach ($binding in @(Get-SentinelProperty $copy 'bindings')) {
        if (Test-SentinelCondition $binding $Condition) {
            $remaining = @(@(Get-SentinelProperty $binding 'members') | Where-Object { $_ -cne $Member })
            if ($remaining.Count -gt 0 -and $Remove) {
                $binding | Add-Member -NotePropertyName members -NotePropertyValue $remaining -Force
                $bindings.Add($binding)
            }
            if (-not $Remove) { foreach ($existingMember in $remaining) { $otherMembers.Add([string]$existingMember) } }
        } elseif ($null -ne $binding) { $bindings.Add($binding) }
    }
    if (-not $Remove) { $bindings.Add([pscustomobject]@{ role = $script:SentinelRole; members = @(@($Member) + @($otherMembers.ToArray()) | Select-Object -Unique); condition = $Condition }) }
    $copy | Add-Member -NotePropertyName version -NotePropertyValue 3 -Force
    $copy | Add-Member -NotePropertyName bindings -NotePropertyValue @($bindings.ToArray()) -Force
    return $copy
}
function New-SentinelHttpTransport {
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(20)
    return [pscustomobject]@{ Handler = $handler; Client = $client }
}
function Invoke-SentinelHttp([string]$Method, [string]$Uri, [string]$Token, $Body, [bool]$ReadJson, [bool]$QuotaProject) {
    $request = $null; $response = $null; $handler = $null; $client = $null; $cancel = $null; $stream = $null
    try {
        if ($Uri -cnotmatch '^https://(iam|iamcredentials|firestore|storage)\.googleapis\.com/') { throw 'ENDPOINT_REJECTED' }
        $transport = New-SentinelHttpTransport
        $handler = $transport.Handler; $client = $transport.Client
        $cancel = New-Object System.Threading.CancellationTokenSource
        $cancel.CancelAfter(20000)
        $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::new($Method), $Uri)
        $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Token)
        if ($QuotaProject) { [void]$request.Headers.TryAddWithoutValidation('x-goog-user-project', 'pay-0-system') }
        if ($null -ne $Body) { $request.Content = [System.Net.Http.StringContent]::new(($Body | ConvertTo-Json -Depth 100 -Compress), [System.Text.Encoding]::UTF8, 'application/json') }
        $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead, $cancel.Token).GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        $data = $null
        # Never read financial/storage probe payload, even on unexpected HTTP200.
        if ($ReadJson -and $status -ge 200 -and $status -lt 300) {
            $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $memory = New-Object System.IO.MemoryStream
            try {
                $buffer = New-Object byte[] 4096
                while (($read = $stream.ReadAsync($buffer, 0, $buffer.Length, $cancel.Token).GetAwaiter().GetResult()) -gt 0) {
                    if ($memory.Length + $read -gt 262144) { throw 'RESPONSE_LIMIT' }
                    $memory.Write($buffer, 0, $read)
                }
                $json = [System.Text.Encoding]::UTF8.GetString($memory.ToArray())
                if ($json) { $data = $json | ConvertFrom-Json }
            } finally { $memory.Dispose(); $json = $null; $buffer = $null }
        }
        return [pscustomobject]@{ Status = $status; Data = $data }
    } catch { return [pscustomobject]@{ Status = 0; Data = $null } }
    finally {
        if ($cancel) { $cancel.Cancel(); $cancel.Dispose() }
        if ($stream) { $stream.Dispose() }; if ($response) { $response.Dispose() }
        if ($request) { $request.Dispose() }; if ($client) { $client.Dispose() }; if ($handler) { $handler.Dispose() }
        $Token = $null
    }
}
function Get-SentinelPolicy([string]$Token) {
    $result = Invoke-SentinelHttp 'POST' ($script:SentinelIamBase + ':getIamPolicy') $Token @{ options = @{ requestedPolicyVersion = 3 } } $true $true
    if ($result.Status -ne 200 -or -not (Get-SentinelProperty $result.Data 'etag')) { throw 'POLICY_READ_FAILED' }
    return $result.Data
}
function Set-SentinelTemporaryBinding([string]$Token, [string]$Member, $Condition, [bool]$Remove) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $policy = Get-SentinelPolicy $Token
        if ($Remove -and -not (Test-SentinelBinding $policy $Member $Condition)) { return }
        $updated = New-SentinelPolicy $policy $Member $Condition $Remove
        $result = Invoke-SentinelHttp 'POST' ($script:SentinelIamBase + ':setIamPolicy') $Token @{ policy = $updated; updateMask = 'bindings,etag' } $false $true
        if ($result.Status -eq 200) { return }
        if ($result.Status -notin @(0, 409, 429, 500, 503)) { throw 'POLICY_UPDATE_FAILED' }
        # A timeout is ambiguous. Re-read with etag before retry/removal.
    }
    throw 'POLICY_UPDATE_UNCONFIRMED'
}
function Wait-SentinelPropagation { Start-Sleep -Seconds 20 }
function Invoke-SentinelVerification([string]$OperatorEmail, [string]$OperatorToken) {
    if ($OperatorEmail -cnotmatch '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' -or $OperatorEmail.EndsWith('.gserviceaccount.com')) { throw 'USER_OPERATOR_REQUIRED' }
    $member = 'user:' + $OperatorEmail.ToLowerInvariant()
    $condition = [pscustomobject]@{ title = 'pay0-runtime-verifier-' + [Guid]::NewGuid().ToString('N');
        description = 'Temporary runtime isolation verification; no financial writes';
        expression = "request.time < timestamp('" + [DateTime]::UtcNow.AddMinutes(20).ToString('yyyy-MM-ddTHH:mm:ssZ') + "')" }
    $runtimeToken = $null; $transaction = $null; $bindingAttempted = $false; $cleanupVerified = $false; $probesPassed = $false; $rollbackPassed = $false
    $database = 'https://firestore.googleapis.com/v1/projects/pay0-sentinel-observe/databases/sentinel-observation/documents'
    try {
        $role = Invoke-SentinelHttp 'GET' ('https://iam.googleapis.com/v1/' + $script:SentinelRole) $OperatorToken $null $true $true
        $permissions = @(Get-SentinelProperty $role.Data 'includedPermissions')
        if ($role.Status -ne 200 -or $permissions.Count -ne 1 -or $permissions[0] -cne 'iam.serviceAccounts.getAccessToken' -or (Get-SentinelProperty $role.Data 'deleted') -eq $true) { throw 'MINIMAL_ROLE_REQUIRED' }
        Write-SentinelStatus 'ROLE' 'MINIMAL_VERIFIED'
        # Set this before attempting network mutation so finally handles unknown outcome.
        $bindingAttempted = $true
        Set-SentinelTemporaryBinding $OperatorToken $member $condition $false
        if (-not (Test-SentinelBinding (Get-SentinelPolicy $OperatorToken) $member $condition)) { throw 'BINDING_NOT_CONFIRMED' }
        Write-SentinelStatus 'TEMP_BINDING' 'CONFIRMED'
        for ($attempt = 1; $attempt -le 7; $attempt++) {
            $mint = Invoke-SentinelHttp 'POST' ('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + $script:SentinelAccount + ':generateAccessToken') $OperatorToken @{ scope = @('https://www.googleapis.com/auth/cloud-platform'); lifetime = '600s' } $true $true
            Write-SentinelStatus 'MINT_HTTP' ([string]$mint.Status)
            if ($mint.Status -eq 200) {
                $runtimeToken = Get-SentinelProperty $mint.Data 'accessToken'
                $expires = [DateTimeOffset]::Parse((Get-SentinelProperty $mint.Data 'expireTime'))
                if ($runtimeToken -cnotmatch '^[A-Za-z0-9._~+/-]{20,8192}={0,2}$' -or $expires -le [DateTimeOffset]::UtcNow.AddSeconds(30) -or $expires -gt [DateTimeOffset]::UtcNow.AddSeconds(630)) { throw 'MINT_RESPONSE_INVALID' }
                break
            }
            if ($mint.Status -notin @(0, 403, 429, 500, 503) -or $attempt -eq 7) { throw 'MINT_FAILED' }
            Write-SentinelStatus 'MINT_PROPAGATION' 'WAIT_20_SECONDS'; Wait-SentinelPropagation
        }
        $mint = $null
        $probeId = [Guid]::NewGuid().ToString('N')
        $path = '/documents/sentinelIsolationProbes/' + $probeId
        $probes = @(
            @{ Stage = 'FINANCIAL_FIRESTORE'; Expected = 403; Uri = 'https://firestore.googleapis.com/v1/projects/pay-0-system/databases/(default)' + $path },
            @{ Stage = 'ISOLATED_DEFAULT'; Expected = 403; Uri = 'https://firestore.googleapis.com/v1/projects/pay0-sentinel-observe/databases/(default)' + $path },
            @{ Stage = 'ISOLATED_NAMED'; Expected = 404; Uri = 'https://firestore.googleapis.com/v1/projects/pay0-sentinel-observe/databases/sentinel-observation' + $path },
            @{ Stage = 'FINANCIAL_STORAGE'; Expected = 403; Uri = 'https://storage.googleapis.com/storage/v1/b/pay-0-system.firebasestorage.app/o/' + [Uri]::EscapeDataString('sentinelIsolationProbes/' + $probeId) }
        )
        $probesPassed = $true
        foreach ($probe in $probes) {
            # No x-goog-user-project: avoid a false negative from billing-project serviceusage permission.
            $result = Invoke-SentinelHttp 'GET' $probe.Uri $runtimeToken $null $false $false
            Write-SentinelStatus $probe.Stage ([string]$result.Status)
            if ($result.Status -ne $probe.Expected) { $probesPassed = $false }
        }
        $begin = Invoke-SentinelHttp 'POST' ($database + ':beginTransaction') $runtimeToken @{ options = @{ readWrite = @{} } } $true $false
        Write-SentinelStatus 'NAMED_BEGIN' ([string]$begin.Status)
        $candidateTransaction = Get-SentinelProperty $begin.Data 'transaction'
        if ($begin.Status -ne 200 -or $candidateTransaction -isnot [string] -or $candidateTransaction.Length -lt 1 -or $candidateTransaction.Length -gt 8192) { throw 'BEGIN_FAILED' }
        $transaction = $candidateTransaction
    } catch { $probesPassed = $false; Write-SentinelStatus 'VERIFICATION' 'FAILED' }
    finally {
        if ($transaction) {
            try {
                $rollback = Invoke-SentinelHttp 'POST' ($database + ':rollback') $runtimeToken @{ transaction = $transaction } $false $false
                Write-SentinelStatus 'NAMED_ROLLBACK' ([string]$rollback.Status)
                $rollbackPassed = $rollback.Status -eq 200
            } catch { Write-SentinelStatus 'NAMED_ROLLBACK' 'FAILED' }
        }
        if ($bindingAttempted) {
            try {
                Set-SentinelTemporaryBinding $OperatorToken $member $condition $true
                $remaining = Get-SentinelPolicy $OperatorToken
                # Exact cleanup plus detect same-title membership with concurrent changed expression.
                $titleRemains = @(@(Get-SentinelProperty $remaining 'bindings') | Where-Object {
                    (Get-SentinelProperty $_ 'role') -ceq $script:SentinelRole -and
                    (Get-SentinelProperty (Get-SentinelProperty $_ 'condition') 'title') -ceq $condition.title -and
                    @(Get-SentinelProperty $_ 'members') -contains $member
                }).Count -gt 0
                $cleanupVerified = -not $titleRemains
                if ($cleanupVerified) { Write-SentinelStatus 'TEMP_BINDING' 'REMOVED_VERIFIED' } else { Write-SentinelStatus 'TEMP_BINDING' 'CLEANUP_UNVERIFIED' }
            } catch { Write-SentinelStatus 'TEMP_BINDING' 'CLEANUP_UNVERIFIED' }
        } else { $cleanupVerified = $true; Write-SentinelStatus 'TEMP_BINDING' 'NOT_ATTEMPTED' }
        $runtimeToken = $null; $OperatorToken = $null; $transaction = $null; $candidateTransaction = $null; $mint = $null; $begin = $null
    }
    return [pscustomobject]@{ ProbesPassed = ($probesPassed -and $rollbackPassed); CleanupVerified = $cleanupVerified }
}

function Invoke-SentinelGcloud([string[]]$Arguments) {
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $raw = @(& gcloud @Arguments 2>$null)
        return [pscustomobject]@{ Status = $LASTEXITCODE; Text = ($raw -join '').Trim() }
    } finally { $ErrorActionPreference = $previous; $raw = $null }
}

if ($LibraryOnly) { return }
if (-not $Execute) { Write-SentinelStatus 'MODE' 'DRY_RUN_NO_REMOTE_CALLS'; Write-SentinelStatus 'RUNTIME_IAM' 'NOT_VERIFIED'; return }
$exitCode = 1
try {
    Add-Type -AssemblyName System.Net.Http
    $script:SentinelLogPath = Join-Path ([System.IO.Path]::GetTempPath()) ('pay0-sentinel-iam-verification-' + [Guid]::NewGuid().ToString('N') + '.log')
    foreach ($name in @('CLOUDSDK_AUTH_ACCESS_TOKEN', 'CLOUDSDK_AUTH_ACCESS_TOKEN_FILE', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE', 'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT', 'GOOGLE_APPLICATION_CREDENTIALS')) {
        if ([Environment]::GetEnvironmentVariable($name)) { throw 'AMBIGUOUS_OPERATOR_CREDENTIALS' }
    }
    $impersonation = Invoke-SentinelGcloud @('config', 'get-value', 'auth/impersonate_service_account', '--quiet')
    if ($impersonation.Status -ne 0 -or ($impersonation.Text -and $impersonation.Text -ne '(unset)')) { throw 'IMPERSONATION_CONFIG_REJECTED' }
    $accountResult = Invoke-SentinelGcloud @('auth', 'list', '--filter=status:ACTIVE', '--format=value(account)', '--quiet')
    $operatorEmail = $accountResult.Text
    if ($accountResult.Status -ne 0) { throw 'OPERATOR_LOOKUP_FAILED' }
    $credentialResult = Invoke-SentinelGcloud @('auth', 'print-access-token', '--quiet')
    $operatorToken = $credentialResult.Text
    if ($credentialResult.Status -ne 0 -or $operatorToken -cnotmatch '^[A-Za-z0-9._~+/-]{20,8192}={0,2}$') { throw 'OPERATOR_TOKEN_FAILED' }
    $verification = Invoke-SentinelVerification $operatorEmail $operatorToken
    if ($verification.ProbesPassed -and $verification.CleanupVerified) { $exitCode = 0; Write-SentinelStatus 'RUNTIME_IAM' 'PROBE_MATRIX_PASS' }
    else { Write-SentinelStatus 'RUNTIME_IAM' 'NOT_VERIFIED' }
} catch { Write-SentinelStatus 'RUNTIME_IAM' 'NOT_VERIFIED' }
finally { $operatorToken = $null; $operatorEmail = $null; $credentialResult = $null }
exit $exitCode
