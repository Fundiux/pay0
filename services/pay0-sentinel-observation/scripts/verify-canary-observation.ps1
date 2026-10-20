[CmdletBinding()]
param([switch]$Execute,[switch]$LibraryOnly,[string]$ExpectedRevision='',[long]$ExpectedOccurredAtMs=0,[ValidateRange(1,6)][int]$MaxAttempts=3)
$evidenceExecute=$Execute; $evidenceLibrary=$LibraryOnly
. (Join-Path $PSScriptRoot 'verify-canary-runtime.ps1') -LibraryOnly
$Execute=$evidenceExecute; $LibraryOnly=$evidenceLibrary

function Get-EvidenceSha256([string]$Text) {
    $hash=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant() }
    finally { $hash.Dispose() }
}
function Get-EvidenceDigest($Value) { return Get-EvidenceSha256 (ConvertTo-Json -InputObject $Value -Depth 10 -Compress) }
function Get-CanaryEvidenceKeys([string]$Revision,[long]$OccurredAtMs) {
    if (([string]$OccurredAtMs) -cnotmatch '^[1-9][0-9]{12}$') { throw 'EVENT_EPOCH_REQUIRED' }
    if ($Revision -cnotmatch '^pay0-security-canary-[0-9]{5}-[a-z0-9]{3}$') { throw 'REVISION_REQUIRED' }
    $root='canary-observation-root'; $actor='canary-observation-actor'; $publisher='pay0-observation-canary-v1'
    $policy='PAY0-SENTINEL-SHADOW@1'; $origin='SERVER_AUTH_DECISION'; $eventType='AUTHORIZATION_DENIED'
    $eventId='canary_'+(Get-EvidenceSha256 ('PAY0-CANARY@2:'+$Revision+':'+([string]$OccurredAtMs)))
    $eventDigest=Get-EvidenceDigest @($publisher,$actor,$eventId)
    $rootDigest=Get-EvidenceDigest $root
    $receiptKey=Get-EvidenceDigest @($policy,$origin,$eventDigest)
    $incidentKey=Get-EvidenceDigest @($policy,$origin,$actor,$eventType,$eventDigest)
    $base='projects/pay0-sentinel-observe/databases/sentinel-observation/documents/sentinelObservationRoots/'+$rootDigest
    return [pscustomobject]@{OccurredAtMs=$OccurredAtMs;Root=$root;Actor=$actor;PublisherDigest=(Get-EvidenceDigest $publisher);EventDigest=$eventDigest;
        IncidentKey=$incidentKey;ReceiptName=($base+'/receipts/'+$receiptKey);IncidentName=($base+'/incidents/'+$incidentKey)}
}
function Read-EvidenceField($Fields,[string]$Name,[string]$Type) {
    $value=Get-CanaryProperty $Fields $Name
    if ($null -eq $value -or @($value.PSObject.Properties).Count -ne 1 -or -not $value.PSObject.Properties[$Type]) { throw 'FIELD_TYPE_INVALID' }
    $data=Get-CanaryProperty $value $Type
    switch ($Type) {
        'stringValue' { if ($data -isnot [string]) { throw 'STRING_REQUIRED' }; return $data }
        'integerValue' {
            if ($data -isnot [string] -or $data -cnotmatch '^(0|[1-9][0-9]{0,15})$') { throw 'INTEGER_REQUIRED' }
            $number=[long]::Parse($data)
            if ($number -gt 9007199254740991) { throw 'SAFE_INTEGER_REQUIRED' }
            return $number
        }
        'mapValue' { $map=Get-CanaryProperty $data 'fields'; if ($null -eq $map) { throw 'MAP_REQUIRED' }; return $map }
        'nullValue' { if ($null -ne $data -and $data -cne 'NULL_VALUE') { throw 'NULL_REQUIRED' }; return $null }
        'timestampValue' {
            if ($data -isnot [string]) { throw 'TIMESTAMP_REQUIRED' }
            return [DateTimeOffset]::Parse($data).ToUnixTimeMilliseconds()
        }
        default { throw 'FIELD_TYPE_REJECTED' }
    }
}
function Assert-EvidenceKeys($Fields,[string[]]$Names) {
    $actual=@($Fields.PSObject.Properties.Name | Sort-Object)
    $wanted=@($Names | Sort-Object)
    if (($actual -join ',') -cne ($wanted -join ',')) { throw 'FIELD_SET_INVALID' }
}
function Assert-EvidenceText($Fields,[string]$Name,[string]$Expected) {
    if ((Read-EvidenceField $Fields $Name 'stringValue') -cne $Expected) { throw 'FIELD_VALUE_INVALID' }
}
function Assert-CanaryEvidence($Receipt,$Incident,$Keys,[long]$NowMs) {
    if ((Get-CanaryProperty $Receipt 'name') -cne $Keys.ReceiptName -or (Get-CanaryProperty $Incident 'name') -cne $Keys.IncidentName) { throw 'DOCUMENT_PATH_MISMATCH' }
    $receiptFields=Get-CanaryProperty $Receipt 'fields'; $incidentFields=Get-CanaryProperty $Incident 'fields'
    Assert-EvidenceKeys $receiptFields @('contentBindingVersion','contentDigest','eventDigest','event','incidentKey','observedAtMs','expiresAtMs','expiresAt')
    Assert-EvidenceKeys $incidentFields @('policyVersion','decision','authority','reason','recovery','rootId','actorUid','origin','eventType','status','eventCount','firstOccurredAtMs','lastOccurredAtMs','lastObservedAtMs','evidence','expiresAtMs','expiresAt')
    Assert-EvidenceText $receiptFields 'eventDigest' $Keys.EventDigest
    Assert-EvidenceText $receiptFields 'incidentKey' $Keys.IncidentKey
    $event=Read-EvidenceField $receiptFields 'event' 'mapValue'
    Assert-EvidenceKeys $event @('schemaVersion','rootId','actorUid','publisherDigest','eventDigest','intentionDigest','attemptDigest','effectDigest','origin','eventType','occurredAtMs')
    Assert-EvidenceText $event 'schemaVersion' 'PAY0-SECURITY-EVENT@1'
    $evidence=Read-EvidenceField $incidentFields 'evidence' 'mapValue'
    Assert-EvidenceKeys $evidence @('eventDigest','publisherDigest','intentionDigest','attemptDigest','effectDigest')
    foreach ($fields in @($event,$evidence)) {
        Assert-EvidenceText $fields 'eventDigest' $Keys.EventDigest
        Assert-EvidenceText $fields 'publisherDigest' $Keys.PublisherDigest
        foreach ($name in @('intentionDigest','attemptDigest','effectDigest')) { $null=Read-EvidenceField $fields $name 'nullValue' }
    }
    foreach ($fields in @($event,$incidentFields)) {
        Assert-EvidenceText $fields 'rootId' $Keys.Root
        Assert-EvidenceText $fields 'actorUid' $Keys.Actor
        Assert-EvidenceText $fields 'origin' 'SERVER_AUTH_DECISION'
        Assert-EvidenceText $fields 'eventType' 'AUTHORIZATION_DENIED'
    }
    foreach ($pair in @(@('policyVersion','PAY0-SENTINEL-SHADOW@1'),@('decision','OBSERVE_ONLY'),@('authority','NONE'),@('reason','SERVER_AUTHORIZATION_SIGNAL'),@('recovery','HUMAN_REVIEW_ONLY'),@('status','OPEN_OBSERVATION'))) {
        Assert-EvidenceText $incidentFields $pair[0] $pair[1]
    }
    if ((Read-EvidenceField $incidentFields 'eventCount' 'integerValue') -ne 1) { throw 'EVENT_COUNT_NOT_ONE' }
    $occurred=Read-EvidenceField $event 'occurredAtMs' 'integerValue'
    if ($occurred -ne $Keys.OccurredAtMs) { throw 'EVENT_EPOCH_MISMATCH' }
    Assert-EvidenceText $receiptFields 'contentBindingVersion' 'PAY0-EVENT-CONTENT@1'
    $binding=Get-EvidenceDigest @('PAY0-EVENT-CONTENT@1','PAY0-SECURITY-EVENT@1',$Keys.Root,$Keys.Actor,$Keys.PublisherDigest,$Keys.EventDigest,$null,$null,$null,'SERVER_AUTH_DECISION','AUTHORIZATION_DENIED',[long]$occurred)
    Assert-EvidenceText $receiptFields 'contentDigest' $binding
    $observed=Read-EvidenceField $receiptFields 'observedAtMs' 'integerValue'
    if ($occurred -lt ($NowMs-86400000) -or $occurred -gt ($observed+60000) -or $observed -gt $NowMs -or
        (Read-EvidenceField $incidentFields 'firstOccurredAtMs' 'integerValue') -ne $occurred -or
        (Read-EvidenceField $incidentFields 'lastOccurredAtMs' 'integerValue') -ne $occurred -or
        (Read-EvidenceField $incidentFields 'lastObservedAtMs' 'integerValue') -ne $observed) { throw 'TIME_STATE_INVALID' }
    foreach ($row in @(@($receiptFields,172800000),@($incidentFields,604800000))) {
        $expiry=Read-EvidenceField $row[0] 'expiresAtMs' 'integerValue'
        if ($expiry -ne ($observed+$row[1]) -or $expiry -le $NowMs -or (Read-EvidenceField $row[0] 'expiresAt' 'timestampValue') -ne $expiry) { throw 'TTL_INVALID' }
    }
}
function Wait-EvidencePropagation { Start-Sleep -Seconds 10 }
function Invoke-CanaryEvidenceRead([string]$OperatorToken,[string]$Revision,[int]$Attempts=3,[long]$OccurredAtMs=0) {
    if ($Attempts -lt 1 -or $Attempts -gt 6) { throw 'READ_BOUND_REJECTED' }
    $keys=Get-CanaryEvidenceKeys $Revision $OccurredAtMs
    $receipt=$null; $incident=$null
    try {
        for ($i=1; $i -le $Attempts; $i++) {
            # These are the only remote operations: two exact GETs, no listing/query/mint/writes.
            $receipt=Invoke-CanaryHttp 'GET' ('https://firestore.googleapis.com/v1/'+$keys.ReceiptName) $OperatorToken $null $true $false
            $incident=Invoke-CanaryHttp 'GET' ('https://firestore.googleapis.com/v1/'+$keys.IncidentName) $OperatorToken $null $true $false
            Write-CanaryStatus 'RECEIPT_HTTP' ([string]$receipt.Status)
            Write-CanaryStatus 'INCIDENT_HTTP' ([string]$incident.Status)
            if ($receipt.Status -eq 200 -and $incident.Status -eq 200) {
                Assert-CanaryEvidence $receipt.Data $incident.Data $keys ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
                Write-CanaryStatus 'CANARY_EVIDENCE' 'OBSERVE_ONLY_SINGLE_EVENT_VERIFIED'
                return $true
            }
            if ($receipt.Status -notin @(200,404) -or $incident.Status -notin @(200,404)) { throw 'READ_FAILED' }
            if ($i -lt $Attempts) { Wait-EvidencePropagation }
        }
        Write-CanaryStatus 'CANARY_EVIDENCE' 'NOT_YET_PRESENT'
        return $false
    } catch { Write-CanaryStatus 'CANARY_EVIDENCE' 'NOT_VERIFIED'; return $false }
    finally { $receipt=$null; $incident=$null; $OperatorToken=$null; $keys=$null }
}

