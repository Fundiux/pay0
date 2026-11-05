'use strict';
// Executable local model seam. No send, Firestore, admin business APIs or tools.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function loadCanonical(){
 const file=path.join(__dirname,'local-bundle/engine.cjs'),manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'local-bundle/source-manifest.json'),'utf8'));
 if(hash(fs.readFileSync(file))!==manifest.entrypointSha256)throw Error('LOCAL_BUNDLE_DRIFT');
 return require(file);
}
function initializeWithAuthorizedApp(app,canonical=loadCanonical()){
 for(const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])if(process.env[key]&&process.env[key]!=='pay-0-system')throw Error('PROVIDER_PROJECT_ENV_CONFLICT');
 if(app?.options?.projectId!=='pay-0-system'||typeof app?.options?.credential?.getAccessToken!=='function')throw Error('AUTHORIZED_PROVIDER_APP_REQUIRED');
 const existing=canonical.getApps().find(a=>a.name==='[DEFAULT]');
 if(existing){if(existing.options.projectId!=='pay-0-system'||existing.options.credential!==app.options.credential)throw Error('DEFAULT_PROVIDER_APP_CONFLICT');return existing;}
 return canonical.initializeApp({projectId:'pay-0-system',credential:app.options.credential});
}
class FileHistory {
 constructor(directory){this.directory=path.resolve(directory);fs.mkdirSync(this.directory,{recursive:true});}
 async load(key){if(!/^[a-f0-9]{64}$/.test(key))throw Error('MEMORY_KEY_INVALID');const file=path.join(this.directory,key+'.json');if(!fs.existsSync(file))return{schema:1,history:[],notes:[],completed:[]};if(fs.statSync(file).size>512*1024)throw Error('MEMORY_BUDGET');const record=JSON.parse(fs.readFileSync(file,'utf8'));if(record.schema!==1||!Array.isArray(record.history)||!Array.isArray(record.notes)||!Array.isArray(record.completed))throw Error('MEMORY_SCHEMA');return record;}
 async save(key,record){if(!/^[a-f0-9]{64}$/.test(key))throw Error('MEMORY_KEY_INVALID');const file=path.join(this.directory,key+'.json'),temp=file+'.'+crypto.randomUUID()+'.tmp',text=JSON.stringify(record);if(Buffer.byteLength(text)>512*1024)throw Error('MEMORY_BUDGET');fs.writeFileSync(temp,text,{flag:'wx',mode:0o600});fs.renameSync(temp,file);}
}
function createLocalEngine({authorizeInbound,store,model,canonical=loadCanonical()}){
 if(typeof authorizeInbound!=='function'||typeof store?.load!=='function'||typeof store?.save!=='function')throw Error('TRUSTED_POLICY_AND_STORE_REQUIRED');
 model=model||new canonical.HugoModelRouter();const locks=new Map();
 async function authorize(event){
  if(!event||typeof event.messageId!=='string'||!event.messageId||event.messageId.length>200||typeof event.chatId!=='string'||!event.chatId||event.chatId.length>200||typeof event.senderJid!=='string'||!event.senderJid||event.senderJid.length>200||typeof event.text!=='string'||!event.text.trim()||event.text.length>2000||!['HUGO','MARIA','SOFIA'].includes(event.persona))throw Error('INBOUND_INVALID');
  const grant=await authorizeInbound(event);
  if(!grant||grant.allowed!==true||typeof grant.rootId!=='string'||!grant.rootId||!/^[a-f0-9]{64}$/.test(grant.accountJidSha256||'')||grant.chatId!==event.chatId||grant.senderJid!==event.senderJid||grant.persona!==event.persona||typeof grant.bindingRevision!=='string'||!grant.bindingRevision)throw Error('SCOPED_CHANNEL_GRANT_REQUIRED');
  const key=hash(JSON.stringify([grant.rootId,grant.accountJidSha256,grant.chatId,grant.senderJid,grant.persona]));return{grant,key};
 }
 async function locked(key,fn){const previous=locks.get(key)||Promise.resolve();let release;const gate=new Promise(resolve=>{release=resolve});const tail=previous.catch(()=>{}).then(()=>gate);locks.set(key,tail);await previous.catch(()=>{});try{return await fn()}finally{release();if(locks.get(key)===tail)locks.delete(key)}}
 async function respond(event){
  const initial=await authorize(event);
  return locked(initial.key,async()=>{
   const {grant,key}=await authorize(event);if(key!==initial.key||grant.bindingRevision!==initial.grant.bindingRevision)throw Error('CHANNEL_GRANT_CHANGED');
   const record=await store.load(key),old=record.completed.find(x=>x.messageId===event.messageId);
   if(old){if(old.inputHash!==hash(event.text))throw Error('MESSAGE_REPLAY_CONTENT_CHANGED');return{text:old.text,duplicate:true,memoryKey:key,provider:old.provider};}
   const alias={HUGO:'Hugo',MARIA:'María',SOFIA:'Sofía'}[event.persona];
   const context={channelPolicy:{channel:'WHATSAPP',alias,engine:'SHARED_HUGO_MODEL_ROUTER',businessTools:'DISABLED',audience:'THIS_CHAT_AND_SENDER_ONLY'},
    solicitudes:[],pagos:[],complementosPendientes:[],capacidadesIq:{},evidenceBoundaries:{whatsapp:[{completeness:'UNKNOWN',scope:'CHANNEL_WITHOUT_BUSINESS_ACCESS',meaning:'No se consultaron datos empresariales; listas vacías no prueban ausencia.',totalAllowed:false}]},
    conversationCorrections:record.notes.slice(-3).map(n=>({content:n.content,authority:'USER_STATEMENT_NOT_FACT'}))};
   const profile=canonical.classifyHugoProfile(event.text),signals=canonical.classifyHugoRoutingSignals(event.text,profile);
   const request=canonical.canonicalModelRequest({message:event.text,name:'participante de este chat',context,history:record.history.slice(-10),promptVersion:'hugo-v2',profile,scope:'PAY0',routingSignals:{...signals,requiredCapabilities:[]}});
   const result=await model.generateCanonical(request);
   if(result.error||typeof result.text!=='string'||!result.text.trim())throw Object.assign(Error('CHANNEL_PROVIDER_UNAVAILABLE'),{providerCode:result.error||'NO_FINAL_RESPONSE'});
   const final=await authorize(event);if(final.key!==key||final.grant.bindingRevision!==grant.bindingRevision)throw Error('CHANNEL_GRANT_CHANGED');
   const text=result.text.trim().slice(0,6000);
   record.history=[...record.history,{role:'user',text:event.text},{role:'assistant',text}].slice(-12);
   record.completed=[...record.completed,{messageId:event.messageId,inputHash:hash(event.text),text,provider:result.provider||'UNKNOWN'}].slice(-100);
   await store.save(key,record);
   return{text,duplicate:false,memoryKey:key,provider:result.provider||'UNKNOWN',engine:'CANONICAL_HUGO_MODEL_ROUTER',alias,eventId:event.messageId};
  });
 }
 async function confirmNote(event,content,confirmed){
  if(confirmed!==true||typeof content!=='string'||!content.trim()||content.length>1000)throw Error('EXPLICIT_NOTE_CONFIRMATION_REQUIRED');
  const {key,grant}=await authorize(event);return locked(key,async()=>{const again=await authorize(event);if(again.key!==key||again.grant.bindingRevision!==grant.bindingRevision)throw Error('CHANNEL_GRANT_CHANGED');const record=await store.load(key);record.notes=[...record.notes,{content:content.trim(),sourceMessageId:event.messageId,authority:'USER_STATEMENT_NOT_FACT'}].slice(-3);await store.save(key,record);return{saved:true,scope:'CHAT_SENDER_PERSONA',authority:'USER_STATEMENT_NOT_FACT'}});
 }
 return{respond,confirmNote};
}
module.exports={loadCanonical,initializeWithAuthorizedApp,FileHistory,createLocalEngine};
