'use strict';
const {createHash}=require('node:crypto');
const MANAGED_BY='pay0-scoped-whatsapp-sync-v1';
const BATCH_SIZE=350;
function scopePrefix(rootId){
 if(typeof rootId!=='string'||!rootId.trim())throw Error('SYNC_ROOT_REQUIRED');
 return 'root_'+createHash('sha256').update(rootId).digest('hex').slice(0,24)+'__';
}
function stableDocId(rootId,chatId){return scopePrefix(rootId)+encodeURIComponent(chatId);}
function jid(value){return typeof value==='string'?value:typeof value?._serialized==='string'?value._serialized:null;}
function text(value){return typeof value==='string'?value.slice(0,512):'';}
function normalizeSnapshot(chats,contacts){
 if(!Array.isArray(chats)||!Array.isArray(contacts))throw Error('SYNC_INCOMPLETE_SNAPSHOT');
 const rows=new Map();
 const valid=id=>typeof id==='string'&&id.length<=400&&/^[^/@\s]+@(g\.us|c\.us|lid)$/.test(id);
 for(const contact of contacts){
  const id=jid(contact?.id);if(!valid(id)||id.endsWith('@g.us'))continue;
  rows.set(id,{chatId:id,name:text(contact.name||contact.pushname||contact.shortName||contact.number),isGroup:false,archived:false,pinned:false,isContact:true});
 }
 for(const chat of chats){
  const id=jid(chat?.id);if(!valid(id))continue;
  const previous=rows.get(id)||{};
  rows.set(id,{...previous,chatId:id,name:text(chat.name)||previous.name||'',isGroup:id.endsWith('@g.us'),archived:chat.archived===true,pinned:chat.pinned===true,isContact:previous.isContact===true,...(Number.isFinite(chat.timestamp)?{timestamp:chat.timestamp}:{})});
 }
 return [...rows.values()].sort((a,b)=>a.chatId.localeCompare(b.chatId));
}
// Metadata only: never touches authentication, message bodies, old/unscoped IDs,
// or prunes absent records. Even a complete API result may be a partial WA view.
async function syncSnapshot({db,owner,connectorRef,sessionId,authClientId=sessionId,chats,contacts,assertAuthority,timestamp}){
 const rootId=owner?.rootId,connectorId=connectorRef?.id;
 scopePrefix(rootId);
 if(!owner?.uid||!connectorId||!sessionId||!authClientId||typeof assertAuthority!=='function'||timestamp===undefined)throw Error('SYNC_BINDING_REQUIRED');
 const rows=normalizeSnapshot(chats,contacts);
 const refFor=row=>db.collection('whatsappQrChats').doc(stableDocId(rootId,row.chatId));
 // Each independent chunk re-reads owner/lease via caller before any write.
 // A revoked lease can leave earlier chunks committed; caller must mark ERROR,
 // never DONE, until a fresh authorized complete run has succeeded.
 for(let start=0;start<Math.max(rows.length,1);start+=BATCH_SIZE){
  const chunk=rows.slice(start,start+BATCH_SIZE);
  await db.runTransaction(async tx=>{
   await assertAuthority(tx);
   const snapshots=await Promise.all(chunk.map(row=>tx.get(refFor(row))));
   for(let i=0;i<chunk.length;i++){
    const row=chunk[i],old=snapshots[i].exists?snapshots[i].data():null;
    if(old&&(old.rootId!==rootId||old.connectorId!==connectorId||old.managedBy!==MANAGED_BY||old.chatId!==row.chatId))throw Error('SYNC_DOCUMENT_SCOPE_CONFLICT');
   }
   for(const row of chunk){
    const safeDocId=stableDocId(rootId,row.chatId);
    tx.set(refFor(row),{...row,safeDocId,rootId,connectorId,ownerUid:owner.uid,authClientId,sessionId,managedBy:MANAGED_BY,active:true,lastSyncedAt:timestamp,updatedAt:timestamp},{merge:true});
   }
  });
 }
 return {total:rows.length,groups:rows.filter(r=>r.isGroup).length,contacts:rows.filter(r=>!r.isGroup).length,pruned:0};
}
module.exports={syncSnapshot,normalizeSnapshot,stableDocId,scopePrefix,MANAGED_BY,BATCH_SIZE};
