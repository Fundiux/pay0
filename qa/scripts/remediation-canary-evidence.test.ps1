Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../../services/pay0-sentinel-observation/scripts/verify-canary-observation.ps1'
$tokens=$null; $errors=$null
[void][Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'PARSE_FAILED' }
. $source -LibraryOnly -Execute
function Assert-Local([bool]$Value,[string]$Code) { if (-not $Value) { throw $Code } }
Assert-Local ([bool]$Execute -and [bool]$LibraryOnly) 'IMPORT_FLAGS'
# Generate fixtures from the real TypeScript core, including an actual replay.
# All identities/events here are fixed synthetic canary values; no network/storage SDK.
$nodeFixture=@'
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ts=require('./functions/node_modules/typescript'); const cache=new Map();
function load(file) {
 file=path.resolve(file); if(cache.has(file))return cache.get(file).exports;
 const mod={exports:{}}; cache.set(file,mod);
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInThisContext('(function(require,module,exports){'+js+'\n})',{filename:file})(name=>name==='node:crypto'?crypto:load(path.resolve(path.dirname(file),name+'.ts')),mod,mod.exports);
 return mod.exports;
}
(async()=>{
 const {ObservationDetector}=load('functions/src/modules/sentinel/detector.ts');
 const {digest}=load('functions/src/modules/sentinel/schema.ts');
 const revision='pay0-security-canary-00009-tst', now=Date.now()-1000;
 const eventId='canary_'+crypto.createHash('sha256').update('PAY0-CANARY@2:'+revision+':'+now).digest('hex');
 const raw={schemaVersion:'PAY0-SECURITY-EVENT@1',rootId:'canary-observation-root',actorUid:'canary-observation-actor',eventId,origin:'SERVER_AUTH_DECISION',eventType:'AUTHORIZATION_DENIED',occurredAtMs:now};
 const ingress={rootId:raw.rootId,actorUid:raw.actorUid,publisherId:'pay0-observation-canary-v1',source:'SERVER'};
 const docs=new Map();let receiptKey,incidentKey,root;
 const detector=new ObservationDetector({transact:async(r,fn)=>{root=r;return fn({readReceipt:async k=>docs.get('r'+k)||null,readIncident:async k=>docs.get('i'+k)||null,readQuota:async()=>null,writeQuota:()=>{},createReceipt:(k,v)=>{receiptKey=k;docs.set('r'+k,v)},writeIncident:(k,v)=>{incidentKey=k;docs.set('i'+k,v)}})}},()=>now);
 const first=await detector.ingest(raw,ingress);const replay=await detector.ingest({...raw},ingress);
 if(first.outcome!=='RECORDED'||replay.outcome!=='DUPLICATE')throw Error('CORE_REPLAY_FAILED');
 const before=JSON.stringify([...docs]);const conflict=await detector.ingest({...raw,occurredAtMs:now+1},ingress);
 if(conflict.outcome!=='EVENT_CONTENT_CONFLICT'||JSON.stringify([...docs])!==before)throw Error('CORE_CONFLICT_FAILED');
 function value(x){if(x===null)return {nullValue:null};if(typeof x==='string')return {stringValue:x};if(typeof x==='number')return {integerValue:String(x)};return {mapValue:{fields:Object.fromEntries(Object.entries(x).map(([k,v])=>[k,value(v)]))}}}
 const base='projects/pay0-sentinel-observe/databases/sentinel-observation/documents/sentinelObservationRoots/'+root;
 const receiptName=base+'/receipts/'+receiptKey,incidentName=base+'/incidents/'+incidentKey;
 function document(name,obj){const fields=value(obj).mapValue.fields;fields.expiresAt={timestampValue:new Date(obj.expiresAtMs).toISOString()};return {name,fields}}
 process.stdout.write(JSON.stringify({revision,occurredAtMs:now,receipt:document(receiptName,docs.get('r'+receiptKey)),incident:document(incidentName,docs.get('i'+incidentKey)),expected:{ReceiptName:receiptName,IncidentName:incidentName,PublisherDigest:digest(ingress.publisherId)}}));
})().catch(()=>{process.stderr.write('SYNTHETIC_FIXTURE_FAILED');process.exitCode=1});
'@
Push-Location (Join-Path $PSScriptRoot '../..')
try { $fixtureText=$nodeFixture | node -; if ($LASTEXITCODE -ne 0) { throw 'CORE_FIXTURE_FAILED' }; $fixture=$fixtureText | ConvertFrom-Json }
finally { Pop-Location }
$keys=Get-CanaryEvidenceKeys $fixture.revision $fixture.occurredAtMs
Assert-Local ($keys.ReceiptName -ceq $fixture.expected.ReceiptName -and $keys.IncidentName -ceq $fixture.expected.IncidentName -and $keys.PublisherDigest -ceq $fixture.expected.PublisherDigest) 'KEYS_MATCH_REAL_CORE'
function Wait-EvidencePropagation { $script:Waits++ }
function Invoke-CanaryHttp([string]$Method,[string]$Uri,[string]$Token,$Body,[bool]$ReadJson,[bool]$QuotaProject) {
 $script:Reads++
 Assert-Local ($Method -eq 'GET' -and $null -eq $Body -and $ReadJson -and -not $QuotaProject -and $Token -eq 'synthetic-operator-token') 'READ_ONLY_CONTRACT'
 Assert-Local ($Uri -cin @(('https://firestore.googleapis.com/v1/'+$keys.ReceiptName),('https://firestore.googleapis.com/v1/'+$keys.IncidentName))) 'EXACT_TWO_DOCS_ONLY'
 if ($script:Case -eq 'READ403') { return [pscustomobject]@{Status=403;Data=$null} }
 if ($script:Case -eq 'MISSING' -or ($script:Case -eq 'EVENTUAL' -and $script:Reads -le 2)) { return [pscustomobject]@{Status=404;Data=$null} }
 $doc=$script:Receipt
 if ($Uri.EndsWith($keys.IncidentKey)) { $doc=$script:Incident }
 return [pscustomobject]@{Status=200;Data=$doc}
}
$cases=@('AFTER_REPLAY','EVENTUAL','MISSING','READ403','WRONG_PATH','WRONG_EVENT','WRONG_ROOT','WRONG_ACTOR','COUNT_TWO','AUTHORITY','DECISION','TTL','TYPE','UNKNOWN_FIELD','RECEIPT_LINK','TIME','BINDING','LEGACY_BINDING','EPOCH')
foreach ($case in $cases) {
 $script:Case=$case; $script:Reads=0; $script:Waits=0
 $script:Receipt=($fixture.receipt | ConvertTo-Json -Depth 30) | ConvertFrom-Json
 $script:Incident=($fixture.incident | ConvertTo-Json -Depth 30) | ConvertFrom-Json
 switch ($case) {
  'WRONG_PATH' {$script:Receipt.name+='other'}
  'WRONG_EVENT' {$script:Receipt.fields.eventDigest.stringValue='wrong'}
  'WRONG_ROOT' {$script:Incident.fields.rootId.stringValue='other'}
  'WRONG_ACTOR' {$script:Receipt.fields.event.mapValue.fields.actorUid.stringValue='other'}
  'COUNT_TWO' {$script:Incident.fields.eventCount.integerValue='2'}
  'AUTHORITY' {$script:Incident.fields.authority.stringValue='FINANCIAL'}
  'DECISION' {$script:Incident.fields.decision.stringValue='RESTRICT'}
  'TTL' {$script:Receipt.fields.expiresAt.timestampValue='2020-01-01T00:00:00Z'}
  'TYPE' {$script:Incident.fields.eventCount=[pscustomobject]@{stringValue='1'}}
  'UNKNOWN_FIELD' {$script:Incident.fields | Add-Member -NotePropertyName financialAction -NotePropertyValue ([pscustomobject]@{stringValue='forbidden'})}
  'RECEIPT_LINK' {$script:Receipt.fields.incidentKey.stringValue='wrong'}
  'BINDING' {$script:Receipt.fields.contentDigest.stringValue='bad'}
  'LEGACY_BINDING' {$script:Receipt.fields.PSObject.Properties.Remove('contentDigest');$script:Receipt.fields.PSObject.Properties.Remove('contentBindingVersion')}
  'EPOCH' {$script:Receipt.fields.event.mapValue.fields.occurredAtMs.integerValue=[string]($fixture.occurredAtMs+1)}
  'TIME' {$script:Incident.fields.lastOccurredAtMs.integerValue='1'}
 }
 $valid=Invoke-CanaryEvidenceRead 'synthetic-operator-token' $fixture.revision 3 $fixture.occurredAtMs
 Assert-Local ($valid -eq ($case -in @('AFTER_REPLAY','EVENTUAL'))) ('RESULT_'+$case)
 if ($case -eq 'MISSING') { Assert-Local ($script:Reads -eq 6 -and $script:Waits -eq 2) 'BOUNDED_POLL' }
 elseif ($case -eq 'EVENTUAL') { Assert-Local ($script:Reads -eq 4 -and $script:Waits -eq 1) 'EVENTUAL_READ' }
 else { Assert-Local ($script:Reads -eq 2 -and $script:Waits -eq 0) 'NO_RETRY_INVALID_OR_DENIED' }
}
foreach ($bad in @(@('invalid',1),@($fixture.revision,0),@($fixture.revision,7))) {
 $rejected=$false
 try { $null=Invoke-CanaryEvidenceRead 'fake' $bad[0] $bad[1] $fixture.occurredAtMs } catch { $rejected=$true }
 Assert-Local $rejected 'BAD_INPUT_REJECTED'
}
[Console]::WriteLine('LOCAL_CANARY_EVIDENCE:PASS_24_CASES_NO_REMOTE_CALLS')
