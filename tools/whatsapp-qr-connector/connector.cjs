'use strict';
// Authorized recovery only. No delivery-job polling or message sending exists here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const core=require('./recovery-core.cjs');
const scopedSync=require('./scoped-sync.cjs');
const {installMessageCompatibility}=require('./message-compat.cjs');
const {buildExactSendSource}=require('./exact-send-source.cjs');
const BASE='C:/Users/ebarr/Desktop/pay0-system/__untracked_archive/tools/whatsapp-qr-connector';
const EXPECTED_OWNER_HASH='b67e317b62cebaef617bc14d03e55d943956d185d886cbd4cc2b5509aefcfdc0';
async function main(){
 const runtime=process.env.PAY0_QR_CONTROL_DIR||path.join(__dirname,'runtime');fs.mkdirSync(runtime,{recursive:true});
 const report=(phase,extra={})=>fs.writeFileSync(path.join(runtime,'status.json'),JSON.stringify({phase,observedAtUtc:new Date().toISOString(),sendEnabled:false,...extra},null,2));
 const r=require('node:module').createRequire(path.join(BASE,'package.json'));
 const admin=r('firebase-admin'),{Client,LocalAuth}=r('whatsapp-web.js'),qrcode=r('qrcode');
 const key=JSON.parse(fs.readFileSync(path.join(BASE,'service-account-pay0.json'),'utf8'));
 if(key.project_id!=='pay-0-system')throw Error('CREDENTIAL_PROJECT_MISMATCH');
 const app=admin.initializeApp({credential:admin.credential.cert(key),projectId:'pay-0-system'},'pay0-qr-recovery-'+crypto.randomUUID());
 const db=app.firestore(),FV=admin.firestore.FieldValue,TS=admin.firestore.Timestamp;
 const connector=db.collection('whatsappQrConnectors').doc('default');
 const commands=await db.collection('whatsappQrConnectorCommands').where('connectorId','==','default').limit(1000).get();
 if(commands.size>=1000)throw Error('QUEUE_REQUIRES_REVIEW');
 const rows=commands.docs.map(d=>({id:d.id,ref:d.ref,data:d.data()}));
 const uid=[...new Set(rows.map(d=>d.data.requestedByUid).filter(x=>typeof x==='string'&&core.hash(x)===EXPECTED_OWNER_HASH))][0];
 if(!uid)throw Error('CONFIRMED_OPERATOR_NOT_FOUND');
 const userRef=db.collection('users').doc(uid),userSnap=await userRef.get();
 const owner=core.verifyOperator(uid,userSnap.exists?userSnap.data():null,EXPECTED_OWNER_HASH);
 const token=crypto.randomUUID();let stopped=false,stopping=false,ready=false,busy=false,client=null,generation=0,qrSequence=0,commandRef=null,heartbeat=null,poll=null,syncTimer=null,syncing=null,aiTransport=null;
 const configFile=path.join(runtime,'session-config.json');
 let config=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')):null;
 if(config && (config.ownerUidHash!==EXPECTED_OWNER_HASH || config.rootId!==owner.rootId))throw Error('LOCAL_SESSION_OWNER_CONFLICT');
 if(!config)throw Error('PRESERVED_SESSION_CONFIG_REQUIRED');
 const authBase=path.join(process.env.LOCALAPPDATA,'PAY0','WhatsAppConnector','auth');
 fs.mkdirSync(authBase,{recursive:true});
 if(config.profileRoot!==authBase||!fs.existsSync(path.join(authBase,'session-'+config.authClientId)))throw Error('PRESERVED_SESSION_PROFILE_REQUIRED');
 const priorConnector=await connector.get();
 const prior=priorConnector.exists?priorConnector.data():{};
 if(prior.rootId!==owner.rootId||prior.authClientId!==config.authClientId)throw Error('PRESERVED_SESSION_IDENTITY_CONFLICT');
 if(!config.expectedAccountJidSha256&&/^[a-f0-9]{64}$/.test(prior.accountJidSha256||'')){config.expectedAccountJidSha256=prior.accountJidSha256;fs.writeFileSync(configFile,JSON.stringify(config));}
 if(!config.expectedAccountJidSha256)throw Error('PRESERVED_ACCOUNT_HASH_REQUIRED');
 async function ownedWrite(payload,finishQr=false,guard=()=>true,finishedRef=commandRef,allowStopping=false){
  if(stopped||stopping&&!allowStopping||!guard())return false;
  return db.runTransaction(async tx=>{
   const [c,u]=await Promise.all([tx.get(connector),tx.get(userRef)]);
   core.verifyOperator(uid,u.exists?u.data():null,EXPECTED_OWNER_HASH,owner.rootId);core.verifyLease(c.data()||{},token,owner,Date.now());
   const q=finishQr&&finishedRef?await tx.get(finishedRef):null;
   if(stopped||stopping&&!allowStopping||!guard())return false;
   if(q && (!q.exists||q.data().recoveryRunId!==token||!['PROCESSING','DONE'].includes(q.data().status)||q.data().rootId!==owner.rootId||q.data().requestedByUid!==uid||q.data().connectorId!=='default'||q.data().type!=='NEW_QR'))throw Error('COMMAND_SCOPE_CHANGED');
   if(q && q.data().status==='PROCESSING')tx.set(finishedRef,{status:'DONE',message:'QR nuevo disponible en PAY0.',finishedAt:FV.serverTimestamp(),updatedAt:FV.serverTimestamp()},{merge:true});
   tx.set(connector,{...payload,connectorId:'default',rootId:owner.rootId,ownerUid:uid,authClientId:config.authClientId,sendEnabled:false,recoveryRunId:token,recoveryLeaseUntil:payload.recoveryLeaseUntil||TS.fromMillis(Date.now()+90000),lastHeartbeatAt:FV.serverTimestamp(),lastSeenAt:FV.serverTimestamp(),updatedAt:FV.serverTimestamp(),...(finishQr&&finishedRef?{lastCommandId:finishedRef.id,lastCommandType:'NEW_QR',lastCommandStatus:'DONE',lastCommandMessage:'QR nuevo disponible en PAY0.',lastCommandFinishedAt:FV.serverTimestamp()}:{})},{merge:true});return true;
  });
 }
 async function acquire(){
  const selection=core.selectRecoveryCommands(rows,owner);
  await db.runTransaction(async tx=>{
   const [c,u,...snapshots]=await Promise.all([tx.get(connector),tx.get(userRef),...rows.map(row=>tx.get(row.ref))]);
   core.verifyOperator(uid,u.exists?u.data():null,EXPECTED_OWNER_HASH,owner.rootId);
   const old=c.exists?c.data():{};
   if(old.rootId && old.rootId!==owner.rootId)throw Error('CONNECTOR_ROOT_CONFLICT');
   if(old.recoveryLeaseUntil?.toMillis?.()>Date.now())throw Error('ANOTHER_RECOVERY_ACTIVE');
   if(old.status==='CONNECTED' && old.lastHeartbeatAt?.toMillis?.()>Date.now()-90000)throw Error('ANOTHER_CONNECTED_WORKER_ACTIVE');
   const current=snapshots.map((s,i)=>({id:rows[i].id,ref:rows[i].ref,data:s.exists?s.data():{}}));
   const chosen=core.selectRecoveryCommands(current,owner,true);
   commandRef=null;
   for(const oldCommand of [...chosen.superseded,...(chosen.selected?[chosen.selected]:[])])tx.set(oldCommand.ref,{status:'ERROR',message:'Sesión actual conservada; solicitud de QR anterior no ejecutada.',recoveryPreviousStatus:oldCommand.data.status,recoveryResolution:'CURRENT_SESSION_PRESERVED',recoveryRunId:token,finishedAt:FV.serverTimestamp(),updatedAt:FV.serverTimestamp()},{merge:true});
   tx.set(connector,{connectorId:'default',rootId:owner.rootId,ownerUid:uid,authClientId:config.authClientId,status:'STARTING',aiRepliesEnabled:false,sendEnabled:false,qrText:null,qrDataUrl:null,error:null,recoveryRunId:token,recoveryLeaseUntil:TS.fromMillis(Date.now()+90000),lastHeartbeatAt:FV.serverTimestamp(),updatedAt:FV.serverTimestamp(),...(commandRef?{lastCommandId:commandRef.id,lastCommandType:'NEW_QR',lastCommandStatus:'PROCESSING'}:{})},{merge:true});
  });
 }
 async function stop(phase){
  if(stopped||stopping)return;stopping=true;aiTransport?.stop();++generation;report(phase);if(heartbeat)clearInterval(heartbeat);if(poll)clearInterval(poll);if(syncTimer)clearInterval(syncTimer);
  try{await ownedWrite({status:phase==='ACCOUNT_SUFFIX_MISMATCH'?'ERROR':'DISCONNECTED',aiRepliesEnabled:false,error:phase,qrText:null,qrDataUrl:null,recoveryLeaseUntil:TS.fromMillis(Date.now())},false,()=>true,null,true);}catch{}
  stopped=true;try{await client?.destroy();}catch{};setTimeout(()=>process.exit(0),1500);await app.delete();
 }
 async function syncNow(){
  if(stopped||stopping||!ready)throw Error('SYNC_REQUIRES_CONNECTED_SESSION');
  if(syncing)return syncing;
  syncing=(async()=>{
   const [chats,contacts]=await Promise.all([client.pupPage.evaluate(()=>{
    const collection=window.require('WAWebCollections').Chat;
    if(!collection||typeof collection.getModelsArray!=='function')throw Error('CHAT_COLLECTION_UNAVAILABLE');
    return collection.getModelsArray().map(chat=>({id:{_serialized:chat.id?._serialized},name:chat.formattedTitle||chat.name||'',isGroup:chat.id?._serialized?.endsWith('@g.us')===true,archived:chat.archive===true,pinned:!!chat.pin,timestamp:Number.isFinite(chat.t)?chat.t:undefined}));
   }),client.getContacts()]);
   const counts=await scopedSync.syncSnapshot({db,owner,connectorRef:connector,sessionId:config.authClientId,chats,contacts,timestamp:FV.serverTimestamp(),assertAuthority:async tx=>{
    const [c,u]=await Promise.all([tx.get(connector),tx.get(userRef)]);
    core.verifyOperator(uid,u.data(),EXPECTED_OWNER_HASH,owner.rootId);core.verifyLease(c.data(),token,owner,Date.now());
    if(stopped||stopping||!ready)throw Error('SYNC_SESSION_STOPPED');
   }});
   if(!await ownedWrite({lastChatsSyncedAt:FV.serverTimestamp(),chatsCount:counts.total,groupsCount:counts.groups,contactsCount:counts.contacts,lastSyncError:null}))throw Error('SYNC_LEASE_LOST');
   report('CONNECTED',{accountSuffix:'0007',accountVerified:true,sync:counts,lastSyncedAtUtc:new Date().toISOString()});return counts;
  })();
  try{return await syncing;}finally{syncing=null;}
 }
 async function syncSafely(){try{await syncNow();}catch(e){await ownedWrite({lastSyncError:String(e.message||'SYNC_FAILED').slice(0,180)}).catch(()=>{});report('CONNECTED',{syncError:String(e.message||'SYNC_FAILED').slice(0,180)});}}
 async function rotate(fresh){
  if(stopped||stopping)return;
  const epoch=++generation;ready=false;
  if(client){await client.destroy();client=null;}
  if(stopped||stopping||epoch!==generation)return;
  if(fresh){config.authClientId='pay0-recovered-'+Date.now()+'-'+crypto.randomUUID().slice(0,8);fs.writeFileSync(configFile,JSON.stringify(config));}
  class PreserveAuth extends LocalAuth {async logout(){}}
  class RecoveryClient extends Client {async inject(){await core.injectWithNavigationRetry(()=>super.inject(),()=>!stopped&&!stopping&&epoch===generation,async()=>{await new Promise(resolve=>setTimeout(resolve,750));await this.pupPage.waitForFunction('document.readyState === "complete" && window.Debug?.VERSION !== undefined',{timeout:30000}).catch(()=>{});});}async attachEventListeners(...args){if(!stopped&&!stopping&&epoch===generation)await this.pupPage.evaluate(installMessageCompatibility,buildExactSendSource().functionSource);return super.attachEventListeners(...args);}}
  const current=new RecoveryClient({authStrategy:new PreserveAuth({clientId:config.authClientId,dataPath:authBase}),userAgent:false,webVersionCache:{type:'none'},puppeteer:{headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-dev-shm-usage']}});client=current;
  const safe=fn=>(...args)=>Promise.resolve().then(()=>{if(stopped||epoch!==generation)return;return fn(...args);}).catch(()=>stop('CONNECTOR_EVENT_ERROR'));
  current.on('qr',safe(async qr=>{
   const sequence=++qrSequence,request=commandRef;const guard=()=>!stopping&&epoch===generation&&sequence===qrSequence&&!ready;
   const dataUrl=await qrcode.toDataURL(qr,{width:360,margin:2});
   if(!await ownedWrite({status:'QR_REQUIRED',qrText:qr,qrDataUrl:dataUrl,error:null},true,guard,request)||!guard())return;
   fs.writeFileSync(path.join(runtime,'qr.png'),Buffer.from(dataUrl.split(',')[1],'base64'));report('QR_REQUIRED',{qrPublished:true});
  }));
  current.on('authenticated',safe(async()=>{++qrSequence;const guard=()=>!stopping&&!ready&&epoch===generation;if(await ownedWrite({status:'AUTHENTICATING',qrText:null,qrDataUrl:null},false,guard)&&guard())report('AUTHENTICATING');}));
  current.on('ready',safe(async()=>{
   let accountHash;try{accountHash=core.verifyAccount(current.info,'0007');if(accountHash!==config.expectedAccountJidSha256)throw Error('PRESERVED_ACCOUNT_MISMATCH');}catch{await stop('ACCOUNT_SUFFIX_MISMATCH');return;}
   ++qrSequence;ready=true;const guard=()=>!stopping&&epoch===generation;if(await ownedWrite({status:'CONNECTED',qrText:null,qrDataUrl:null,error:null,accountJidSha256:accountHash,phoneLabel:'Cuenta PAY0 · termina en 0007'},false,guard)&&guard())report('CONNECTED',{accountSuffix:'0007',accountVerified:true});
   await syncSafely();
   if(config.aiRepliesEnabled===true&&!stopping){
    try{
     const aiModule=require('./ai-transport.cjs');
     const ownAccountAliases=await aiModule.resolveOwnAccountAliases(current,accountHash);
     aiTransport=aiModule.createTransport({ownAccountAliases,db,app,client:current,owner,connectorRef:connector,runtime,timestamp:()=>FV.serverTimestamp(),accountJidSha256:accountHash,
      assertAuthority:async tx=>{const [c,u]=await Promise.all([tx.get(connector),tx.get(userRef)]);core.verifyOperator(uid,u.data(),EXPECTED_OWNER_HASH,owner.rootId);core.verifyLease(c.data(),token,owner,Date.now());if(stopping||!ready)throw Error('AI_SESSION_STOPPED');},
      report:extra=>{fs.writeFileSync(path.join(runtime,'ai-status.json'),JSON.stringify({observedAtUtc:new Date().toISOString(),...extra},null,2));}
     });
     await ownedWrite({aiRepliesEnabled:true,aiReplyPolicy:aiTransport.policy});
    }catch(e){await ownedWrite({aiRepliesEnabled:false,aiError:String(e.message||'AI_INIT_FAILED').slice(0,180)});}
   }
  }));
  current.on('auth_failure',()=>{if(epoch===generation)stop('AUTH_FAILURE_REQUIRES_NEW_QR');});
  current.on('disconnected',()=>{if(epoch===generation)stop('DISCONNECTED');});
  if(stopped||stopping||epoch!==generation)return;
  report('INITIALIZING_BROWSER');try{await current.initialize();}catch(e){fs.writeFileSync(path.join(runtime,'browser-error.json'),JSON.stringify({code:String(e.code||''),name:String(e.name||''),message:String(e.message||'').replace(/https?:\/\/\S+/g,'[url]').slice(0,1800),frames:String(e.stack||'').split('\n').filter(line=>/^\s+at /.test(line)&&!line.includes('http')).slice(0,8)},null,2));await stop('INITIALIZE_ERROR');}
 }
 async function tickCommands(){
  if(fs.existsSync(path.join(runtime,'stop.request'))){await stop('STOPPED_BY_OPERATOR');return;}
  if(ready&&!stopping&&fs.existsSync(path.join(runtime,'owner-self-test.request.json'))){
   const testFile=path.join(runtime,'owner-self-test.request.json');
   const request=JSON.parse(fs.readFileSync(testFile,'utf8'));
   fs.renameSync(testFile,path.join(runtime,'owner-self-test.consumed.json'));
   if(request.action!=='OWNER_SELF_ONLY'||!['HUGO','MARIA','SOFIA'].includes(request.persona)||!/^[a-f0-9]{16}$/.test(request.nonce)||Math.abs(Date.now()-request.createdAtMs)>120000)throw Error('SELF_TEST_REQUEST_INVALID');
   if(core.verifyAccount(client.info,'0007')!==config.expectedAccountJidSha256||!aiTransport)throw Error('SELF_TEST_REQUIRES_VERIFIED_AI');
   const own=client.info.wid._serialized;
   try{await client.sendMessage(own,'@'+request.persona+' Responde unicamente: prueba de conexion '+request.nonce,{sendSeen:false});}catch(e){fs.writeFileSync(path.join(runtime,'owner-self-test-send.json'),JSON.stringify({status:'SEND_UNCERTAIN',code:String(e.message||'SEND_FAILED').slice(0,180)}));}
  }
  if(stopped||busy)return;busy=true;try{
   const snapshot=await db.collection('whatsappQrConnectorCommands').where('status','==','PENDING').limit(100).get();
   const eligible=snapshot.docs.map(d=>({id:d.id,ref:d.ref,data:d.data()})).filter(d=>d.data.connectorId==='default'&&d.data.rootId===owner.rootId&&d.data.requestedByUid===owner.uid);
   const selection=core.selectRecoveryCommands(eligible,owner);
   if(selection.selected){
    const refs=[selection.selected,...selection.superseded];
    await db.runTransaction(async tx=>{
     const [c,u,...states]=await Promise.all([tx.get(connector),tx.get(userRef),...refs.map(d=>tx.get(d.ref))]);core.verifyLease(c.data(),token,owner,Date.now());core.verifyOperator(uid,u.data(),EXPECTED_OWNER_HASH,owner.rootId);
     for(const s of states)core.verifyCommand(s.exists?s.data():null,owner,'NEW_QR');
     for(const row of selection.superseded)tx.set(row.ref,{status:'ERROR',message:'Sustituida por solicitud de QR posterior.',finishedAt:FV.serverTimestamp(),updatedAt:FV.serverTimestamp()},{merge:true});
     tx.set(selection.selected.ref,{status:'ERROR',message:'Sesión actual conservada: no se reinició ni se reemplazó.',finishedAt:FV.serverTimestamp(),updatedAt:FV.serverTimestamp()},{merge:true});
     tx.set(connector,{lastCommandId:selection.selected.id,lastCommandType:'NEW_QR',lastCommandStatus:'ERROR',lastCommandMessage:'Sesión actual conservada: no se reemplazó.',updatedAt:FV.serverTimestamp()},{merge:true});
    });
   }
   for(const row of eligible.filter(d=>d.data.type==='SYNC_CHATS')){
    let failure=null;try{await syncNow();}catch(e){failure=String(e.message||'SYNC_FAILED').slice(0,180);}
    await db.runTransaction(async tx=>{
     const [c,q,u]=await Promise.all([tx.get(connector),tx.get(row.ref),tx.get(userRef)]);
     core.verifyLease(c.data(),token,owner,Date.now());core.verifyOperator(uid,u.data(),EXPECTED_OWNER_HASH,owner.rootId);core.verifyCommand(q.exists?q.data():null,owner,'SYNC_CHATS');
     const result={status:failure?'ERROR':'DONE',message:failure||'Grupos y contactos sincronizados; sesion conservada.',finishedAt:FV.serverTimestamp(),updatedAt:FV.serverTimestamp()};
     tx.set(row.ref,result,{merge:true});
     if(c.data().lastCommandId===row.id)tx.set(connector,{lastCommandStatus:result.status,lastCommandMessage:result.message,lastCommandFinishedAt:FV.serverTimestamp(),updatedAt:FV.serverTimestamp()},{merge:true});
    });
   }
  }finally{busy=false;}
 }
 report('VERIFYING_OPERATOR');await acquire();
 heartbeat=setInterval(()=>ownedWrite({}).catch(()=>stop('HEARTBEAT_ERROR')),15000);
 syncTimer=setInterval(()=>{if(ready&&!stopping)syncSafely();},60000);
 poll=setInterval(()=>tickCommands().catch(()=>report('COMMAND_REVIEW_REQUIRED')),4000);
 process.on('SIGTERM',()=>stop('STOPPED'));process.on('SIGINT',()=>stop('STOPPED'));
 busy=true;try{await rotate(false);}catch{await stop('INITIALIZE_ERROR');}finally{busy=false;}
}
if(require.main===module){if(process.argv[2]!=='--execute-authorized-qr-recovery'){console.log('Offline by default. Explicit authorized recovery launcher required.');}else main().catch(e=>{const dir=path.join(__dirname,'runtime');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({phase:'STARTUP_ERROR',code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'RUNTIME_STARTUP_ERROR',errorCode:String(e.code||'UNKNOWN').slice(0,80)},null,2));process.exitCode=1;});}
module.exports={main};
