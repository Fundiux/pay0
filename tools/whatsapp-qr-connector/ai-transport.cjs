'use strict';
const crypto=require('node:crypto'),path=require('node:path');
const sync=require('./scoped-sync.cjs');
function parseRememberCommand(text){
 if(typeof text!=='string'||!/^recuerda\s*:/iu.test(text))return null;
 const note=text.replace(/^recuerda\s*:\s*/iu,'').trim();
 if(!note||note.length>1000)throw Error('MEMORY_NOTE_INVALID');
 return note;
}
function stableMessageId(message){
 const key=message?.id;if(!key||typeof key!=='object')return null;
 const serialized=key._serialized;
 const supplied=typeof serialized==='string'&&serialized.length>0&&serialized.length<=200&&!/[\s\x00-\x1f]/.test(serialized)?serialized:null;
 if(serialized!==undefined&&!supplied)return null;
 // New MsgKey.serialize() drops _serialized; reconstruct only validated pieces.
 const hasParts=key.fromMe!==undefined||key.remote!==undefined||key.id!==undefined||key.participant!==undefined;
 if(!hasParts)return supplied;
 const jid=value=>typeof value==='string'?value:typeof value?._serialized==='string'?value._serialized:null;
 const remote=jid(key.remote),participant=key.participant==null?null:jid(key.participant);
 if(typeof key.fromMe!=='boolean'||!/^\d+(?:-\d+)?(?::\d+)?@(g\.us|c\.us|s\.whatsapp\.net|lid)$/.test(remote||'')||typeof key.id!=='string'||!/^[A-Za-z0-9]{1,128}$/.test(key.id)||key.participant!=null&&!/^\d+(?::\d+)?@(c\.us|s\.whatsapp\.net|lid)$/.test(participant||''))return null;
 const rebuilt=`${key.fromMe}_${remote}_${key.id}${participant?'_'+participant:''}`;
 if(rebuilt.length>200||supplied&&supplied!==rebuilt)return null;
 return supplied||rebuilt;
}
function parseInbound(message,activatedAtMs,now=Date.now()){
 if(!message||!Number.isFinite(activatedAtMs)||!Number.isFinite(now)||message.fromMe!==false||message.type!=='chat'||typeof message.body!=='string'||message.body.length>2000)return null;
 if(!Number.isFinite(message.timestamp)||message.timestamp*1000<activatedAtMs||now-message.timestamp*1000>120000||message.timestamp*1000>now+30000)return null;
 const match=message.body.match(/^\s*@(Hugo|Mar[ií]a|Sof[ií]a)(?=$|\s|[:,.!?])\s*[:,.!?]?\s*(.+)$/isu);
 if(!match||!match[2].trim())return null;
 const names=[...message.body.normalize('NFD').replace(/[\u0300-\u036f]/g,'').matchAll(/(?:^|[^\p{L}\p{N}_])@(Hugo|Maria|Sofia)(?=$|\s|[:,.!?])/giu)].map(m=>m[1].toUpperCase());if(new Set(names).size!==1)return null;
 const chatId=message.from,senderJid=message.author||message.from,id=stableMessageId(message);
 if(typeof id!=='string'||!id||id.length>200||!/^\d+(?:-\d+)?@(g\.us|c\.us|lid)$/.test(chatId||'')||!/^\d+@(c\.us|lid)$/.test(senderJid||''))return null;
 if(!chatId.endsWith('@g.us')&&senderJid!==chatId)return null;
 const persona=match[1].normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
 return Object.freeze({messageId:id,chatId,senderJid,persona,text:match[2].trim()});
}
function normalizeOwnPn(serialized){if(typeof serialized!=='string'||!/^\d+(?::\d+)?@(c\.us|s\.whatsapp\.net)$/.test(serialized))return null;return serialized.split('@')[0].split(':')[0]+'@c.us';}
async function resolveOwnAccountAliases(client,accountJidSha256){
 const ownSerialized=client.info?.wid?._serialized;
 if(typeof ownSerialized!=='string'||crypto.createHash('sha256').update(ownSerialized).digest('hex')!==accountJidSha256)throw Error('OWN_ACCOUNT_PIN_MISMATCH');
 const canonicalPnJid=normalizeOwnPn(ownSerialized);if(!canonicalPnJid)throw Error('OWN_ACCOUNT_PN_REQUIRED');
 let row;try{row=await client.pupPage.evaluate(async()=>{
  const prefs=window.require('WAWebUserPrefsMeUser'),pn=prefs.getMaybeMePnUser(),lid=prefs.getMaybeMeLidUser();
  const serialized=value=>typeof value==='string'?value:value?._serialized||null;
  let mapped=null;if(lid)try{mapped=await window.require('WAWebLidMigrationUtils').toPn(lid)}catch{}
  return{pn:serialized(pn),lid:serialized(lid),mappedPn:serialized(mapped)};
 })}catch{return Object.freeze({accountJidSha256,ownSerialized,canonicalPnJid,ownLid:null,ownerLidVerified:false});}
 if(typeof row?.pn!=='string'||crypto.createHash('sha256').update(row.pn).digest('hex')!==accountJidSha256||normalizeOwnPn(row.pn)!==canonicalPnJid)throw Error('OWN_ACCOUNT_PREFS_PIN_MISMATCH');
 // Both Me identifiers come from the authenticated session, not message data.
 // Missing optional reverse map is not contradictory evidence; a different PN is.
 const verified=typeof row.lid==='string'&&/^\d+@lid$/.test(row.lid)&&(!row.mappedPn||normalizeOwnPn(row.mappedPn)===canonicalPnJid);
 return Object.freeze({accountJidSha256,ownSerialized,canonicalPnJid,ownLid:verified?row.lid:null,ownerLidVerified:verified,identityProof:'AUTHENTICATED_ME_PREFS'});
}
function parseOwnerOutbound(message,ownSerialized,accountJidSha256,activatedAtMs,now=Date.now(),ownAccountAliases){
 if(message?.fromMe!==true||typeof ownSerialized!=='string'||crypto.createHash('sha256').update(ownSerialized).digest('hex')!==accountJidSha256||!/^\d+(?::\d+)?@(c\.us|s\.whatsapp\.net|lid)$/.test(ownSerialized))return null;
 const [number,domain]=ownSerialized.split('@'),ownJid=number.split(':')[0]+'@'+(domain==='s.whatsapp.net'?'c.us':domain);
 let target=message.to;
 if(ownAccountAliases?.accountJidSha256===accountJidSha256&&ownAccountAliases.ownSerialized===ownSerialized&&ownAccountAliases.canonicalPnJid===ownJid&&ownAccountAliases.ownerLidVerified===true&&/^\d+@lid$/.test(ownAccountAliases.ownLid||'')&&target===ownAccountAliases.ownLid)target=ownJid;
 // Owner opt-in: selfchat or an already scoped group; never other private DMs.
 if(target!==ownJid&&!(typeof target==='string'&&target.endsWith('@g.us')))return null;
 const event=parseInbound({...message,fromMe:false,from:target,author:ownJid},activatedAtMs,now);
 return event?Object.freeze({...event,ownerOrigin:true}):null;
}
function createTransport({db,app,client,owner,connectorRef,assertAuthority,runtime,timestamp,accountJidSha256,report,ownAccountAliases,localModule,now=Date.now,maxQueue=20}){
 const local=localModule||require('./ai/local-engine.cjs');local.initializeWithAuthorizedApp(app);
 const activatedAtMs=now(),counts=new Map(),queue=[];let draining=false,closed=false;
 const eventKeys=new Set(),runId=crypto.randomUUID();
 const emit=update=>{try{report(update)}catch{}};
 const errorCode=e=>/^[A-Z0-9_]+$/.test(e?.providerCode||e?.message||'')?e.providerCode||e.message:'AI_FAILED';
 async function check(tx,event){
  await assertAuthority(tx);
  const [connector,chat]=await Promise.all([tx.get(connectorRef),tx.get(db.collection('whatsappQrChats').doc(sync.stableDocId(owner.rootId,event.chatId)))]);
  const c=connector.data(),d=chat.data();
  if(c?.status!=='CONNECTED'||c.accountJidSha256!==accountJidSha256||closed)throw Error('AI_CHANNEL_AUTHORITY_LOST');
  const selfchat=event.ownerOrigin===true&&event.chatId===event.senderJid;
  if(!selfchat&&(!chat.exists||d.rootId!==owner.rootId||d.ownerUid!==owner.uid||d.connectorId!==connectorRef.id||d.managedBy!==sync.MANAGED_BY||d.active!==true||d.chatId!==event.chatId))throw Error('AI_CHANNEL_AUTHORITY_LOST');
 }
 const engine=local.createLocalEngine({store:new local.FileHistory(path.join(runtime,'ai-memory')),authorizeInbound:async event=>{
  if(!eventKeys.has(event))throw Error('UNTRUSTED_AI_EVENT');
  await db.runTransaction(tx=>check(tx,event));
  return{allowed:true,rootId:owner.rootId,accountJidSha256,chatId:event.chatId,senderJid:event.senderJid,persona:event.persona,bindingRevision:'scoped-chat-only-v1'};
 }});
 async function processEvent(event){
  if(closed)return;
  const window=Math.floor(now()/600000),rateKey=JSON.stringify([event.chatId,window]);
  for(const [key,value] of counts)if(value.window<window)counts.delete(key);
  if((counts.get(rateKey)?.count||0)>=10){emit({aiLastResult:'RATE_LIMITED'});return;}
  eventKeys.add(event);
  const claimId=crypto.createHash('sha256').update(JSON.stringify([owner.rootId,accountJidSha256,connectorRef.id,event.chatId,event.senderJid,event.messageId])).digest('hex');
  const claim=db.collection('whatsappAiInboundClaims').doc(claimId);
  let reserved=false,sendAttempted=false,sentId=null;
  try{
   const accepted=await db.runTransaction(async tx=>{await check(tx,event);const old=await tx.get(claim);if(old.exists)return false;tx.create(claim,{rootId:owner.rootId,connectorId:connectorRef.id,accountJidSha256,chatRef:crypto.createHash('sha256').update(event.chatId).digest('hex'),senderRef:crypto.createHash('sha256').update(event.senderJid).digest('hex'),persona:event.persona,runId,status:'RESERVED',createdAt:timestamp()});return true;});
   if(!accepted){emit({aiLastResult:'DUPLICATE_SKIPPED'});return;}
   reserved=true;counts.set(rateKey,{window,count:(counts.get(rateKey)?.count||0)+1});
   const note=parseRememberCommand(event.text);
   if(note!==null){const saved=await engine.confirmNote(event,note,true);if(saved?.saved!==true||saved.authority!=='USER_STATEMENT_NOT_FACT')throw Error('MEMORY_NOTE_NOT_CONFIRMED');}
   const result=await engine.respond(event);
   if(result.duplicate)throw Error('LOCAL_DUPLICATE_REQUIRES_REVIEW');
   if(typeof result.text!=='string'||!result.text.trim()||!['Hugo','María','Sofía'].includes(result.alias))throw Error('AI_RESULT_INVALID');
   await db.runTransaction(async tx=>{await check(tx,event);const old=await tx.get(claim);if(old.data()?.status!=='RESERVED'||old.data()?.runId!==runId)throw Error('AI_CLAIM_CHANGED');tx.update(claim,{status:'SEND_ATTEMPTED',provider:result.provider,updatedAt:timestamp()});});
   if(closed)throw Error('AI_TRANSPORT_STOPPED');
   sendAttempted=true;
   const sent=await client.sendMessage(event.chatId,result.alias+': '+result.text,{sendSeen:false});
   sentId=stableMessageId(sent);if(typeof sentId!=='string'||!sentId)throw Error('SEND_RECEIPT_MISSING');
   await claim.update({status:'SENT',outboundIdHash:crypto.createHash('sha256').update(sentId).digest('hex'),updatedAt:timestamp()});
   emit({aiLastResult:'SENT',aiLastPersona:event.persona});
  }catch(e){const code=errorCode(e);emit({aiLastResult:sendAttempted?'SEND_REQUIRES_REVIEW':'ERROR',aiError:code});if(reserved)await claim.update({status:sentId?'SENT_RECEIPT_PERSISTENCE_REQUIRES_REVIEW':sendAttempted?'SEND_UNCERTAIN_REQUIRES_REVIEW':'ERROR_REQUIRES_REVIEW',...(sentId?{outboundIdHash:crypto.createHash('sha256').update(sentId).digest('hex')}:{}),error:code,updatedAt:timestamp()}).catch(()=>{});}
  finally{eventKeys.delete(event);}
 }
 async function drain(){if(draining)return;draining=true;try{while(queue.length){const entry=queue.shift();try{if(!closed)await processEvent(entry.event)}catch{emit({aiLastResult:'QUEUE_PROCESSING_ERROR'})}finally{entry.resolve()}}}finally{draining=false;}}
 function enqueue(event){if(!event||closed)return Promise.resolve();if(queue.length>=maxQueue){emit({aiLastResult:'QUEUE_FULL_REQUIRES_REVIEW'});return Promise.resolve();}return new Promise(resolve=>{queue.push({event,resolve});void drain()});}
 function receive(message){return enqueue(parseInbound(message,activatedAtMs,now()));}
 function receiveOwner(message){return enqueue(parseOwnerOutbound(message,client.info?.wid?._serialized,accountJidSha256,activatedAtMs,now(),ownAccountAliases));}
 const listener=m=>{void receive(m).catch(()=>{})};client.on('message',listener);
 const ownerListener=m=>{void receiveOwner(m).catch(()=>{})};client.on('message_create',ownerListener);
 return{receive,receiveOwner,stop(){closed=true;client.removeListener('message',listener);client.removeListener('message_create',ownerListener);while(queue.length)queue.shift().resolve();},policy:'PREFIX_ONLY_CHAT_SENDER_MEMORY_NO_BUSINESS_TOOLS'};
}
module.exports={createTransport,parseInbound,parseOwnerOutbound,resolveOwnAccountAliases,stableMessageId,parseRememberCommand};
