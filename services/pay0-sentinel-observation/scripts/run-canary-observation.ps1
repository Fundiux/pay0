[CmdletBinding()]
param(
    [switch]$Execute, [switch]$LibraryOnly,
    [ValidateSet('CANARY_DRY_RUN','CANARY')][string]$Mode='CANARY_DRY_RUN',
    [string]$ExpectedRevision='',
    [long]$ExpectedOccurredAtMs=0,
    [ValidateRange(1,2)][int]$MaxPosts=1
)
# Dot-sourcing imports the reviewed helpers, but its parameter names share scope.
$observationExecute=$Execute; $observationLibrary=$LibraryOnly
. (Join-Path $PSScriptRoot 'verify-canary-runtime.ps1') -LibraryOnly
$Execute=$observationExecute; $LibraryOnly=$observationLibrary

function Assert-ObservationWindow([long]$OccurredAtMs) {
    $now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if (([string]$OccurredAtMs) -cnotmatch '^[1-9][0-9]{12}$' -or $now -lt $OccurredAtMs -or
        ($now+3000) -ge ($OccurredAtMs+3600000)) { throw 'CANARY_WINDOW_CLOSED' }
}
function Get-ObservationFilter([string]$Revision) {
    if ($Revision -cnotmatch '^pay0-security-canary-[0-9]{5}-[a-z0-9]{3}$') { throw 'REVISION_REQUIRED' }
    return @(
        'resource.type="cloud_run_revision"',
        'resource.labels.location="us-central1"',
        'logName="projects/pay-0-system/logs/pay0_security_observation"',
        'jsonPayload.schemaVersion="PAY0-SECURITY-ENVELOPE@1"',
        ('((resource.labels.service_name="pay0-security-canary" AND (resource.labels.revision_name="'+$Revision+'") AND jsonPayload.context.rootId="canary-observation-root" AND (jsonPayload.context.actorUid="canary-observation-actor")))')
    ) -join "`n"
}
function Get-ObservationSink([string]$OperatorEmail) {
    # Fixed read-only command. JSON remains in memory; never print policy/filter payload.
    $r=Invoke-CanaryGcloud @('logging','sinks','describe','pay0-sentinel-observe-v1','--project=pay-0-system',('--account='+$OperatorEmail),'--format=json','--quiet')
    if ($r.Status -ne 0) { throw 'SINK_READ_FAILED' }
    try { return $r.Text | ConvertFrom-Json } finally { $r=$null }
}
function Assert-ObservationPreflight([string]$OperatorToken,[string]$OperatorEmail,[string]$RequestedMode,[string]$Revision,[long]$OccurredAtMs) {
    Assert-ObservationWindow $OccurredAtMs
    $expectedFilter=Get-ObservationFilter $Revision
    $fullRevision='projects/pay-0-system/locations/us-central1/services/pay0-security-canary/revisions/'+$Revision
    $r=Invoke-CanaryHttp 'GET' $script:CanaryRunBase $OperatorToken $null $true $true
    if ($r.Status -ne 200) { throw 'SERVICE_READ_FAILED' }
    $service=$r.Data; $url=Get-CanaryProperty $service 'uri'
    if ($script:CanaryAllowedUrls -cnotcontains $url -or (Get-CanaryProperty $service 'reconciling') -eq $true -or
        (Get-CanaryProperty $service 'latestReadyRevision') -cne $fullRevision -or
        (Get-CanaryProperty $service 'latestCreatedRevision') -cne $fullRevision -or
        (Get-CanaryProperty $service 'invokerIamDisabled') -eq $true) { throw 'SERVICE_STATE_REJECTED' }
    $traffic=@(Get-CanaryProperty $service 'trafficStatuses')
    if ($traffic.Count -ne 1 -or (Get-CanaryProperty $traffic[0] 'percent') -ne 100 -or
        (Get-CanaryProperty $traffic[0] 'revision') -cne $Revision) { throw 'TRAFFIC_STATE_REJECTED' }
    $r=Invoke-CanaryHttp 'GET' ('https://run.googleapis.com/v2/'+$fullRevision) $OperatorToken $null $true $true
    $containers=@(Get-CanaryProperty $r.Data 'containers')
    if ($r.Status -ne 200 -or (Get-CanaryProperty $r.Data 'serviceAccount') -cne $script:CanaryAccount -or $containers.Count -ne 1) { throw 'REVISION_STATE_REJECTED' }
    $envs=@(Get-CanaryProperty $containers[0] 'env')
    $modes=@($envs | Where-Object { (Get-CanaryProperty $_ 'name') -ceq 'OBSERVATION_PUBLISHER_MODE' })
    $projects=@($envs | Where-Object { (Get-CanaryProperty $_ 'name') -ceq 'PAY0_SOURCE_PROJECT_ID' })
    if ($modes.Count -ne 1 -or (Get-CanaryProperty $modes[0] 'value') -cne $RequestedMode -or
        $projects.Count -ne 1 -or (Get-CanaryProperty $projects[0] 'value') -cne 'pay-0-system') { throw 'MODE_OR_SOURCE_REJECTED' }
    $epochs=@($envs | Where-Object { (Get-CanaryProperty $_ 'name') -ceq 'CANARY_OCCURRED_AT_MS' })
    if ($epochs.Count -ne 1 -or (Get-CanaryProperty $epochs[0] 'value') -cne ([string]$OccurredAtMs)) { throw 'EVENT_EPOCH_REJECTED' }
    if ($script:CanaryUrl -and $script:CanaryUrl -cne $url) { throw 'URL_CHANGED' }
    $sink=Get-ObservationSink $OperatorEmail
    $filter=Get-CanaryProperty $sink 'filter'
    $disabled=Get-CanaryProperty $sink 'disabled'
    # Absent disabled means false in protobuf JSON; reject non-boolean values.
    if ($null -ne $disabled -and $disabled -isnot [bool]) { throw 'SINK_DISABLED_INVALID' }
    $expectedDisabled=$RequestedMode -ceq 'CANARY_DRY_RUN'
    if ([bool]$disabled -ne $expectedDisabled -or
        (Get-CanaryProperty $sink 'name') -cne 'pay0-sentinel-observe-v1' -or
        (Get-CanaryProperty $sink 'destination') -cne 'pubsub.googleapis.com/projects/pay0-sentinel-observe/topics/pay0-security-observe-v1' -or
        $filter -isnot [string] -or ($filter -replace '\s+',' ').Trim() -cne ($expectedFilter -replace '\s+',' ').Trim() -or
        @(Get-CanaryProperty $sink 'exclusions' | Where-Object {$null -ne $_}).Count -gt 0 -or
        (Get-CanaryProperty $sink 'includeChildren') -eq $true -or
        (Get-CanaryProperty $sink 'interceptChildren') -eq $true) { throw 'SINK_STATE_REJECTED' }
    $script:CanaryUrl=$url
}
function Invoke-ObservationRun([string]$OperatorEmail,[string]$OperatorToken,[string]$RequestedMode,[string]$Revision,[int]$PostLimit,[long]$OccurredAtMs) {
    Assert-ObservationWindow $OccurredAtMs
    if ($RequestedMode -cnotin @('CANARY_DRY_RUN','CANARY') -or $PostLimit -lt 1 -or $PostLimit -gt 2 -or
        ($RequestedMode -ceq 'CANARY_DRY_RUN' -and $PostLimit -ne 1)) { throw 'POST_BOUND_REJECTED' }
    $null=Get-ObservationFilter $Revision
    if ($OperatorEmail -cnotmatch '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' -or $OperatorEmail.EndsWith('.gserviceaccount.com')) { throw 'USER_OPERATOR_REQUIRED' }
    $condition=[pscustomobject]@{title='pay0-observation-run-'+[Guid]::NewGuid().ToString('N');description='Temporary bounded synthetic canary invocation';expression="request.time < timestamp('"+[DateTime]::UtcNow.AddMinutes(20).ToString('yyyy-MM-ddTHH:mm:ssZ')+"')"}
    $targets=@(
        [pscustomobject]@{Kind='SA';Base=$script:CanarySaBase;Role=$script:CanaryRole;Member=('user:'+$OperatorEmail.ToLowerInvariant())},
        [pscustomobject]@{Kind='RUN';Base=$script:CanaryRunBase;Role='roles/run.invoker';Member=('serviceAccount:'+$script:CanaryAccount)}
    )
    $attempted=New-Object System.Collections.Generic.List[object]
    $posts=0; $accepted=0; $clean=$true; $passed=$false; $idToken=$null; $mint=$null
    try {
        $script:CanaryUrl=$null
        Assert-ObservationPreflight $OperatorToken $OperatorEmail $RequestedMode $Revision $OccurredAtMs
        $r=Invoke-CanaryHttp 'GET' ('https://iam.googleapis.com/v1/'+$script:CanaryRole) $OperatorToken $null $true $true
        $perms=@(Get-CanaryProperty $r.Data 'includedPermissions')
        if ($r.Status -ne 200 -or (Get-CanaryProperty $r.Data 'deleted') -eq $true -or $perms.Count -ne 2 -or
            $perms -cnotcontains 'iam.serviceAccounts.getAccessToken' -or $perms -cnotcontains 'iam.serviceAccounts.getOpenIdToken') { throw 'MINIMAL_ROLE_REQUIRED' }
        foreach ($target in $targets) {
            $attempted.Add($target)
            Set-CanaryTargetBinding $target $OperatorToken $condition $false
            if (-not (Test-CanaryTargetBinding $target $OperatorToken $condition $false)) { throw 'BINDING_NOT_CONFIRMED' }
            Write-CanaryStatus ($target.Kind+'_BINDING') 'CONFIRMED'
        }
        # Only an ID token is needed. No runtime access token or unrelated probes.
        for ($i=1; $i -le 7; $i++) {
            $mint=Invoke-CanaryHttp 'POST' ('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+$script:CanaryAccount+':generateIdToken') $OperatorToken @{audience=$script:CanaryUrl;includeEmail=$true} $true $true
            Write-CanaryStatus 'ID_MINT' ([string]$mint.Status)
            if ($mint.Status -eq 200) { break }
            if ($i -eq 7 -or $mint.Status -notin @(0,403,429,500,503)) { throw 'ID_MINT_FAILED' }
            Wait-CanaryPropagation
        }
        $idToken=Get-CanaryProperty $mint.Data 'token'; Get-CanaryIdClaims $idToken; $mint=$null
        # Delay once for invoker propagation; POSTs themselves never retry.
        Wait-CanaryPropagation
        for ($i=1; $i -le $PostLimit; $i++) {
            Assert-ObservationPreflight $OperatorToken $OperatorEmail $RequestedMode $Revision $OccurredAtMs
            $posts++ # Count before send, including ambiguous timeout/401/403/503.
            $r=Invoke-CanaryHttp 'POST' ($script:CanaryUrl+'/canary') $idToken $null $true $false
            Write-CanaryStatus ('CANARY_POST_'+$posts) ([string]$r.Status)
            $expectedCode='LOGGING_ACCEPTED'
            if ($RequestedMode -ceq 'CANARY_DRY_RUN') { $expectedCode='LOGGING_DRY_RUN_ACCEPTED' }
            if ($r.Status -ne 200 -or (Get-CanaryProperty $r.Data 'code') -cne $expectedCode) { throw 'POST_NOT_CONFIRMED' }
            $accepted++
        }
        $passed=$true
    } catch { Write-CanaryStatus 'OBSERVATION_RUN' 'NOT_CONFIRMED' }
    finally {
        for ($i=$attempted.Count-1; $i -ge 0; $i--) {
            $target=$attempted[$i]
            try {
                Set-CanaryTargetBinding $target $OperatorToken $condition $true
                if (-not (Test-CanaryTargetBinding $target $OperatorToken $condition $true)) { throw 'CLEANUP_UNVERIFIED' }
                Write-CanaryStatus ($target.Kind+'_BINDING') 'REMOVED_VERIFIED'
            } catch { $clean=$false; Write-CanaryStatus ($target.Kind+'_BINDING') 'CLEANUP_UNVERIFIED' }
        }
        $idToken=$null; $OperatorToken=$null; $mint=$null
    }
    return [pscustomobject]@{Accepted=$passed;PostsAttempted=$posts;PostsAccepted=$accepted;CleanupVerified=$clean}
}

if ($LibraryOnly) { return }
if (-not $Execute) { Write-CanaryStatus 'MODE' 'DRY_RUN_NO_REMOTE_CALLS'; return }
$exitCode=1
try {
    $null=Get-ObservationFilter $ExpectedRevision
    Assert-ObservationWindow $ExpectedOccurredAtMs
    if ($Mode -ceq 'CANARY_DRY_RUN' -and $MaxPosts -ne 1) { throw 'POST_BOUND_REJECTED' }
    Add-Type -AssemblyName System.Net.Http
    $script:CanaryLogPath=Join-Path ([IO.Path]::GetTempPath()) ('pay0-observation-run-'+[Guid]::NewGuid().ToString('N')+'.log')
    foreach ($name in @('CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_APPLICATION_CREDENTIALS')) {
        if ([Environment]::GetEnvironmentVariable($name)) { throw 'AMBIGUOUS_CREDENTIALS' }
    }
    $imp=Invoke-CanaryGcloud @('config','get-value','auth/impersonate_service_account','--quiet')
    if ($imp.Status -ne 0 -or ($imp.Text -and $imp.Text -ne '(unset)')) { throw 'IMPERSONATION_REJECTED' }
    $account=Invoke-CanaryGcloud @('auth','list','--filter=status:ACTIVE','--format=value(account)','--quiet')
    $credential=Invoke-CanaryGcloud @('auth','print-access-token','--quiet')
    if ($account.Status -ne 0 -or $credential.Status -ne 0 -or $credential.Text -cnotmatch '^[A-Za-z0-9._~+/-]{20,8192}={0,2}$') { throw 'OPERATOR_INVALID' }
    $result=Invoke-ObservationRun $account.Text $credential.Text $Mode $ExpectedRevision $MaxPosts $ExpectedOccurredAtMs
    if ($result.Accepted -and $result.CleanupVerified) { $exitCode=0; Write-CanaryStatus 'OBSERVATION_RUN' 'LOGGING_ACCEPTANCE_CONFIRMED' }
    else { Write-CanaryStatus 'OBSERVATION_RUN' 'NOT_CONFIRMED' }
} catch { Write-CanaryStatus 'OBSERVATION_RUN' 'NOT_CONFIRMED' }
finally { $credential=$null; $account=$null }
exit $exitCode
