import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';
import{memoryCredential,boundedJson,PROJECT}from'./remediation-document-inventory-bootstrap.mjs';
import{selectBootstrapRoot}from'./remediation-document-inventory-rest.mjs';import{FAMILIES}from'./remediation-document-inventory.mjs';
export const COUNT_LIMIT=10001;
export function countQuery(family,rootId=null){assert.ok(FAMILIES.includes(family));if(rootId!==null)assert.ok(typeof rootId==='string'&&rootId.length>0&&rootId.length<=180&&!/[\/\\\x00-\x1f]/.test(rootId));return{structuredAggregationQuery:{structuredQuery:{from:[{collectionId:family}],...(rootId===null?{}:{where:{fieldFilter:{field:{fieldPath:'rootId'},op:'EQUAL',value:{stringValue:rootId}}}})},aggregations:[{alias:'documentCount',count:{upTo:String(COUNT_LIMIT)}}]}};}
export async function countDocuments({rootId,credential,fetchImpl=fetch}){
 assert.ok(typeof rootId==='string'&&rootId.length>0);countQuery('uploads',rootId);let queries=0;const counts={};
 for(const family of FAMILIES){counts[family]={};for(const scope of ['total','selectedRoot']){
  assert.ok(queries<6);const token=await credential.getAccessToken();let response;queries++;
  try{response=await fetchImpl(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runAggregationQuery`,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(countQuery(family,scope==='total'?null:rootId)),signal:AbortSignal.timeout(30000),redirect:'error'});}catch{throw Error('AGGREGATE_READ_FAILED');}
  const result=await boundedJson(response);assert.ok(Array.isArray(result)&&result.length<=10);const rows=result.filter(item=>item.result);assert.equal(rows.length,1,'One final aggregation required');const raw=rows[0].result.aggregationFields?.documentCount?.integerValue;assert.match(raw||'',/^\d+$/);const value=Number(raw);assert.ok(Number.isSafeInteger(value)&&value>=0&&value<=COUNT_LIMIT);counts[family][scope]={count:value,cappedPossible:value>=COUNT_LIMIT};
 }}
 return{mode:'AGGREGATE_READ_ONLY',project:PROJECT,queries,countLimit:COUNT_LIMIT,maxCountedDocuments:6*COUNT_LIMIT,rootHash:createHash('sha256').update(rootId).digest('hex'),counts,compatibilityClosure:false};
}
export async function main(args){let execute=false,bootstrap=null,index=0;for(let i=0;i<args.length;i++){if(args[i]==='--execute-counts-read-only'){execute=true;continue;}if(args[i]==='--bootstrap'&&args[i+1]){assert.equal(bootstrap,null);bootstrap=args[++i];continue;}if(args[i]==='--root-index'&&args[i+1]){index=Number(args[++i]);continue;}throw Error('INVALID_OPTIONS');}assert.ok(Number.isInteger(index)&&index>=0);
 if(!execute){console.log(JSON.stringify({mode:'DRY_RUN',project:PROJECT,families:FAMILIES,rootIndex:index,maxQueries:6,countLimit:COUNT_LIMIT,maxCountedDocuments:6*COUNT_LIMIT,aggregations:['countTotalCapped','countSelectedRootCapped'],indexScanUnbounded:false,noNetwork:true,noCredential:true}));return;}
 assert.ok(bootstrap&&!process.env.FIRESTORE_EMULATOR_HOST);process.env.DEBUG='';const file=path.resolve(bootstrap),base=path.resolve('.firebase/document-inventory')+path.sep;assert.ok(file.startsWith(base)&&file.endsWith('.json'));const rootId=selectBootstrapRoot(JSON.parse(fs.readFileSync(file,'utf8')),index);console.log(JSON.stringify({...await countDocuments({rootId,credential:memoryCredential()}),rootIndex:index}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(()=>{console.error(JSON.stringify({error:'AGGREGATE_INVENTORY_FAILED',detailsRedacted:true,productionWrites:false}));process.exitCode=1;});
