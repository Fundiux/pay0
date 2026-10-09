const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Readable,Writable}=require('node:stream');const {EventEmitter}=require('node:events');
const {createRequire}=require('node:module'),fr=createRequire(path.resolve('functions/package.json')),ts=fr('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {HttpsError}=fr('firebase-functions/v2/https');
const guard=require('../../functions/src/utils/authGuard.ts'),policy=require('../../functions/src/modules/clientDelegations/policy.ts');
const rows=new Map();let revisionMs=1;
const db={doc:path=>({path,get:async()=>snapshot(path)}),runTransaction:fn=>fn({get:async ref=>snapshot(ref.path)})};
const snapshot=key=>({exists:rows.has(key),id:key.split('/').at(-1),ref:{path:key},data:()=>rows.get(key),updateTime:{toMillis:()=>revisionMs}});
const admin={apps:[{}],firestore:()=>db};
function load(file,deps){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(exports,name=>{assert(name in deps,name);return deps[name];});return exports;}
const access=load('functions/src/modules/clientDelegations/access.ts',{'firebase-admin':admin,'firebase-functions/v2/https':{HttpsError},'./policy':policy,'../../utils/authGuard':guard});
const funding=load('functions/src/modules/financing/dispersionFunding.ts',{'firebase-functions/v2/https':{HttpsError}});
const resolver=load('functions/src/modules/documents/downloadAccess.ts',{'firebase-admin':admin,'node:crypto':crypto,'firebase-functions/v2/https':{HttpsError},'../../utils/authGuard':guard,'../clientDelegations/access':access,'../financing/dispersionFunding':funding});
const http=load('functions/src/modules/documents/documentDownloadHttp.ts',{'firebase-admin':admin,'node:crypto':crypto,'node:stream':require('node:stream'),'node:stream/promises':require('node:stream/promises'),'firebase-functions/v2/https':{HttpsError,onRequest:(_opts,fn)=>fn},'./downloadAccess':resolver});
const chunk=http.PRIVATE_DOCUMENT_CHUNK_BYTES;
class ResponseMock extends Writable{
 constructor(){super();this.headers={};this.statusCode=200;this.parts=[];this.headersSent=false;}
 setHeader(k,v){this.headers[k.toLowerCase()]=String(v);}removeHeader(k){delete this.headers[k.toLowerCase()];}status(code){this.statusCode=code;return this;}
 json(value){this.setHeader('Content-Type','application/json');this.end(JSON.stringify(value));return this;}
 _write(data,_encoding,done){this.headersSent=true;this.parts.push(Buffer.from(data));done();}
 get bytes(){return Buffer.concat(this.parts);}
}
let size,generation,streams,metadataHook,revoked,streamMode,resolveCount,verifyCount;
const objectPath='roots/root/pagos/payment/receipt.pdf';
function reset(){rows.clear();revisionMs=1;size=25*1024*1024;generation='123';streams=resolveCount=verifyCount=0;metadataHook=null;revoked=false;streamMode='normal';
 rows.set('users/root',{role:'superadmin',rootId:'root',active:true});
 for(const uid of ['a','b'])rows.set(`users/${uid}`,{role:'admin',rootId:'root',active:true,modules:{pagos:{view:true},solicitudes:{view:true},wallet:{dispersiones:true},usuarios:{clientDelegations:true}},systemAccess:{assets:true}});
 rows.set('clients/client',{rootId:'root',active:true,adminId:'root'});
 rows.set('userClientAccess/a/clients/client',{active:true,grantedBy:'root',permissions:{view:true,operate:true}});
 rows.set('userClientAccess/b/clients/client',{active:true,grantedBy:'a',permissions:{view:true,operate:true}});
 rows.set('pagos/payment',{rootId:'root',clientId:'client'});
 rows.set('uploads/document',{rootId:'root',entityType:'pagos',pagoId:'payment',active:true,status:'READY',storagePath:objectPath,originalName:'receipt.pdf'});
}
const deps={verifyToken:async token=>{verifyCount++;if(revoked||token!=='synthetic')throw Error('revoked');return{uid:'b'};},resolve:async(uid,input)=>{resolveCount++;return resolver.resolveAuthorizedDocumentObject(uid,input,db);},metadata:async()=>{if(metadataHook){const hook=metadataHook;metadataHook=null;hook();}return{generation,size,contentType:'application/pdf'};},stream:(path,gen,start,end)=>{streams++;assert.equal(path,objectPath);assert.equal(gen,generation);const length=end-start+1;assert(length<=chunk);if(streamMode==='error')return new Readable({read(){this.destroy(Error('SYNTHETIC_STREAM_FAILURE'));}});return Readable.from([Buffer.alloc(length+(streamMode==='long'?1:streamMode==='short'?-1:0),7)]);}};
async function call(body={family:'uploads',documentId:'document'},changes={}){const req=Object.assign(new EventEmitter(),{method:'POST',headers:{origin:'https://pay-0-system.web.app',authorization:'Bearer synthetic'},body,query:{}},changes);const res=new ResponseMock();await http.streamPrivateDocumentCore(req,res,deps);return res;}
(async()=>{
 reset();let result=await call();assert.equal(result.statusCode,206);assert.equal(result.bytes.length,chunk);const rev=result.headers['x-document-revision'];assert.equal(resolveCount,2);assert.equal(streams,1);
 for(let offset=chunk;offset<size;offset+=chunk){result=await call({family:'uploads',documentId:'document',offset,revision:rev});assert.equal(result.statusCode,206);assert.equal(result.bytes.length,Math.min(chunk,size-offset));}
 assert.equal(streams,4);assert.equal(verifyCount,4);
 reset();result=await call();rows.get('userClientAccess/a/clients/client').active=false;result=await call({family:'uploads',documentId:'document',offset:chunk,revision:result.headers['x-document-revision']});assert.equal(result.statusCode,403);assert.equal(streams,1);
 reset();metadataHook=()=>{rows.get('users/b').disabled=true;};result=await call();assert.equal(result.statusCode,403);assert.equal(streams,0);
 reset();result=await call();generation='124';result=await call({family:'uploads',documentId:'document',offset:chunk,revision:result.headers['x-document-revision']});assert.equal(result.statusCode,409);assert.equal(streams,1);
 reset();revoked=true;result=await call();assert.equal(result.statusCode,401);assert.equal(resolveCount,0);
 for(const body of [{family:'uploads',documentId:'../secret'},{family:'other',documentId:'document'},{family:'uploads',documentId:'document',storagePath:'arbitrary'},{family:'uploads',documentId:'document',offset:1},{family:'uploads',documentId:'document',offset:chunk}]){reset();assert.equal((await call(body)).statusCode,400);assert.equal(streams,0);}
 reset();result=await call(undefined,{headers:{origin:'https://evil.invalid',authorization:'Bearer synthetic'}});assert.equal(result.statusCode,403);assert.equal(verifyCount,0);
 reset();assert.equal((await call(undefined,{method:'GET'})).statusCode,405);
 reset();rows.get('uploads/document').storagePath='roots/foreign/pagos/payment/receipt.pdf';assert.equal((await call()).statusCode,409);
 reset();rows.get('uploads/document').status='PENDING';assert.equal((await call()).statusCode,409);assert.equal(streams,0);
 reset();rows.get('users/b').trustedRestrictionV1={};assert.equal((await call()).statusCode,403);assert.equal(streams,0);
 reset();result=await call(undefined,{aborted:true});assert.equal(streams,0);
 reset();rows.get('pagos/payment').deletedAt=1;assert.equal((await call()).statusCode,403);
 for(const mode of ['long','short','error']){reset();size=10;streamMode=mode;result=await call();assert.equal(result.destroyed,true);}
 reset();size=http.PRIVATE_DOCUMENT_MAX_BYTES+1;assert.equal((await call()).statusCode,413);assert.equal(streams,0);
 reset();rows.set('assetDocuments/asset',{rootId:'root',ownerUid:'b',status:'ACTIVE',storagePath:'roots/root/assets/b/documents/asset/file.pdf'});
 assert.equal((await resolver.resolveAuthorizedDocumentObject('b',{family:'assetDocuments',documentId:'asset'},db)).storagePath,'roots/root/assets/b/documents/asset/file.pdf');
 await assert.rejects(resolver.resolveAuthorizedDocumentObject('root',{family:'assetDocuments',documentId:'asset'},db),e=>e.code==='permission-denied');
 rows.set('entityDocuments/entity',{rootId:'root',entityType:'CLIENTE',entityId:'client',documentType:'RFC',status:'ACTIVE',uploadStatus:'FINALIZED',storagePath:'roots/root/entityDocuments/CLIENTE/client/RFC/file.pdf'});
 await resolver.resolveAuthorizedDocumentObject('root',{family:'entityDocuments',documentId:'entity'},db);
 await assert.rejects(resolver.resolveAuthorizedDocumentObject('b',{family:'entityDocuments',documentId:'entity'},db),e=>e.code==='permission-denied');
 reset();rows.set('clientDispersions/disp',{rootId:'root',clientId:'client',ownerUid:'b',fundingSource:{holderType:'USER',ownerUid:'b',sourceClientId:'client'}});rows.set('uploads/dispdoc',{rootId:'root',entityType:'clientDispersions',dispersionId:'disp',active:true,status:'READY',storagePath:'roots/root/dispersiones/disp/file.pdf'});
 await resolver.resolveAuthorizedDocumentObject('b',{family:'uploads',documentId:'dispdoc'},db);
 await assert.rejects(resolver.resolveAuthorizedDocumentObject('a',{family:'uploads',documentId:'dispdoc'},db),e=>e.code==='permission-denied');
 console.log('PASS private document backend: 25MiB/4 chunks, transitive revocation between chunks, revoke during metadata, generation mismatch, revoked token, forged references, scope/lifecycle, size and truncated/error streams, entity/asset/USER funding boundaries');
})().catch(error=>{console.error(error);process.exitCode=1;});
