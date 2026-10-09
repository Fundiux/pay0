[CmdletBinding()]
param([switch]$Execute, [switch]$LibraryOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
# Helpers copied explicitly from verify-runtime-iam.ps1; original remains unchanged.
$script:CanaryLogPath = $null
$script:CanaryAccount = 'pay0-observation-canary@pay-0-system.iam.gserviceaccount.com'
$script:CanaryRole = 'projects/pay-0-system/roles/canaryRuntimeVerifier'
$script:CanarySaBase = 'https://iam.googleapis.com/v1/projects/-/serviceAccounts/' + $script:CanaryAccount
$script:CanaryRunBase = 'https://run.googleapis.com/v2/projects/pay-0-system/locations/us-central1/services/pay0-security-canary'
$script:CanaryUrl = $null
$script:CanaryRevision = 'projects/pay-0-system/locations/us-central1/services/pay0-security-canary/revisions/pay0-security-canary-00001-fmm'
$script:CanaryRevisionId = 'pay0-security-canary-00001-fmm'
$script:CanaryAllowedUrls = @('https://pay0-security-canary-o4tesftjlq-uc.a.run.app', 'https://pay0-security-canary-751158244178.us-central1.run.app')
function Write-CanaryStatus([string]$Stage, [string]$Status) {
    if ($Stage -cnotmatch '^[A-Z0-9_]+$' -or $Status -cnotmatch '^[A-Z0-9_]+$') { throw 'INVALID_STATUS' }
    $line = $Stage + ':' + $Status
    [Console]::WriteLine($line)
    if ($script:CanaryLogPath) {
        try { Add-Content -LiteralPath $script:CanaryLogPath -Value $line -Encoding Ascii }
        catch { [Console]::WriteLine('LOCAL_LOG:WRITE_FAILED') }
    }
}
function Get-CanaryProperty($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}
function Test-CanaryCondition($Binding, $Condition) {
    $actual = Get-CanaryProperty $Binding 'condition'
    return ((Get-CanaryProperty $Binding 'role') -ceq $script:CanaryRole -and
        (Get-CanaryProperty $actual 'title') -ceq $Condition.title -and
        (Get-CanaryProperty $actual 'expression') -ceq $Condition.expression -and
        (Get-CanaryProperty $actual 'description') -ceq $Condition.description)
}
function Test-CanaryBinding($Policy, [string]$Member, $Condition) {
    foreach ($binding in @(Get-CanaryProperty $Policy 'bindings')) {
        if ((Test-CanaryCondition $binding $Condition) -and @(Get-CanaryProperty $binding 'members') -contains $Member) { return $true }
    }
    return $false
}
function New-CanaryPolicy($Policy, [string]$Member, $Condition, [bool]$Remove) {
    # Clone without printing or saving policy. Preserve etag/other bindings/fields.
    if (-not (Get-CanaryProperty $Policy 'etag')) { throw 'POLICY_ETAG_REQUIRED' }
    $copy = ($Policy | ConvertTo-Json -Depth 100 -Compress) | ConvertFrom-Json
    $bindings = New-Object System.Collections.Generic.List[object]
    $otherMembers = New-Object System.Collections.Generic.List[string]
    foreach ($binding in @(Get-CanaryProperty $copy 'bindings')) {
        if (Test-CanaryCondition $binding $Condition) {
            $remaining = @(@(Get-CanaryProperty $binding 'members') | Where-Object { $_ -cne $Member })
            if ($remaining.Count -gt 0 -and $Remove) {
                $binding | Add-Member -NotePropertyName members -NotePropertyValue $remaining -Force
                $bindings.Add($binding)
            }
            if (-not $Remove) { foreach ($existingMember in $remaining) { $otherMembers.Add([string]$existingMember) } }
        } elseif ($null -ne $binding) { $bindings.Add($binding) }
    }
    if (-not $Remove) { $bindings.Add([pscustomobject]@{ role = $script:CanaryRole; members = @(@($Member) + @($otherMembers.ToArray()) | Select-Object -Unique); condition = $Condition }) }
    $copy | Add-Member -NotePropertyName version -NotePropertyValue 3 -Force
    $copy | Add-Member -NotePropertyName bindings -NotePropertyValue @($bindings.ToArray()) -Force
    return $copy
}
function New-CanaryHttpTransport {
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(20)
    return [pscustomobject]@{ Handler = $handler; Client = $client }
}
function Invoke-CanaryHttp([string]$Method, [string]$Uri, [string]$Token, $Body, [bool]$ReadJson, [bool]$QuotaProject) {
    $request = $null; $response = $null; $handler = $null; $client = $null; $cancel = $null; $stream = $null
    try {
        if ($Uri -cnotmatch '^https://(iam|iamcredentials|firestore|storage|run)\.googleapis\.com/' -and ($null -eq $script:CanaryUrl -or $Uri -cne ($script:CanaryUrl + '/canary'))) { throw 'ENDPOINT_REJECTED' }
        $transport = New-CanaryHttpTransport
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
        if ($ReadJson -and (($status -ge 200 -and $status -lt 300) -or ($status -eq 503 -and $Uri -ceq ($script:CanaryUrl + '/canary')))) {
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
function Invoke-CanaryGcloud([string[]]$Arguments) {
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $raw = @(& gcloud @Arguments 2>$null)
        return [pscustomobject]@{ Status = $LASTEXITCODE; Text = ($raw -join '').Trim() }
    } finally { $ErrorActionPreference = $previous; $raw = $null }
}

function Wait-CanaryPropagation { Start-Sleep -Seconds 20 }
function Get-CanaryTargetPolicy($Target, [string]$Token) {
    if ($Target.Kind -eq 'SA') {
        $r = Invoke-CanaryHttp 'POST' ($Target.Base + ':getIamPolicy') $Token @{options=@{requestedPolicyVersion=3}} $true $true
    } else {
        $r = Invoke-CanaryHttp 'GET' ($Target.Base + ':getIamPolicy?options.requestedPolicyVersion=3') $Token $null $true $true
    }
    if ($r.Status -ne 200 -or -not (Get-CanaryProperty $r.Data 'etag')) { throw 'POLICY_READ_FAILED' }
    return $r.Data
}
function Set-CanaryTargetBinding($Target, [string]$Token, $Condition, [bool]$Remove) {
    $savedRole = $script:CanaryRole
    try {
        $script:CanaryRole = $Target.Role
        for ($i=1; $i -le 3; $i++) {
            $policy = Get-CanaryTargetPolicy $Target $Token
            if ($Remove -and -not (Test-CanaryBinding $policy $Target.Member $Condition)) { return }
            $updated = New-CanaryPolicy $policy $Target.Member $Condition $Remove
            $r = Invoke-CanaryHttp 'POST' ($Target.Base + ':setIamPolicy') $Token @{policy=$updated;updateMask='bindings,etag'} $false $true
            if ($r.Status -eq 200) { return }
            if ($r.Status -notin @(0,409,429,500,503)) { throw 'POLICY_UPDATE_FAILED' }
        }
        throw 'POLICY_UPDATE_UNCONFIRMED'
    } finally { $script:CanaryRole = $savedRole }
}
function Test-CanaryTargetBinding($Target, [string]$Token, $Condition, [bool]$Absent) {
    $savedRole = $script:CanaryRole
    try {
        $script:CanaryRole = $Target.Role
        $policy = Get-CanaryTargetPolicy $Target $Token
        if (-not $Absent) { return Test-CanaryBinding $policy $Target.Member $Condition }
        # Also detect our title with a concurrently changed expression; never delete that binding blindly.
        return @(@(Get-CanaryProperty $policy 'bindings') | Where-Object {
            (Get-CanaryProperty $_ 'role') -ceq $Target.Role -and
            (Get-CanaryProperty (Get-CanaryProperty $_ 'condition') 'title') -ceq $Condition.title -and
            @(Get-CanaryProperty $_ 'members') -contains $Target.Member
        }).Count -eq 0
    } finally { $script:CanaryRole = $savedRole }
}
function Assert-CanaryDisabled([string]$Token) {
    $r = Invoke-CanaryHttp 'GET' $script:CanaryRunBase $Token $null $true $true
    if ($r.Status -ne 200) { throw 'SERVICE_READ_FAILED' }
    $service = $r.Data
    $url = Get-CanaryProperty $service 'uri'
    if ($script:CanaryAllowedUrls -cnotcontains $url -or
        (Get-CanaryProperty $service 'reconciling') -eq $true -or
        (Get-CanaryProperty $service 'latestReadyRevision') -cne $script:CanaryRevision -or
        (Get-CanaryProperty $service 'latestCreatedRevision') -cne $script:CanaryRevision -or
        (Get-CanaryProperty $service 'invokerIamDisabled') -eq $true) { throw 'SERVICE_STATE_REJECTED' }
    $traffic = @(Get-CanaryProperty $service 'trafficStatuses')
    if ($traffic.Count -ne 1 -or (Get-CanaryProperty $traffic[0] 'percent') -ne 100 -or
        (Get-CanaryProperty $traffic[0] 'revision') -cne $script:CanaryRevisionId) { throw 'TRAFFIC_STATE_REJECTED' }
    $rev = Invoke-CanaryHttp 'GET' ('https://run.googleapis.com/v2/' + $script:CanaryRevision) $Token $null $true $true
    $containers = @(Get-CanaryProperty $rev.Data 'containers')
    if ($rev.Status -ne 200 -or (Get-CanaryProperty $rev.Data 'serviceAccount') -cne $script:CanaryAccount -or $containers.Count -ne 1) { throw 'REVISION_STATE_REJECTED' }
    $mode = @(@(Get-CanaryProperty $containers[0] 'env') | Where-Object { (Get-CanaryProperty $_ 'name') -ceq 'OBSERVATION_PUBLISHER_MODE' })
    if ($mode.Count -ne 1 -or (Get-CanaryProperty $mode[0] 'value') -cne 'DISABLED') { throw 'DISABLED_REQUIRED' }
    if ($script:CanaryUrl -and $script:CanaryUrl -cne $url) { throw 'SERVICE_URL_CHANGED' }
    $script:CanaryUrl = $url
}
function Get-CanaryIdClaims([string]$Token) {
    if ($Token.Length -gt 16384 -or $Token -cnotmatch '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') { throw 'ID_TOKEN_INVALID' }
    $encoded = $Token.Split('.')[1].Replace('-','+').Replace('_','/')
    while ($encoded.Length % 4) { $encoded += '=' }
    $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    # Structural sanity only; signature is validated by Cloud Run, not this decoder.
    if ((Get-CanaryProperty $claims 'aud') -cne $script:CanaryUrl -or
        (Get-CanaryProperty $claims 'email') -cne $script:CanaryAccount -or
        (Get-CanaryProperty $claims 'iss') -notin @('https://accounts.google.com','accounts.google.com') -or
        (Get-CanaryProperty $claims 'exp') -le ($now+30) -or
        (Get-CanaryProperty $claims 'exp') -gt ($now+3630)) { throw 'ID_TOKEN_CLAIMS_INVALID' }
}
function Invoke-CanaryVerification([string]$OperatorEmail, [string]$OperatorToken) {
    if ($OperatorEmail -cnotmatch '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' -or $OperatorEmail.EndsWith('.gserviceaccount.com')) { throw 'USER_OPERATOR_REQUIRED' }
    $condition = [pscustomobject]@{title='pay0-canary-verifier-'+[Guid]::NewGuid().ToString('N');description='Temporary disabled canary verification';expression="request.time < timestamp('"+[DateTime]::UtcNow.AddMinutes(20).ToString('yyyy-MM-ddTHH:mm:ssZ')+"')"}
    $targets = @(
        [pscustomobject]@{Kind='SA';Base=$script:CanarySaBase;Role=$script:CanaryRole;Member=('user:'+$OperatorEmail.ToLowerInvariant())},
        [pscustomobject]@{Kind='RUN';Base=$script:CanaryRunBase;Role='roles/run.invoker';Member=('serviceAccount:'+$script:CanaryAccount)}
    )
    $attempted = New-Object System.Collections.Generic.List[object]
    $accessToken=$null; $idToken=$null; $mint=$null; $passed=$false; $clean=$true
    try {
        $script:CanaryUrl=$null
        Assert-CanaryDisabled $OperatorToken
        $role = Invoke-CanaryHttp 'GET' ('https://iam.googleapis.com/v1/'+$script:CanaryRole) $OperatorToken $null $true $true
        $perms = @(Get-CanaryProperty $role.Data 'includedPermissions')
        if ($role.Status -ne 200 -or (Get-CanaryProperty $role.Data 'deleted') -eq $true -or $perms.Count -ne 2 -or
            $perms -cnotcontains 'iam.serviceAccounts.getAccessToken' -or $perms -cnotcontains 'iam.serviceAccounts.getOpenIdToken') { throw 'MINIMAL_ROLE_REQUIRED' }
        foreach ($target in $targets) {
            $attempted.Add($target)
            Set-CanaryTargetBinding $target $OperatorToken $condition $false
            if (-not (Test-CanaryTargetBinding $target $OperatorToken $condition $false)) { throw 'BINDING_NOT_CONFIRMED' }
            Write-CanaryStatus ($target.Kind+'_BINDING') 'CONFIRMED'
        }
        foreach ($kind in @('ACCESS','ID')) {
            for ($i=1; $i -le 7; $i++) {
                $action='generateAccessToken'; $body=@{scope=@('https://www.googleapis.com/auth/cloud-platform');lifetime='600s'}
                if ($kind -eq 'ID') { $action='generateIdToken'; $body=@{audience=$script:CanaryUrl;includeEmail=$true} }
                $mint = Invoke-CanaryHttp 'POST' ('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+$script:CanaryAccount+':'+$action) $OperatorToken $body $true $true
                Write-CanaryStatus ($kind+'_MINT') ([string]$mint.Status)
                if ($mint.Status -eq 200) { break }
                if ($i -eq 7 -or $mint.Status -notin @(0,403,429,500,503)) { throw 'MINT_FAILED' }
                Wait-CanaryPropagation
            }
            if ($kind -eq 'ACCESS') {
                $accessToken = Get-CanaryProperty $mint.Data 'accessToken'
                $expires = [DateTimeOffset]::Parse((Get-CanaryProperty $mint.Data 'expireTime'))
                if ($accessToken -cnotmatch '^[A-Za-z0-9._~+/-]{20,8192}={0,2}$' -or $expires -le [DateTimeOffset]::UtcNow.AddSeconds(30) -or $expires -gt [DateTimeOffset]::UtcNow.AddSeconds(630)) { throw 'ACCESS_TOKEN_INVALID' }
            } else { $idToken=Get-CanaryProperty $mint.Data 'token'; Get-CanaryIdClaims $idToken }
            $mint=$null
        }
        $passed=$true
        # Recheck pinned revision and DISABLED before every invocation; no concurrent rollout allowed.
        for ($i=1; $i -le 7; $i++) {
            Assert-CanaryDisabled $OperatorToken
            $r=Invoke-CanaryHttp 'POST' ($script:CanaryUrl+'/canary') $idToken $null $true $false
            Write-CanaryStatus 'DISABLED_POST' ([string]$r.Status)
            if ($r.Status -ne 403 -or $i -eq 7) { break }
            Wait-CanaryPropagation
        }
        if ($r.Status -ne 503 -or (Get-CanaryProperty $r.Data 'code') -cne 'PUBLISHER_DISABLED') { $passed=$false }
        $path='/documents/sentinelIsolationProbes/'+[Guid]::NewGuid().ToString('N')
        $probes=@(
            @{Stage='FINANCIAL_FIRESTORE';Uri='https://firestore.googleapis.com/v1/projects/pay-0-system/databases/(default)'+$path},
            @{Stage='ISOLATED_NAMED';Uri='https://firestore.googleapis.com/v1/projects/pay0-sentinel-observe/databases/sentinel-observation'+$path},
            @{Stage='FINANCIAL_STORAGE';Uri='https://storage.googleapis.com/storage/v1/b/pay-0-system.firebasestorage.app/o/'+[Uri]::EscapeDataString('sentinelIsolationProbes/'+[Guid]::NewGuid().ToString('N'))}
        )
        foreach ($probe in $probes) {
            $r=Invoke-CanaryHttp 'GET' $probe.Uri $accessToken $null $false $false
            Write-CanaryStatus $probe.Stage ([string]$r.Status)
            if ($r.Status -ne 403) { $passed=$false }
        }
    } catch { $passed=$false; Write-CanaryStatus 'CANARY_VERIFICATION' 'FAILED' }
    finally {
        for ($i=$attempted.Count-1; $i -ge 0; $i--) {
            $target=$attempted[$i]
            try {
                Set-CanaryTargetBinding $target $OperatorToken $condition $true
                if (-not (Test-CanaryTargetBinding $target $OperatorToken $condition $true)) { throw 'CLEANUP_UNVERIFIED' }
                Write-CanaryStatus ($target.Kind+'_BINDING') 'REMOVED_VERIFIED'
            } catch { $clean=$false; Write-CanaryStatus ($target.Kind+'_BINDING') 'CLEANUP_UNVERIFIED' }
        }
        $accessToken=$null; $idToken=$null; $OperatorToken=$null; $mint=$null
    }
    return [pscustomobject]@{ProbesPassed=$passed;CleanupVerified=$clean}
}

if ($LibraryOnly) { return }
if (-not $Execute) { Write-CanaryStatus 'MODE' 'DRY_RUN_NO_REMOTE_CALLS'; return }
$exitCode=1
try {
    Add-Type -AssemblyName System.Net.Http
    $script:CanaryLogPath=Join-Path ([IO.Path]::GetTempPath()) ('pay0-canary-verification-'+[Guid]::NewGuid().ToString('N')+'.log')
    foreach ($name in @('CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_APPLICATION_CREDENTIALS')) {
        if ([Environment]::GetEnvironmentVariable($name)) { throw 'AMBIGUOUS_CREDENTIALS' }
    }
    $imp=Invoke-CanaryGcloud @('config','get-value','auth/impersonate_service_account','--quiet')
    if ($imp.Status -ne 0 -or ($imp.Text -and $imp.Text -ne '(unset)')) { throw 'IMPERSONATION_REJECTED' }
    $account=Invoke-CanaryGcloud @('auth','list','--filter=status:ACTIVE','--format=value(account)','--quiet')
    $credential=Invoke-CanaryGcloud @('auth','print-access-token','--quiet')
    if ($account.Status -ne 0 -or $credential.Status -ne 0 -or $credential.Text -cnotmatch '^[A-Za-z0-9._~+/-]{20,8192}={0,2}$') { throw 'OPERATOR_INVALID' }
    $result=Invoke-CanaryVerification $account.Text $credential.Text
    if ($result.ProbesPassed -and $result.CleanupVerified) { $exitCode=0; Write-CanaryStatus 'CANARY_RUNTIME' 'PASS' }
    else { Write-CanaryStatus 'CANARY_RUNTIME' 'NOT_VERIFIED' }
} catch { Write-CanaryStatus 'CANARY_RUNTIME' 'NOT_VERIFIED' }
finally { $credential=$null; $account=$null }
exit $exitCode