if ($LibraryOnly) { return }
if (-not $Execute) { Write-CanaryStatus 'MODE' 'DRY_RUN_NO_REMOTE_CALLS'; return }
$exitCode=1
try {
    $null=Get-CanaryEvidenceKeys $ExpectedRevision $ExpectedOccurredAtMs
    Add-Type -AssemblyName System.Net.Http
    foreach ($name in @('CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_APPLICATION_CREDENTIALS')) {
        if ([Environment]::GetEnvironmentVariable($name)) { throw 'AMBIGUOUS_CREDENTIALS' }
    }
    $imp=Invoke-CanaryGcloud @('config','get-value','auth/impersonate_service_account','--quiet')
    if ($imp.Status -ne 0 -or ($imp.Text -and $imp.Text -ne '(unset)')) { throw 'IMPERSONATION_REJECTED' }
    $account=Invoke-CanaryGcloud @('auth','list','--filter=status:ACTIVE','--format=value(account)','--quiet')
    if ($account.Status -ne 0 -or $account.Text -cnotmatch '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' -or $account.Text.EndsWith('.gserviceaccount.com')) { throw 'USER_OPERATOR_REQUIRED' }
    $credential=Invoke-CanaryGcloud @('auth','print-access-token','--quiet')
    if ($credential.Status -ne 0 -or $credential.Text -cnotmatch '^[A-Za-z0-9._~+/-]{20,8192}={0,2}$') { throw 'OPERATOR_INVALID' }
    if (Invoke-CanaryEvidenceRead $credential.Text $ExpectedRevision $MaxAttempts $ExpectedOccurredAtMs) { $exitCode=0 }
} catch { Write-CanaryStatus 'CANARY_EVIDENCE' 'NOT_VERIFIED' }
finally { $credential=$null; $account=$null }
exit $exitCode
