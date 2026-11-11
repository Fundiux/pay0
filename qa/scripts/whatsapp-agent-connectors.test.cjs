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
const service=new WhatsAppConnectorAuthority(db),cases=[];
const user={role:'superadmin',rootId:'root-a',active:true};db.seed('users/owner-a',user);db.seed('users/owner-b',{...user,rootId:'root-b'});
const req=(uid='owner-a',data={})=>({auth:{uid},data});
const test=async(name,fn)=>{await fn();cases.push(name);};
const rejection=async(fn)=>assert.rejects(fn);
const signing=(key,text)=>crypto.sign(null,Buffer.from(text),key).toString('base64url');
const key=createWorkerKey();let enrollment,binding,transport,fetches=0;
const fakeFetch=async(url,options)=>{fetches++;const body=JSON.parse(options.body),name=url.split('/').at(-1);let result;if(name==='consumeWhatsAppConnectorEnrollment')result=await service.consume(body.data);else result=await service.operate(body.data.envelope,body.data.data);return {ok:true,json:async()=>({result})};};
Query.prototype.get=async function(){return this.db.read(this);};
const agentKey = createWorkerKey(), legacyKey = createWorkerKey();
const chat = '120363000000000001@g.us', otherChat = '120363000000000002@g.us';
const enc = encodeURIComponent;
const makeTransport = (privateKeyPem, binding) => createAuthorityTransport({ baseUrl: 'https://authority.invalid', privateKeyPem, binding, policy, fetchImpl: fakeFetch });
(async () => {
  let agentBinding, legacyBinding, agentTransport, legacyTransport;
  await test('unknown-agent-enrollment-rejected', () => rejection(() => service.create(req('owner-a', { publicKeyPem: agentKey.publicKeyPem, agentId: 'nope' }))));
  await test('legacy-and-agent-bindings-coexist-with-separate-owner-records', async () => {
    const legacy = await service.create(req('owner-a', { publicKeyPem: legacyKey.publicKeyPem }));
    legacyTransport = makeTransport(legacyKey.privateKeyPem);
    legacyBinding = (await legacyTransport.consume(legacy.enrollment)).binding;
    const agent = await service.create(req('owner-a', { publicKeyPem: agentKey.publicKeyPem, agentId: 'maria' }));
    agentTransport = makeTransport(agentKey.privateKeyPem);
    agentBinding = (await agentTransport.consume(agent.enrollment)).binding;
    assert.notEqual(legacyBinding.id, agentBinding.id);
    assert.equal(db.data('whatsappQrConnectorBindings/' + agentBinding.id).agentId, 'maria');
    assert.equal(db.data('whatsappQrConnectorBindings/' + legacyBinding.id).agentId, 'pay0');
    const owned = await service.getOwned(req('owner-a', { agentId: 'maria' }));
    assert.equal(owned.binding.id, agentBinding.id);
    assert.equal((await service.getOwned(req('owner-a'))).binding.id, legacyBinding.id);
  });
  await test('second-active-binding-for-same-agent-rejected', () => rejection(() => service.create(req('owner-a', { publicKeyPem: agentKey.publicKeyPem, agentId: 'maria' }))));
  await test('agent-sync-uses-own-collection-and-never-quarantines-shared-groups', async () => {
    const run = async (transport, groupName) => {
      const syncId = crypto.randomUUID();
      await transport.operate('SYNC_CHATS', { phase: 'BEGIN', syncId });
      const r = await transport.operate('SYNC_CHATS', { phase: 'UPSERT', syncId, chats: [{ chatId: chat, name: groupName, isGroup: true, archived: false, pinned: false }] });
      await transport.operate('SYNC_CHATS', { phase: 'FINISH', syncId });
      return r;
    };
    const a = await run(legacyTransport, 'Legacy'), b = await run(agentTransport, 'Maria');
    assert.equal(a.quarantined, 0); assert.equal(b.quarantined, 0);
    assert(db.data('whatsappQrChats/' + enc(chat)));
    assert(db.data('whatsappAgentChats/' + agentBinding.id + '__' + enc(chat)));
    assert.equal(db.data('whatsappQrChats/' + enc(chat)).name, 'Legacy');
  });
  await test('heartbeat-returns-only-groups-authorized-for-the-agent', async () => {
    db.seed('whatsappAgentObservers/root-a__' + enc(chat), { rootId: 'root-a', groupChatId: chat, active: true, ownerUserUid: 'user-betell', observers: [{ agentId: 'maria', phone: '' }] });
    db.seed('whatsappAgentObservers/root-a__' + enc(otherChat), { rootId: 'root-a', groupChatId: otherChat, active: true, ownerUserUid: 'user-ebasor', observers: [{ agentId: 'sentinel', phone: '' }] });
    const agent = await agentTransport.operate('HEARTBEAT', { ready: true, poll: true });
    assert.deepEqual(agent.observedChats, [chat]);
    const legacy = await legacyTransport.operate('HEARTBEAT', { ready: true, poll: true });
    assert.deepEqual(legacy.observedChats, []);
  });
  const message = (id, over = {}) => ({ messageId: id, chatId: chat, fromMe: false, timestampMs: Date.now(), type: 'chat', authorId: '5215500000000@c.us', body: 'hola', ...over });
  await test('inbound-stores-authorized-group-hashes-author-and-sets-expiry', async () => {
    const r = await agentTransport.operate('INBOUND_GROUP', { messages: [message('m1'), message('m2', { chatId: otherChat })] });
    assert.equal(r.stored, 1); assert.equal(r.discarded, 1); assert.equal(r.duplicates, 0);
    const row = db.data('whatsappInboundMessages/' + agentBinding.id + '__m1');
    assert.equal(row.rootId, 'root-a'); assert.equal(row.agentId, 'maria'); assert.equal(row.body, 'hola'); assert.equal(row.ownerUserUid, 'user-betell');
    assert(row.authorHash && !JSON.stringify(row).includes('5215500000000'));
    assert(row.expiresAt);
    assert.equal(db.data('whatsappInboundMessages/' + agentBinding.id + '__m2'), undefined);
  });
  await test('inbound-is-idempotent-per-message', async () => {
    const r = await agentTransport.operate('INBOUND_GROUP', { messages: [message('m1'), message('m3')] });
    assert.equal(r.stored, 1); assert.equal(r.duplicates, 1);
  });
  await test('inbound-rejected-for-legacy-binding-nongroup-and-oversize', async () => {
    await rejection(() => legacyTransport.operate('INBOUND_GROUP', { messages: [message('x1')] }));
    await rejection(() => agentTransport.operate('INBOUND_GROUP', { messages: [message('x2', { chatId: '5215500000000@c.us' })] }));
    await rejection(() => agentTransport.operate('INBOUND_GROUP', { messages: Array.from({ length: 26 }, (_, i) => message('big' + i)) }));
    await rejection(() => agentTransport.operate('INBOUND_GROUP', { messages: [{ ...message('x3'), extra: 1 }] }));
    await rejection(() => agentTransport.operate('INBOUND_GROUP', { messages: [message('x4', { body: 'a'.repeat(1001) })] }));
  });
  await test('inactive-or-unlisted-group-config-discards-everything', async () => {
    db.seed('whatsappAgentObservers/root-a__' + enc(chat), { rootId: 'root-a', groupChatId: chat, active: false, observers: [{ agentId: 'maria', phone: '' }] });
    const r = await agentTransport.operate('INBOUND_GROUP', { messages: [message('y1')] });
    assert.equal(r.stored, 0); assert.equal(r.discarded, 1);
    db.seed('whatsappAgentObservers/root-a__' + enc(chat), { rootId: 'root-a', groupChatId: chat, active: true, ownerUserUid: 'user-betell', observers: [{ agentId: 'maria', phone: '' }] });
  });
  await test('group-without-owner-user-is-not-observed-and-stores-nothing', async () => {
    db.seed('whatsappAgentObservers/root-a__' + enc(chat), { rootId: 'root-a', groupChatId: chat, active: true, observers: [{ agentId: 'maria', phone: '' }] });
    const hb = await agentTransport.operate('HEARTBEAT', { ready: true, poll: true });
    assert.deepEqual(hb.observedChats, []);
    const r = await agentTransport.operate('INBOUND_GROUP', { messages: [message('own1')] });
    assert.equal(r.stored, 0); assert.equal(r.discarded, 1);
    assert.equal(db.data('whatsappInboundMessages/' + agentBinding.id + '__own1'), undefined);
    db.seed('whatsappAgentObservers/root-a__' + enc(chat), { rootId: 'root-a', groupChatId: chat, active: true, ownerUserUid: 'user-betell', observers: [{ agentId: 'maria', phone: '' }] });
  });
  await test('list-owned-shows-each-agent-connector', async () => {
    const r = await service.listOwned(req('owner-a'));
    assert.deepEqual(r.connectors.map(c => c.agentId).sort(), ['maria', 'pay0']);
  });
  await test('activity-summary-measures-response-time-and-unanswered', async () => {
    const { summarizeAgentActivity } = require('../../functions/lib/modules/documentDelivery/whatsappAgentActivity.js');
    const rows = summarizeAgentActivity([
      { agentId: 'maria', chatId: chat, fromMe: false, timestampMs: 1000 },
      { agentId: 'maria', chatId: chat, fromMe: false, timestampMs: 2000 },
      { agentId: 'maria', chatId: chat, fromMe: true, timestampMs: 5000 },
      { agentId: 'maria', chatId: chat, fromMe: false, timestampMs: 9000 },
    ]);
    assert.equal(rows.length, 1);
    assert.deepEqual({ sent: rows[0].sent, received: rows[0].received, answered: rows[0].answered, unanswered: rows[0].unanswered, avg: rows[0].avgResponseMs }, { sent: 1, received: 3, answered: 1, unanswered: 1, avg: 4000 });
  });
  const fakeClient = () => { const callbacks = {}; return { callbacks, on: (n, cb) => { callbacks[n] = cb; }, initialize: async () => {}, destroy: async () => {}, getChats: async () => [] }; };
  const runCapture = async captureGroups => {
    const client = fakeClient(), calls = [], timers = [];
    const t = { getBinding: () => agentBinding, operate: async (action, data) => { calls.push([action, data]); return action === 'HEARTBEAT' ? { command: null, observedChats: [chat] } : { stored: data.messages?.length || 0 }; }, synchronize: async () => ({ written: 0, quarantined: 0 }) };
    const running = await runEnrolledConnector({ transport: t, client, encodeQr: async () => '', resetLocalSession: async () => {}, setTimer: fn => { timers.push(fn); return fn; }, clearTimer: () => {}, captureGroups });
    await client.callbacks.ready();
    await running.poll();
    return { client, calls, running };
  };
  await test('connector-capture-is-off-by-default', async () => {
    const { client, calls, running } = await runCapture(false);
    client.callbacks.message_create({ id: { _serialized: 'c1' }, from: chat, fromMe: false, timestamp: 1700000000, type: 'chat', body: 'hola', author: '5215500000000@c.us' });
    await running.flush();
    assert(!calls.some(c => c[0] === 'INBOUND_GROUP'));
  });
  await test('connector-captures-only-observed-groups-when-enabled', async () => {
    const { client, calls, running } = await runCapture(true);
    client.callbacks.message_create({ id: { _serialized: 'c1' }, from: chat, fromMe: false, timestamp: 1700000000, type: 'chat', body: 'hola', author: '5215500000000@c.us' });
    client.callbacks.message_create({ id: { _serialized: 'c2' }, from: otherChat, fromMe: false, timestamp: 1700000001, type: 'chat', body: 'no' });
    client.callbacks.message_create({ id: { _serialized: 'c3' }, from: '5215500000000@c.us', to: '5215500000001@c.us', fromMe: false, timestamp: 1700000002, type: 'chat', body: 'privado' });
    client.callbacks.message_create({ id: { _serialized: 'c4' }, to: chat, fromMe: true, timestamp: 1700000003, type: 'image', body: 'BASE64' });
    await running.flush();
    const sent = calls.filter(c => c[0] === 'INBOUND_GROUP');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0][1].messages.map(m => m.messageId), ['c1', 'c4']);
    assert.equal(sent[0][1].messages[1].body, '');
    assert.equal(sent[0][1].messages[1].fromMe, true);
  });
  assert(!db.log.some(p => /^(pagos|solicitudes|paymentApplications|documentDeliveryJobs)\//.test(p)));
  console.log(JSON.stringify({ status: 'PASS', checks: cases.length, cases, realProviderRequests: 0, mockFirestore: true }));
})().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(() => { Module._load = original; });
