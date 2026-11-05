'use strict';
// Preserve all message data; restore the legacy ID field omitted by newer WA serializers.
function installMessageCompatibility(exactSendSource){
 const api=window.WWebJS;if(!api||typeof api.getMessageModel!=='function')throw Error('MESSAGE_API_UNAVAILABLE');
 const alreadyInstalled=api.getMessageModel.pay0MessageIdCompatibility===true;
 const original=api.getMessageModel;
 function compatible(message){
  const result=original(message),key=result?.id;
  if(key&&!key._serialized&&typeof key.fromMe==='boolean'&&typeof key.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(key.id)){
   const serialized=value=>typeof value==='string'?value:value?._serialized;
   const remote=serialized(key.remote),participant=serialized(key.participant);
   if(typeof remote==='string'&&/^[0-9]+(?:-[0-9]+)?@(c\.us|s\.whatsapp\.net|g\.us|lid)$/.test(remote)&&(!participant||/^[0-9]+@(c\.us|s\.whatsapp\.net|lid)$/.test(participant))){
    result.id={...key,_serialized:String(key.fromMe)+'_'+remote+'_'+key.id+(participant?'_'+participant:'')};
   }
  }
  return result;
 }
 if(!alreadyInstalled){compatible.pay0MessageIdCompatibility=true;api.getMessageModel=compatible;}
 let receiptInstalled=false;
 if(typeof exactSendSource==='string'){
  const exact=(0,eval)('('+exactSendSource+')');
  if(typeof exact!=='function')throw Error('EXACT_SEND_FUNCTION_REQUIRED');
  exact.pay0ReceiptCompatibility=true;exact.pay0ExactReceiptCompatibility=true;api.sendMessage=exact;receiptInstalled=true;
 }

 if(typeof api.sendMessage==='function'&&!api.sendMessage.pay0ReceiptCompatibility){
  const originalSend=api.sendMessage;
  const keyOf=m=>{const k=m?.id;return k&&typeof k.id==='string'?JSON.stringify([k.fromMe,k.remote?._serialized||k.remote,k.id,k.participant?._serialized||k.participant||null]):null};
  async function sendWithReceipt(chat,content,options){
   if(typeof content!=='string'||typeof chat?.id?._serialized!=='string')return originalSend(chat,content,options);
   const collection=window.require('WAWebCollections').Msg,target=chat.id._serialized;
   const matches=m=>m?.id?.fromMe===true&&(m.id.remote?._serialized||m.id.remote)===target&&m.body===content;
   const before=new Set(collection.getModelsArray().filter(matches).map(keyOf));
   const result=await originalSend(chat,content,options);
   if(result)return result;
   const fresh=collection.getModelsArray().filter(m=>matches(m)&&keyOf(m)&&!before.has(keyOf(m)));
   return fresh.length===1?fresh[0]:result;
  }
  sendWithReceipt.pay0ReceiptCompatibility=true;api.sendMessage=sendWithReceipt;receiptInstalled=true;
 }
 return{installed:true,alreadyInstalled,receiptInstalled,exactReceipt:api.sendMessage?.pay0ExactReceiptCompatibility===true};
}
module.exports={installMessageCompatibility};
