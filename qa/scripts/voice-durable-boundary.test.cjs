const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('../../functions/node_modules/typescript');
const base=path.resolve(__dirname,'../../functions/src/modules/agent007');
function load(relative,deps){const file=path.join(base,relative),m=new Module(file,module);m.filename=file;m.paths=module.paths;m.require=name=>{assert(Object.hasOwn(deps,name),'UNEXPECTED_DEPENDENCY');return deps[name];};m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return m.exports;}
const memory=load('hugoCore/memoryContract.ts',{});
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const api=load('conversationCorrections.ts',{'node:crypto':require('node:crypto'),'firebase-functions/v2/https':{HttpsError},'../../utils/authGuard':{assertAuthorized:()=>{throw Error('UNEXPECTED_AUTH_PATH');}},'./hugoCore/memoryContract':memory});
for(const rememberFor of [{kind:'CLIENT'},{kind:'TOPIC',label:'Tema demo'}])test('current VOICE '+rememberFor.kind+' durable request is rejected before any database access',async()=>{
 let reads=0,resolves=0;const db={doc:()=>{reads++;throw Error('UNEXPECTED_DATABASE');},runTransaction:()=>{reads++;throw Error('UNEXPECTED_TRANSACTION');}};
 await assert.rejects(api.persistConversationCorrection(db,{uid:'actor',rootId:'root',conversationId:'root_actor_global',sourceKind:'VOICE',sourceId:'response_demo',sessionId:'session_demo',content:'Indicación personal sintética',expectedVersion:0,rememberFor},async()=>{resolves++;throw Error('UNEXPECTED_RESOLVER');}),e=>e.code==='invalid-argument');
 assert.equal(reads,0);assert.equal(resolves,0);
});
test('VOICE cannot omit its session identity even when asking for durable scope',async()=>{
 let touched=false;await assert.rejects(api.persistConversationCorrection({doc:()=>{touched=true;}},{uid:'actor',rootId:'root',conversationId:'root_actor_global',sourceKind:'VOICE',sourceId:'response_demo',content:'Indicación sintética',expectedVersion:0,rememberFor:{kind:'TOPIC',label:'Demo'}},async()=>{touched=true;}),e=>e.code==='invalid-argument');assert.equal(touched,false);
});

const topicInput={uid:'actor',rootId:'root',sessionId:'session_demo',correctionTurnId:'turn_demo',rememberFor:{kind:'TOPIC',label:'  Facturas   M\u00e9xico '}};
const proof={ownerUid:'actor',rootId:'root',sessionId:'session_demo',correctionTurnId:'turn_demo',confirmationTurnId:'confirm_demo',label:'facturas Me\u0301xico',confirmed:true,transcriptAuthority:'CLIENT_TRANSCRIPT_NOT_FACT'};
test('voice topic preparation is OFF by default and cannot be enabled by a truthy non-boolean',()=>{
 for(const enabled of [undefined,false,'true',1])assert.throws(()=>api.validateVoicePersonalTopic(topicInput,proof,enabled),e=>e.code==='failed-precondition');
});
test('explicitly enabled validator reuses exact canonical topic normalization and owner binding',()=>{
 const topic=api.validateVoicePersonalTopic(topicInput,proof,true);assert.deepEqual(topic,api.explicitCorrectionTopic(topicInput.rememberFor.label));
 assert.notEqual(api.correctionBindingId('root','actor',topic),api.correctionBindingId('root','other',topic));
 assert.notEqual(api.correctionBindingId('root','actor',topic),api.correctionBindingId('other','actor',topic));
});
test('unconfirmed, foreign, stale-session and unsupported confirmation provenance are rejected',()=>{
 for(const patch of [{confirmed:false},{confirmed:'true'},{ownerUid:'other'},{rootId:'other'},{sessionId:'other'},{correctionTurnId:'other'},{confirmationTurnId:''},{confirmationTurnId:'turn_demo'},{transcriptAuthority:'MODEL_GUESS'}])assert.throws(()=>api.validateVoicePersonalTopic(topicInput,{...proof,...patch},true),e=>e.code==='permission-denied');
});
test('different or fuzzy topic and client-from-transcript never pass the preparation seam',()=>{
 assert.throws(()=>api.validateVoicePersonalTopic(topicInput,{...proof,label:'Facturas Mexico Norte'},true),e=>e.code==='failed-precondition');
 assert.throws(()=>api.validateVoicePersonalTopic({...topicInput,rememberFor:{kind:'CLIENT',id:'browser-choice'}},proof,true),e=>e.code==='invalid-argument');
 assert.throws(()=>api.validateVoicePersonalTopic({...topicInput,rememberFor:{kind:'TOPIC',label:''}},proof,true),e=>e.code==='invalid-argument');
});
