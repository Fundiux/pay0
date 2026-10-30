// Local default: no network. Execute: --execute-readonly [--limit 1000].
// OAuth only from stdin or PAY0_DRAIN_OAUTH_TOKEN; never argv or output.
// Query contract: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runQuery
// Projection: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const CUTOFF = '2026-10-09T21:20:00.000Z';
const URL = 'https://firestore.googleapis.com/v1/projects/pay-0-system/databases/(default)/documents:runQuery';
const PREFIX = 'projects/pay-0-system/databases/(default)/documents/telegramActionTokens/';
const FIELDS = ['createdAt','expiresAt','transportVersion','storageGeneration'];
const fail = () => { throw new Error('DRAIN_EVIDENCE_UNAVAILABLE'); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
export function queryFor(limit = 1000) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) fail();
  return { structuredQuery: {
    select: { fields: FIELDS.map(fieldPath => ({ fieldPath })) },
    from: [{ collectionId: 'telegramActionTokens', allDescendants: false }],
    where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: CUTOFF } } },
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }], limit: limit + 1,
  } };
}
function timestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) return null;
  const millis = Date.parse(match[1] + 'Z');
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0,19) !== match[1]) return null;
  // Round upwards: submillisecond expiry must never be declared expired early.
  return millis + Math.ceil(Number((match[2] || '').padEnd(9,'0')) / 1e6);
}
function scalar(field, type) { return plain(field) && Object.keys(field).length === 1 && Object.hasOwn(field,type) ? field[type] : undefined; }
export function aggregateDrain(rows, { limit=1000, nowMs=Date.now() } = {}) {
  queryFor(limit);
  if (!Number.isSafeInteger(nowMs) || nowMs < Date.parse(CUTOFF) || !Array.isArray(rows) || !rows.length || rows.length > limit + 20) fail();
  const result = { scope: 'CREATED_AT_WINDOW_ONLY', cutoff: CUTOFF, observedAt: new Date(nowMs).toISOString(), complete: true,
    documents: 0, version: { absent:0,v1:0,v2:0,invalid:0 }, generation: { absent:0,valid:0,invalid:0 },
    malformedTimestamps: 0, inconsistentTimestamps: 0, legacyWithoutGeneration: 0, legacyWithoutValidGeneration: 0,
    unexpiredLegacyWithoutValidGeneration: 0, maxExpiresAtLegacyWithoutGeneration: null, maxExpiresAtLegacyWithoutValidGeneration: null,
    oldRevisionInstances: 'NOT_MEASURED', olderOrMissingCreatedAtNotCovered: true, drainGate: 'NOT_CERTIFIED', window: 'UNKNOWN' };
  const names = new Set(); let maxMissing = null, maxInvalid = null, lastRead = null;
  for (const row of rows) {
    if (!plain(row) || Object.keys(row).some(key => !['document','readTime','skippedResults','done'].includes(key)) ||
        (row.skippedResults !== undefined && row.skippedResults !== 0) || (row.done !== undefined && row.done !== true)) fail();
    const readTime=timestamp(row.readTime);
    if (readTime === null || readTime < nowMs-120_000 || readTime > nowMs+60_000 || (lastRead !== null && readTime < lastRead)) fail();
    lastRead=readTime;
    if (!Object.hasOwn(row,'document')) continue;
    const doc=row.document;
    if (!plain(doc) || typeof doc.name !== 'string' || !doc.name.startsWith(PREFIX) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(doc.name.slice(PREFIX.length)) || names.has(doc.name) ||
        !plain(doc.fields) || Object.keys(doc.fields).some(key=>!FIELDS.includes(key))) fail();
    names.add(doc.name); result.documents++;
    const fields=doc.fields;
    const version=!Object.hasOwn(fields,'transportVersion') ? 'absent' : scalar(fields.transportVersion,'integerValue')==='1' ? 'v1' : scalar(fields.transportVersion,'integerValue')==='2' ? 'v2' : 'invalid';
    const gen=scalar(fields.storageGeneration,'stringValue');
    const generation=!Object.hasOwn(fields,'storageGeneration') ? 'absent' : typeof gen==='string' && /^[0-9]{1,128}$/.test(gen) ? 'valid' : 'invalid';
    result.version[version]++; result.generation[generation]++;
    const created=timestamp(scalar(fields.createdAt,'timestampValue')), expires=timestamp(scalar(fields.expiresAt,'timestampValue'));
    if (created===null || expires===null) result.malformedTimestamps++;
    else if (created<Date.parse(CUTOFF) || created>nowMs+60_000 || expires<=created || expires-created>900000) result.inconsistentTimestamps++;
    const legacy=version==='absent'||version==='v1';
    if (legacy && generation==='absent') { result.legacyWithoutGeneration++; if(expires!==null)maxMissing=Math.max(maxMissing??0,expires); }
    if (legacy && generation!=='valid') {
      result.legacyWithoutValidGeneration++;
      if(expires!==null) { maxInvalid=Math.max(maxInvalid??0,expires); if(expires>nowMs)result.unexpiredLegacyWithoutValidGeneration++; }
    }
  }
  result.complete=result.documents<=limit;
  if(maxMissing!==null)result.maxExpiresAtLegacyWithoutGeneration=new Date(maxMissing).toISOString();
  if(maxInvalid!==null)result.maxExpiresAtLegacyWithoutValidGeneration=new Date(maxInvalid).toISOString();
  result.readTime=new Date(lastRead).toISOString();
  result.window = !result.complete ? 'TRUNCATED' : result.malformedTimestamps || result.inconsistentTimestamps || result.version.invalid || result.generation.invalid ? 'INVALID_DATA' :
    result.unexpiredLegacyWithoutValidGeneration ? 'LEGACY_NOT_EXPIRED' : 'WINDOW_CLEAR_CONDITIONAL';
  return result;
}
export async function collectDrain({ token, limit=1000, now=Date.now, fetchImpl=fetch } = {}) {
  const body=queryFor(limit);
  if(typeof token!=='string'||!/^[A-Za-z0-9._~+/-]{20,8192}={0,2}$/.test(token))fail();
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  let response, reader;
  try {
    response=await fetchImpl(URL,{method:'POST',redirect:'error',signal:controller.signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(response.status!==200) { await response.body?.cancel(); return {scope:'CREATED_AT_WINDOW_ONLY',complete:false,drainGate:'NOT_CERTIFIED',window:'HTTP_ERROR',httpStatus:Number.isInteger(response.status)?response.status:0,oldRevisionInstances:'NOT_MEASURED'}; }
    if(!response.body)fail();
    reader=response.body.getReader();const chunks=[];let bytes=0;
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8*1024*1024)fail();chunks.push(Buffer.from(value));}
    const rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
    return aggregateDrain(rows,{limit,nowMs:now()});
  } catch { return {scope:'CREATED_AT_WINDOW_ONLY',complete:false,drainGate:'NOT_CERTIFIED',window:'READ_OR_SCHEMA_ERROR',oldRevisionInstances:'NOT_MEASURED'}; }
  finally { clearTimeout(timer);controller.abort();await reader?.cancel().catch(()=>{});token=null; }
}
async function readToken() {
  if(process.env.PAY0_DRAIN_OAUTH_TOKEN){const token=process.env.PAY0_DRAIN_OAUTH_TOKEN;delete process.env.PAY0_DRAIN_OAUTH_TOKEN;return token.trim();}
  if(process.stdin.isTTY)fail();
  return new Promise((resolve,reject)=>{
    let value='';const timer=setTimeout(()=>{process.stdin.destroy();reject(Error('TOKEN_INPUT_UNAVAILABLE'));},5000);
    process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{value+=chunk;if(value.length>8194){clearTimeout(timer);process.stdin.destroy();reject(Error('TOKEN_INPUT_UNAVAILABLE'));}});
    process.stdin.on('end',()=>{clearTimeout(timer);resolve(value.trim());value='';});
    process.stdin.on('error',()=>{clearTimeout(timer);reject(Error('TOKEN_INPUT_UNAVAILABLE'));});
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(!args.length){console.log(JSON.stringify({mode:'DRY_RUN_NO_REMOTE_CALLS',scope:'CREATED_AT_WINDOW_ONLY',cutoff:CUTOFF,limit:1000,drainGate:'NOT_CERTIFIED',oldRevisionInstances:'NOT_MEASURED'}));}
    else{
      if(args[0]!=='--execute-readonly'||![1,3].includes(args.length)||(args.length===3&&(args[1]!=='--limit'||!/^\d{1,4}$/.test(args[2]))))fail();
      const limit=args.length===3?Number(args[2]):1000;queryFor(limit);
      const result=await collectDrain({token:await readToken(),limit});console.log(JSON.stringify(result));
      if(result.window!=='WINDOW_CLEAR_CONDITIONAL')process.exitCode=2;
    }
  }catch{console.log(JSON.stringify({complete:false,window:'INPUT_OR_SETUP_ERROR',drainGate:'NOT_CERTIFIED'}));process.exitCode=2;}
}
