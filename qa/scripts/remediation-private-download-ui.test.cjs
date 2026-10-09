const assert=require('node:assert/strict'),fs=require('node:fs');
const ts=require('../../functions/node_modules/typescript');
function load(file,deps){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(exports,name=>{assert(name in deps,name);return deps[name];});return exports;}
let timers=[],pagehide,created=[],revoked=[],calls=[],mode='ok';
const CHUNK=8*1024*1024,total=CHUNK+13;
global.window={setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},addEventListener:(event,fn)=>{assert.equal(event,'pagehide');pagehide=fn;}};
URL.createObjectURL=blob=>{created.push(blob);return `blob:https://pay-0-system.web.app/${created.length}`;};
URL.revokeObjectURL=url=>revoked.push(url);
const actor={uid:'actor',getIdToken:async()=> 'synthetic'};
const firebase={app:{options:{projectId:'demo-private-documents'}},auth:{currentUser:actor}};
process.env.NEXT_PUBLIC_USE_EMULATORS='false';
global.fetch=async(url,options)=>{
 assert.equal(url,'https://us-central1-demo-private-documents.cloudfunctions.net/streamPrivateDocument');
 assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');
 assert.equal(options.headers.Authorization,'Bearer synthetic');
 const input=JSON.parse(options.body);calls.push(input);assert(!('storagePath'in input));
 if(mode==='deny-second'&&input.offset>0)return new Response(JSON.stringify({error:{code:'permission-denied'}}),{status:403});
 if(mode==='switch-user')firebase.auth.currentUser={uid:'other'};
 const next=Math.min(input.offset+CHUNK,total),revision=mode==='changed-revision'&&input.offset>0?'b'.repeat(64):'a'.repeat(64);
 return new Response(new Blob([new Uint8Array(next-input.offset-(mode==='truncated'?1:0))]),{status:206,headers:{'X-Document-Size':String(total),'X-Document-Offset':String(input.offset),'X-Document-Next-Offset':String(next),'X-Document-Revision':revision,'Content-Type':'application/pdf'}});
};
const actions=load('src/lib/authorizedDocumentAction.ts',{});
const client=load('src/lib/downloadPrivateDocument.ts',{'@/lib/firebaseClient':firebase,'./authorizedDocumentAction':actions});
(async()=>{
 const url=await client.downloadPrivateDocument('uploads','doc');assert.equal(created.length,1);assert.equal(created[0].size,total);assert.equal(calls.length,2);assert.equal(calls[0].revision,undefined);assert.equal(calls[1].revision,'a'.repeat(64));assert(client.isPrivateDocumentUrl(url));
 let delivered=false;await actions.runAuthorizedDocumentAction('doc',async()=>url,async actual=>{assert.equal(actual,url);delivered=true;});assert(delivered);
 await assert.rejects(actions.runAuthorizedDocumentAction('doc',async()=> 'blob:https://pay-0-system.web.app/forged',()=>{}));
 client.releasePrivateDocumentUrl(url);assert(!client.isPrivateDocumentUrl(url));assert.deepEqual(revoked,[url]);
 for(const current of ['deny-second','changed-revision','truncated','switch-user']){mode=current;calls=[];firebase.auth.currentUser=actor;const count=created.length;await assert.rejects(client.downloadPrivateDocument('uploads','doc'));assert.equal(created.length,count,'partial bytes must not be exposed');}
 mode='ok';firebase.auth.currentUser=actor;const second=await client.downloadPrivateDocument('assetDocuments','asset');assert(client.isPrivateDocumentUrl(second));pagehide();assert(!client.isPrivateDocumentUrl(second));
 for(const file of ['src/lib/uploadSolicitudDoc.ts','src/lib/uploadDispersionDoc.ts','src/lib/uploadEntityDocument.ts','src/components/EntityDocumentsPanel.tsx','src/app/assets/documents/page.tsx'])assert(!fs.readFileSync(file,'utf8').includes('getDownloadURL'),file);
 assert(!fs.readFileSync('functions/src/index.ts','utf8').includes('export { streamPrivateDocument }'),'endpoint remains unexported before rollout approval');
 console.log('PASS private document UI: authenticated POST chunk assembly, local URL registry/release, no partial blob after revocation/generation/truncation/account change, consumers remove direct URL generation, endpoint unexported');
})().catch(error=>{console.error(error);process.exitCode=1;});
