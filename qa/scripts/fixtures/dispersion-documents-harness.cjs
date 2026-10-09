// Actual authorization, restriction and delegation modules; only infrastructure faked.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const compiled=new Map();
class HttpsError extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details;}}
exports.setup=function setup(){
 const rows=new Map([['users/u',{role:'superadmin',rootId:'r',active:true}],['clientDispersions/d',{rootId:'r',clientId:'c'}],['clients/c',{rootId:'r',active:true,adminId:'u'}],['uploads/x',{rootId:'r',dispersionId:'d',entityId:'d',entityType:'clientDispersions',storagePath:'roots/r/dispersiones/d/docs/COMPROBANTE_DISPERSION/x-file.pdf',sizeBytes:20,contentType:'application/pdf',documentType:'COMPROBANTE_DISPERSION',status:'PENDING',active:false,version:null}]]);
 let audits=0,writesCount=0,hook=null,txHook=null,queue=Promise.resolve(),metadataReads=0;
 const object={name:rows.get('uploads/x').storagePath,bucket:'fake-bucket',generation:'123',metageneration:'1',size:'20',contentType:'application/pdf'};
 const snapshot=p=>({exists:rows.has(p),data:()=>structuredClone(rows.get(p)),ref:ref(p),id:p.split('/').at(-1)});
 function ref(p){return{path:p,id:p.split('/').at(-1),get:async()=>snapshot(p)};}
 function collection(name,filters=[]){return{doc:(id='new')=>ref(name+'/'+id),where:(...f)=>collection(name,[...filters,f]),filters,name};}
 const db={doc:ref,collection,runTransaction:fn=>{const run=queue.then(async()=>{if(txHook){const f=txHook;txHook=null;f();}let writes=[],events=[];const tx={get:async q=>{assert.equal(writes.length,0,'read after write');return q.path?snapshot(q.path):{docs:[...rows.keys()].filter(p=>p.startsWith(q.name+'/')&&q.filters.every(([k,op,v])=>{assert.equal(op,'==');return rows.get(p)[k]===v;})).map(snapshot)};},update:(r,v)=>writes.push([r.path,v,false]),create:(r,v)=>writes.push([r.path,v,true]),events};const value=await fn(tx);for(const[p,v,create]of writes){if(create)assert.equal(rows.has(p),false);rows.set(p,{...rows.get(p),...v});}writesCount+=writes.length;audits+=events.length;return value;});queue=run.catch(()=>{});return run;}};
 const firestore=()=>db;firestore.FieldValue={serverTimestamp:()=>123};
 const admin={apps:[{}],firestore,storage:()=>({bucket:()=>({name:'fake-bucket',file:()=>({getMetadata:async()=>{metadataReads++;if(hook){const fn=hook;hook=null;fn();}return[structuredClone(object)];}})})})};
 const cache=new Map();
 function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const out={};const deps={'crypto':require('node:crypto'),'firebase-admin':admin,'firebase-admin/firestore':require('node:module').createRequire(path.resolve('functions/package.json'))('firebase-admin/firestore'),'firebase-functions':{logger:{info(){},error(){}},https:{HttpsError}},'firebase-functions/v2/https':{HttpsError},'../../utils/logActivity':{logActivityTx:(tx,_db,e)=>tx.events.push(e),logActivity:async()=>{throw Error('UNEXPECTED_EVENT');}},'../telegram/service':{sendTelegramMessage:async()=>{throw Error('MESSAGE_FORBIDDEN');},sendTelegramDocumentBuffer:async()=>{throw Error('MESSAGE_FORBIDDEN');}}};
 const source=fs.readFileSync(file,'utf8'),key=file+':'+require('node:crypto').createHash('sha256').update(source).digest('hex');
 if(!compiled.has(key))compiled.set(key,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
 const code=compiled.get(key);
 new Function('exports','require',code)(out,n=>{if(Object.hasOwn(deps,n))return deps[n];assert.ok(n.startsWith('.'),'unexpected import '+n);return load(path.resolve(path.dirname(file),n+'.ts'));});cache.set(file,out);return out;}
 const api=load('functions/src/modules/dispersionDocuments/service.ts');
 const request=data=>({auth:{uid:'u'},data});
 return{rows,object,call:()=>api.finalizeDispersionDocumentUploadCore(request({uploadId:'x',storagePath:rows.get('uploads/x').storagePath})),init:()=>api.initDispersionDocumentUploadCore(request({dispersionId:'d',originalName:'file.pdf',sizeBytes:20,contentType:'application/pdf'})),deactivate:()=>api.deactivateDispersionDocumentCore(request({uploadId:'x'})),get audits(){return audits;},get writes(){return writesCount;},get metadataReads(){return metadataReads;},race:fn=>hook=fn,txRace:fn=>txHook=fn};
};
