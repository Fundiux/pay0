'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),Module=require('node:module'),fs=require('node:fs'),path=require('node:path');
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
class Ref { constructor(db,p){this.db=db;this.path=p;this.id=p.split('/').at(-1);} collection(n){return new Query(this.db,this.path+'/'+n);} async get(){return this.db.snap(this);} }
class Query { constructor(db,p,filters=[],after=null,max=Infinity){Object.assign(this,{db,path:p,filters,after,max});} doc(id=crypto.randomUUID()){return new Ref(this.db,this.path+'/'+id);} where(k,op,v){assert.equal(op,'==');return new Query(this.db,this.path,[...this.filters,[k,v]],this.after,this.max);} orderBy(){return this;} limit(n){return new Query(this.db,this.path,this.filters,this.after,n);} startAfter(id){return new Query(this.db,this.path,this.filters,id,this.max);} }
class DB {
 constructor(){this.rows=new Map();this.version=0;this.log=[];}
 doc(p){return new Ref(this,p);} collection(p){return new Query(this,p);}
 seed(p,v){this.rows.set(p,clone(v));this.version++;} data(p){return clone(this.rows.get(p));}
 snap(ref){return {ref,id:ref.id,exists:this.rows.has(ref.path),data:()=>this.data(ref.path)};}
 read(ref){if(ref instanceof Ref)return this.snap(ref);const docs=[...this.rows.keys()].filter(p=>p.startsWith(ref.path+'/')&&!p.slice(ref.path.length+1).includes('/')).sort().filter(p=>(!ref.after||p.split('/').at(-1)>ref.after)&&ref.filters.every(([k,v])=>this.rows.get(p)[k]===v)).slice(0,ref.max).map(p=>this.snap(this.doc(p)));return {docs,size:docs.length,empty:!docs.length};}
 async runTransaction(fn){for(let attempt=0;attempt<25;attempt++){const start=this.version,writes=[];let wrote=false;const tx={get:async ref=>{assert(!wrote,'READ_AFTER_WRITE');return this.read(ref);},create:(ref,data)=>{wrote=true;writes.push(['create',ref,data]);},set:(ref,data,opt)=>{wrote=true;writes.push([opt?.merge?'merge':'set',ref,data]);},update:(ref,data)=>{wrote=true;writes.push(['update',ref,data]);}};let result=await fn(tx);if(start!==this.version)continue;const next=new Map(this.rows);for(const [kind,ref,data]of writes){if(kind==='create')assert(!next.has(ref.path),'ALREADY_EXISTS');if(kind==='update')assert(next.has(ref.path),'NOT_FOUND');next.set(ref.path,kind==='merge'||kind==='update'?{...clone(next.get(ref.path)),...clone(data)}:clone(data));}this.rows=next;if(writes.length)this.version++;this.log.push(...writes.map(w=>w[1].path));return result;}throw Error('RETRY_LIMIT');}
}
const db=new DB();class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const original=Module._load;
Module._load=function(name,parent,isMain){if(name==='../pagos/domain'&&parent?.filename.endsWith('sharedCallables'+path.sep+'helpers.js'))return {}; if(name==='firebase-admin/app')return {getApps:()=>[{}],initializeApp:()=>({})};if(name==='firebase-admin/firestore')return {getFirestore:()=>db,FieldValue:{serverTimestamp:()=>({serverTime:true})},FieldPath:{documentId:()=> '__name__'}};if(name==='firebase-functions/v2/https')return {HttpsError,onCall:(_opts,fn)=>Object.assign(fn,{run:fn})};if(name==='firebase-functions')return {https:{HttpsError}};return original.call(this,name,parent,isMain);};
const {WhatsAppConnectorAuthority}=require('../../functions/lib/modules/documentDelivery/whatsappConnectorAuthority.js');
const endpoints=require('../../functions/lib/modules/documentDelivery/whatsappConnectorCallables.js');
const policy=require('../../functions/lib/modules/documentDelivery/whatsappConnectorPolicy.js');
const {createWorkerKey,createAuthorityTransport}=require('../../tools/whatsapp-qr-connector/connectorAuthority.cjs');
const {runEnrolledConnector}=require('../../tools/whatsapp-qr-connector/enrolledConnector.cjs');
const audits=[],service=new WhatsAppConnectorAuthority(db,{},async entry=>{audits.push(entry);}),cases=[];
const user={role:'superadmin',rootId:'root-a',active:true};db.seed('users/owner-a',user);db.seed('users/owner-b',{...user,rootId:'root-b'});
const req=(uid='owner-a',data={})=>({auth:{uid},data});
const test=async(name,fn)=>{await fn();cases.push(name);};
const rejection=async(fn)=>assert.rejects(fn);
const signing=(key,text)=>crypto.sign(null,Buffer.from(text),key).toString('base64url');
const key=createWorkerKey();let enrollment,binding,transport,fetches=0;
const fakeFetch=async(url,options)=>{fetches++;const body=JSON.parse(options.body),name=url.split('/').at(-1);let result;if(name==='consumeWhatsAppConnectorEnrollment')result=await service.consume(body.data);else result=await service.operate(body.data.envelope,body.data.data);return {ok:true,json:async()=>({result})};};
(async()=>{
 await test('unauthenticated-human-endpoints-denied',async()=>{for(const name of ['createWhatsAppConnectorEnrollment','revokeWhatsAppConnectorBinding','getWhatsAppConnectorBinding'])await rejection(()=>endpoints[name].run({data:{publicKeyPem:key.publicKeyPem}}));});
 await test('operator-cannot-enroll',async()=>{db.seed('users/operator',{role:'operador',rootId:'root-a'});await rejection(()=>service.create(req('operator',{publicKeyPem:key.publicKeyPem})));});
 await test('canonical-inactive-owner-denied',async()=>{db.seed('users/inactive',{...user,active:false});await rejection(()=>service.create(req('inactive',{publicKeyPem:key.publicKeyPem})));});
 await test('server-owned-enrollment-root-and-expiry',async()=>{const r=await service.create(req('owner-a',{publicKeyPem:key.publicKeyPem,rootId:'root-b'}));enrollment=r.enrollment;assert.equal(enrollment.rootId,'root-a');assert.equal(enrollment.ownerUid,'owner-a');assert(enrollment.expiresAtMs-enrollment.createdAtMs<=600000);assert.equal(r.externalAccountVerified,false);});
 await test('wrong-worker-proof-does-not-consume',async()=>{const other=createWorkerKey();await rejection(()=>service.consume({enrollmentId:enrollment.id,signature:signing(other.privateKeyPem,policy.enrollmentSigningText(enrollment))}));assert.equal(db.data('whatsappQrConnectorEnrollments/'+enrollment.id).state,'PENDING');});
 await test('owner-revocation-before-consume-denied',async()=>{db.seed('users/owner-a',{...user,active:false});await rejection(()=>service.consume({enrollmentId:enrollment.id,signature:signing(key.privateKeyPem,policy.enrollmentSigningText(enrollment))}));db.seed('users/owner-a',user);});
 await test('owner-root-change-before-consume-denied',async()=>{db.seed('users/owner-a',{...user,rootId:'root-b'});await rejection(()=>service.consume({enrollmentId:enrollment.id,signature:signing(key.privateKeyPem,policy.enrollmentSigningText(enrollment))}));db.seed('users/owner-a',user);});
 await test('transport-enrollment-possession-real-ed25519',async()=>{transport=createAuthorityTransport({baseUrl:'https://authority.invalid',privateKeyPem:key.privateKeyPem,policy,fetchImpl:fakeFetch});const r=await transport.consume(enrollment);binding=r.binding;assert.equal(binding.rootId,'root-a');assert.equal(db.data('whatsappQrConnectorEnrollments/'+enrollment.id).state,'CONSUMED');});
 await test('enrollment-one-effect-idempotent-receipt-recovery',async()=>{const before=db.log.length;const r=await service.consume({enrollmentId:enrollment.id,signature:signing(key.privateKeyPem,policy.enrollmentSigningText(enrollment))});assert.equal(r.binding.id,binding.id);assert.equal(r.recoveredReceipt,true);assert.equal(db.log.length,before);assert.equal([...db.rows.keys()].filter(p=>p.startsWith('whatsappQrConnectorBindings/')&&!p.slice(28).includes('/')).length,1);});
 await test('concurrent-consumed-receipt-recovery-no-mutation',async()=>{const proof={enrollmentId:enrollment.id,signature:signing(key.privateKeyPem,policy.enrollmentSigningText(enrollment))};const before=db.log.length;const r=await Promise.all([service.consume(proof),service.consume(proof)]);assert.equal(r[0].binding.id,r[1].binding.id);assert.equal(db.log.length,before);});
 await test('consumed-proof-tamper-rejected',async()=>{await rejection(()=>service.consume({enrollmentId:enrollment.id,signature:signing(key.privateKeyPem,'tamper')}));});
 await test('expired-enrollment-cannot-consume',async()=>{const k=createWorkerKey(),r=await service.create(req('owner-b',{publicKeyPem:k.publicKeyPem}));const stale={...r.enrollment,createdAtMs:Date.now()-700000,expiresAtMs:Date.now()-100000};db.seed('whatsappQrConnectorEnrollments/'+stale.id,stale);await rejection(()=>service.consume({enrollmentId:stale.id,signature:signing(k.privateKeyPem,policy.enrollmentSigningText(stale))}));assert.equal(db.data('whatsappQrConnectorEnrollments/'+stale.id).state,'PENDING');});
 await test('active-binding-cannot-silently-replace',()=>rejection(()=>service.create(req('owner-a',{publicKeyPem:key.publicKeyPem}))));
 await test('cross-owner-revocation-denied',()=>rejection(()=>service.revoke(req('owner-b',{bindingId:binding.id}))));
 await test('heartbeat-is-display-not-authority',async()=>{await rejection(()=>transport.operate('HEARTBEAT',{ready:true,poll:false,rootId:'root-b'}));const r=await transport.operate('HEARTBEAT',{ready:true,poll:false});assert.equal(r.rootId,'root-a');assert.equal(db.data('whatsappQrConnectors/'+binding.id).externalAccountVerified,false);});
 const make=(action,data)=>{const unsigned={bindingId:binding.id,generation:binding.generation,action,nonce:crypto.randomBytes(32).toString('hex'),issuedAtMs:Date.now(),dataHash:policy.canonicalDataHash(data)};return {...unsigned,signature:signing(key.privateKeyPem,policy.operationSigningText(unsigned))};};
 await test('concurrent-replay-exactly-one-effect',async()=>{const data={ready:true,poll:false},e=make('HEARTBEAT',data);const results=await Promise.allSettled([service.operate(e,data),service.operate(e,data)]);assert.equal(results.filter(v=>v.status==='fulfilled').length,1);});
 await test('payload-mutation-rejected',async()=>{const data={ready:true,poll:false},e=make('HEARTBEAT',data);await rejection(()=>service.operate(e,{ready:false,poll:false}));await service.operate(e,data);});
 await test('old-generation-rejected',async()=>{const data={ready:true,poll:false},e=make('HEARTBEAT',data);e.generation=2;await rejection(()=>service.operate(e,data));});
 await test('periodic-sync-without-enrollment-denied',async()=>{const t=createAuthorityTransport({baseUrl:'https://authority.invalid',privateKeyPem:key.privateKeyPem,policy,fetchImpl:fakeFetch});await rejection(()=>t.synchronize([]));});
 await test('sync-root-scoped-legacy-and-cross-root-quarantine',async()=>{db.seed('whatsappQrChats/legacy',{chatId:'legacy',name:'Historical',active:true});db.seed('whatsappQrChats/foreign',{rootId:'root-b',bindingId:'other',name:'Foreign',active:true});db.seed('whatsappQrChats/stale',{rootId:'root-a',bindingId:binding.id,name:'Stale',active:true});db.seed('whatsappQrChats/other-binding',{rootId:'root-a',bindingId:'other',name:'Other session',active:true});const r=await transport.synchronize([{chatId:'new',name:'New'},{chatId:'legacy',name:'Attempted'},{chatId:'foreign',name:'Attempted'}]);assert.equal(r.written,1);assert.equal(r.quarantined,2);assert.equal(db.data('whatsappQrChats/new').rootId,'root-a');assert.equal(db.data('whatsappQrChats/legacy').name,'Historical');assert.equal(db.data('whatsappQrChats/foreign').active,true);assert.equal(db.data('whatsappQrChats/other-binding').active,true);assert.equal(db.data('whatsappQrChats/stale').active,false);});
 await test('tampered-command-owner-rejected-before-claim',async()=>{db.seed('whatsappQrConnectorCommands/tampered',{bindingId:binding.id,generation:1,rootId:'root-b',requestedByUid:'owner-a',type:'NEW_QR',status:'PENDING'});await rejection(()=>transport.operate('HEARTBEAT',{ready:true,poll:true}));assert.equal(db.data('whatsappQrConnectorCommands/tampered').status,'PENDING');db.rows.delete('whatsappQrConnectorCommands/tampered');db.version++;});
 await test('existing-qr-endpoint-enqueues-server-binding',async()=>{const r=await service.enqueue(req(),'NEW_QR');const c=db.data('whatsappQrConnectorCommands/'+r.commandId);assert.equal(c.bindingId,binding.id);assert.equal(c.rootId,'root-a');assert.equal(c.generation,1);});
 let resetCommand;
 await test('new-qr-requires-own-claimed-command',async()=>{await rejection(()=>transport.operate('NEW_QR',{commandId:'invented'}));const r=await transport.operate('HEARTBEAT',{ready:false,poll:true});resetCommand=r.command.id;assert.equal(r.command.type,'NEW_QR');const done=await transport.operate('NEW_QR',{commandId:resetCommand});assert.equal(done.resetAuthorized,true);await rejection(()=>transport.operate('NEW_QR',{commandId:resetCommand}));});
 await test('command-sync-completes-through-same-server-scope',async()=>{const c=await service.enqueue(req(),'SYNC_CHATS');const h=await transport.operate('HEARTBEAT',{ready:true,poll:true});assert.equal(h.command.id,c.commandId);await transport.synchronize([{chatId:'new',name:'Updated'}],c.commandId);assert.equal(db.data('whatsappQrConnectorCommands/'+c.commandId).status,'DONE');});
 await test('restart-is-superadmin-only-audited-and-one-per-press',async()=>{
  await rejection(()=>service.enqueue(req('operator'),'RESTART'));
  await rejection(()=>service.enqueue({data:{}},'RESTART'));
  await rejection(()=>endpoints.requestWhatsAppConnectorRestart.run({data:{}}));
  await rejection(()=>endpoints.requestWhatsAppConnectorRestart.run(req('operator')));
  await rejection(()=>service.enqueue(req('owner-b'),'RESTART'));
  assert.equal(audits.length,0,'a denied request leaves no restart behind');
  const before=db.data('whatsappQrConnectorBindings/'+binding.id);
  const first=await service.enqueue(req(),'RESTART');
  assert.equal(first.type,'RESTART');assert.equal(first.status,'PENDING');assert.equal(first.binding,undefined,'the binding is not echoed to the browser');
  const stored=db.data('whatsappQrConnectorCommands/'+first.commandId);
  assert.equal(stored.bindingId,binding.id);assert.equal(stored.requestedByUid,'owner-a');assert.equal(stored.rootId,'root-a');assert.equal(stored.type,'RESTART');
  assert.equal(audits.length,1);assert.equal(audits[0].event,'WHATSAPP_CONECTOR_REINICIO_SOLICITADO');assert.equal(audits[0].actorUid,'owner-a');assert.equal(audits[0].rootId,'root-a');assert.match(audits[0].description,/reiniciar el conector de WhatsApp/);
  const again=await service.enqueue(req(),'RESTART');
  assert.equal(again.commandId,first.commandId);assert.equal(again.duplicate,true,'a second press is the same restart');assert.equal(audits.length,1,'and is audited once');
  const commands=[...db.rows.keys()].filter(path=>path.startsWith('whatsappQrConnectorCommands/')&&db.data(path).type==='RESTART'&&db.data(path).status==='PENDING');
  assert.equal(commands.length,1);
  // The connector gets it even when WhatsApp is not ready (a stuck connector is the reason to restart it), confirms once, and the session is kept.
  const beat=await transport.operate('HEARTBEAT',{ready:false,poll:true});
  assert.equal(beat.command.type,'RESTART');assert.equal(beat.command.id,first.commandId);
  assert.equal(db.data('whatsappQrConnectorCommands/'+first.commandId).status,'PROCESSING');
  await rejection(()=>transport.operate('RESTART_ACK',{commandId:'invented'}));
  await rejection(()=>transport.operate('RESTART_ACK',{commandId:first.commandId,extra:true}));
  const ack=await transport.operate('RESTART_ACK',{commandId:first.commandId});
  assert.equal(ack.restartAcknowledged,true);assert.equal(ack.commandId,first.commandId);
  assert.equal(db.data('whatsappQrConnectorCommands/'+first.commandId).status,'DONE');assert.match(db.data('whatsappQrConnectorCommands/'+first.commandId).outcome,/SESSION_KEPT/);
  assert.equal(db.data('whatsappQrConnectors/'+binding.id).lastCommandType,'RESTART');assert.equal(db.data('whatsappQrConnectors/'+binding.id).lastCommandStatus,'DONE');
  await rejection(()=>transport.operate('RESTART_ACK',{commandId:first.commandId}));
  assert.equal(audits.at(-1).event,'WHATSAPP_CONECTOR_REINICIADO');assert.equal(audits.length,2);
  assert.deepEqual(db.data('whatsappQrConnectorBindings/'+binding.id),before,'a restart never touches the binding or its generation');
  const next=await service.enqueue(req(),'RESTART');assert.notEqual(next.commandId,first.commandId,'after it is done a new restart is a new command');
  const beat2=await transport.operate('HEARTBEAT',{ready:true,poll:true});await transport.operate('RESTART_ACK',{commandId:beat2.command.id});
 });
 await test('heartbeat-says-when-a-ready-connector-last-spoke-and-only-ready-beats-move-it',async()=>{
  const first=await transport.operate('HEARTBEAT',{ready:false,poll:false});assert.ok(first.previousReadyAtMs===null||Number.isSafeInteger(first.previousReadyAtMs));
  const before=Date.now();await transport.operate('HEARTBEAT',{ready:true,poll:false});
  const afterReady=await transport.operate('HEARTBEAT',{ready:false,poll:false});assert.ok(Number.isSafeInteger(afterReady.previousReadyAtMs)&&afterReady.previousReadyAtMs>=before,'a ready beat is remembered');
  const again=await transport.operate('HEARTBEAT',{ready:false,poll:false});assert.equal(again.previousReadyAtMs,afterReady.previousReadyAtMs,'a connector that is not ready does not move it: a failing restart loop cannot hide an outage');
  assert.equal(db.data('whatsappQrConnectors/'+binding.id).lastReadyAtMs,afterReady.previousReadyAtMs);
 });
 await test('restart-goes-before-other-pending-commands',async()=>{
  const sync=await service.enqueue(req(),'SYNC_CHATS'),restart=await service.enqueue(req(),'RESTART');
  const h1=await transport.operate('HEARTBEAT',{ready:true,poll:true});assert.equal(h1.command.id,restart.commandId,'a restart is not kept waiting behind a sync');
  await transport.operate('RESTART_ACK',{commandId:restart.commandId});
  const h2=await transport.operate('HEARTBEAT',{ready:true,poll:true});assert.equal(h2.command.id,sync.commandId);
  await transport.synchronize([{chatId:'new',name:'Updated'}],sync.commandId);assert.equal(db.data('whatsappQrConnectorCommands/'+sync.commandId).status,'DONE');
 });
 await test('tampered-restart-command-is-rejected-before-claim',async()=>{
  db.seed('whatsappQrConnectorCommands/tampered-restart',{bindingId:binding.id,generation:1,rootId:'root-b',requestedByUid:'owner-a',type:'RESTART',status:'PENDING'});
  await rejection(()=>transport.operate('HEARTBEAT',{ready:true,poll:true}));
  db.rows.delete('whatsappQrConnectorCommands/tampered-restart');
 });
 await test('qr-ready-ack-does-not-claim-external-account',async()=>{await transport.operate('HEARTBEAT',{ready:false,poll:false,status:'QR_REQUIRED',qrText:'synthetic-qr',qrDataUrl:'data:image/png;base64,synthetic',resetCommandId:resetCommand});const command=db.data('whatsappQrConnectorCommands/'+resetCommand);assert.equal(command.status,'DONE');assert.equal(command.outcome,'LOCAL_QR_AVAILABLE_NOT_ACCOUNT_OWNERSHIP');});
 await test('owner-inactive-invalidates-live-binding',async()=>{db.seed('users/owner-a',{...user,active:false});await rejection(()=>transport.operate('HEARTBEAT',{ready:true,poll:false}));db.seed('users/owner-a',user);});
 await test('binding-revocation-blocks-every-following-operation',async()=>{await service.revoke(req('owner-a',{bindingId:binding.id}));for(const [action,data]of [['HEARTBEAT',{ready:true,poll:false}],['NEW_QR',{commandId:resetCommand}],['SYNC_CHATS',{phase:'BEGIN',syncId:crypto.randomUUID()}]])await rejection(()=>transport.operate(action,data));assert.equal(db.data('whatsappQrConnectorBindings/'+binding.id).generation,2);await rejection(()=>service.consume({enrollmentId:enrollment.id,signature:signing(key.privateKeyPem,policy.enrollmentSigningText(enrollment))}));});
 await test('client-no-retry-after-unknown-result',async()=>{let calls=0;const t=createAuthorityTransport({baseUrl:'https://authority.invalid',privateKeyPem:key.privateKeyPem,binding,policy,fetchImpl:async()=>{calls++;throw Error('LOST_RESPONSE');}});await rejection(()=>t.operate('HEARTBEAT',{ready:true,poll:false}));assert.equal(calls,1);});
 await test('connector-import-has-no-startup-or-message-effects',async()=>{let initialized=0,destroyed=0,reset=0;const callbacks={},timers=[];const client={on:(name,cb)=>{callbacks[name]=cb;},initialize:async()=>{initialized++;},destroy:async()=>{destroyed++;},getChats:async()=>[]};const calls=[];const t={getBinding:()=>binding,operate:async(action,data)=>{calls.push([action,data]);return {command:null};},synchronize:async()=>({written:0,quarantined:0})};const running=await runEnrolledConnector({transport:t,client,encodeQr:async()=>'',resetLocalSession:async()=>reset++,setTimer:fn=>{timers.push(fn);return fn;},clearTimer:()=>{}});assert.equal(initialized,1);assert.equal(calls[0][0],'HEARTBEAT');assert.equal(calls[0][1].ready,false);await callbacks.message('hello');assert.equal(reset,0);await running.stop();assert.equal(destroyed,1);});
 await test('pending-qr-stays-visible-in-every-heartbeat',async()=>{const callbacks={},timers=[],calls=[];const client={on:(name,cb)=>{callbacks[name]=cb;},initialize:async()=>{},destroy:async()=>{},getChats:async()=>[]};const t={getBinding:()=>binding,operate:async(action,data)=>{calls.push([action,data]);return {command:null};},synchronize:async()=>({written:0,quarantined:0})};const running=await runEnrolledConnector({transport:t,client,encodeQr:async q=>'data:image/png;base64,'+q,resetLocalSession:async()=>{},setTimer:fn=>{timers.push(fn);return fn;},clearTimer:()=>{}});const beats=async()=>{calls.length=0;for(const fn of timers)await fn();return calls.filter(([a,d])=>a==='HEARTBEAT'&&d.poll===true).map(([,d])=>d);};assert.ok((await beats()).every(d=>d.status===undefined),'no QR before WhatsApp asks for one');await callbacks.qr('synthetic-qr');for(const d of await beats()){assert.equal(d.status,'QR_REQUIRED');assert.equal(d.qrText,'https://wa.me/settings/linked_devices#synthetic-qr','the QR is published as the linked-devices link phones accept');assert.equal(d.qrDataUrl,'data:image/png;base64,https://wa.me/settings/linked_devices#synthetic-qr');assert.equal(d.resetCommandId,undefined);}await callbacks.authenticated();assert.ok((await beats()).every(d=>d.status===undefined&&d.qrText===undefined),'scanned QR is no longer repeated');await running.stop();});
 await test('idle-qr-restarts-for-a-fresh-one',async()=>{const callbacks={},timers=[];let clock=1_000_000,stoppedWith=null;const client={on:(name,cb)=>{callbacks[name]=cb;},initialize:async()=>{},destroy:async()=>{},getChats:async()=>[]};const t={getBinding:()=>binding,operate:async()=>({command:null}),synchronize:async()=>({written:0,quarantined:0})};await runEnrolledConnector({transport:t,client,encodeQr:async q=>'data:'+q,resetLocalSession:async()=>{},setTimer:fn=>{timers.push(fn);return fn;},clearTimer:()=>{},now:()=>clock,onStopped:r=>{stoppedWith=r;}});const tick=async()=>{for(const fn of timers)await fn();};await callbacks.qr('https://wa.me/settings/linked_devices#q1');clock+=3*60*1000;await tick();assert.equal(stoppedWith,null,'a rotating QR keeps waiting');await callbacks.qr('q2');clock+=3*60*1000;await tick();assert.equal(stoppedWith,null,'each new QR restarts the idle clock');clock+=61*1000;await tick();assert.equal(stoppedWith,'QR_IDLE','four minutes without a new QR restarts the connector');});
 await test('restart-command-confirms-then-closes-keeping-the-session',async()=>{
  const callbacks={},timers=[],calls=[];let stoppedWith=null,destroyed=0,resets=0;
  const client={on:(name,cb)=>{callbacks[name]=cb;},initialize:async()=>{},destroy:async()=>{destroyed++;},getChats:async()=>[]};
  const t={getBinding:()=>binding,operate:async(action,data)=>{calls.push(action);if(action==='HEARTBEAT'&&data.poll===true)return {command:{id:'c1',type:'RESTART'}};if(action==='RESTART_ACK')return {restartAcknowledged:true,commandId:data.commandId};return {};},synchronize:async()=>({written:0,quarantined:0})};
  await runEnrolledConnector({transport:t,client,encodeQr:async q=>q,resetLocalSession:async()=>{resets++;},setTimer:fn=>{timers.push(fn);return fn;},clearTimer:()=>{},onStopped:r=>{stoppedWith=r;}});
  for(const fn of timers)await fn();
  assert.ok(calls.includes('RESTART_ACK'),'it tells the server before closing');assert.equal(stoppedWith,'RESTART_REQUESTED');assert.equal(destroyed,1);assert.equal(resets,0,'the WhatsApp session is not reset');
  // A receipt that does not match is not a restart: it fails like any other bad answer.
  let stopped2=null;const bad={...t,operate:async(action,data)=>{if(action==='HEARTBEAT'&&data.poll===true)return {command:{id:'c2',type:'RESTART'}};if(action==='RESTART_ACK')return {restartAcknowledged:true,commandId:'other'};return {};}};
  const timers2=[];await runEnrolledConnector({transport:bad,client:{...client,destroy:async()=>{}},encodeQr:async q=>q,resetLocalSession:async()=>{resets++;},setTimer:fn=>{timers2.push(fn);return fn;},clearTimer:()=>{},onStopped:r=>{stopped2=r;}});
  for(const fn of timers2)await fn().catch(()=>undefined);assert.equal(stopped2,'HEARTBEAT_FAILED');assert.equal(resets,0);
 });
 await test('code-update-restarts-once-and-only-when-idle',async()=>{
  const callbacks={},timers=[];let stoppedWith=[],gate=null,release=null,fingerprint='v1';
  const client={on:(name,cb)=>{callbacks[name]=cb;},initialize:async()=>{},destroy:async()=>{},getChats:async()=>[]};
  const t={getBinding:()=>binding,operate:async(action,data)=>{if(action==='HEARTBEAT'&&data.poll===true&&gate)await gate;return {command:null};},synchronize:async()=>({written:0,quarantined:0})};
  const running=await runEnrolledConnector({transport:t,client,encodeQr:async q=>q,resetLocalSession:async()=>{},setTimer:fn=>{timers.push(fn);return fn;},clearTimer:()=>{},onStopped:r=>{stoppedWith.push(r);},codeFingerprint:()=>{if(fingerprint==='broken')throw Error('EBUSY');return fingerprint;}});
  assert.equal(await running.checkCodeUpdate(),'UNCHANGED','same code, nothing to do');
  fingerprint='v2';assert.equal(await running.checkCodeUpdate(),'CHANGE_SEEN','a change must be seen twice in a row (a file still being written is not a release)');
  fingerprint='v1';assert.equal(await running.checkCodeUpdate(),'UNCHANGED');fingerprint='v2';assert.equal(await running.checkCodeUpdate(),'CHANGE_SEEN','a change that went back starts again');
  fingerprint='broken';assert.equal(await running.checkCodeUpdate(),'UNREADABLE','an unreadable file never restarts it');fingerprint='v2';
  gate=new Promise(resolve=>{release=resolve;});const beating=running.poll();await Promise.resolve();
  assert.equal(await running.checkCodeUpdate(),'BUSY','not while it is working');assert.deepEqual(stoppedWith,[]);
  release();await beating;gate=null;
  assert.equal(await running.checkCodeUpdate(),'RESTARTING');assert.deepEqual(stoppedWith,['CODE_UPDATED']);
  assert.equal(await running.checkCodeUpdate(),'SKIPPED','once per change');fingerprint='v3';assert.equal(await running.checkCodeUpdate(),'SKIPPED');assert.deepEqual(stoppedWith,['CODE_UPDATED'],'the restarted process takes the new code as its baseline; this one never loops');
  // Without a fingerprint (the old call) there is no check at all.
  const timers3=[];const plain=await runEnrolledConnector({transport:t,client:{...client},encodeQr:async q=>q,resetLocalSession:async()=>{},setTimer:fn=>{timers3.push(fn);return fn;},clearTimer:()=>{}});
  assert.equal(await plain.checkCodeUpdate(),'SKIPPED');assert.equal(timers3.length,timers.length-1,'and no timer for it');
 });
 await test('connector-does-not-initialize-after-server-revocation',async()=>{let initialized=0;await rejection(()=>runEnrolledConnector({transport:{getBinding:()=>binding,operate:async()=>{throw Error('REVOKED');}},client:{on:()=>{},initialize:async()=>initialized++,destroy:async()=>{}},encodeQr:async()=>'',resetLocalSession:async()=>{},setTimer:()=>0}));assert.equal(initialized,0);});
 assert(!db.log.some(p=>/^(pagos|solicitudes|paymentApplications|documentDeliveryJobs)\//.test(p)));
 console.log(JSON.stringify({status:'PASS',checks:cases.length,cases,realProviderRequests:0,mockFirestore:true,scope:'local-synthetic-only-real-crypto-and-canonical-authorization',fetches}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{Module._load=original;});
