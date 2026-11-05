'use strict';
const crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function verifyOperator(uid,user,expectedHash,expectedRoot){
 if(!user || hash(uid)!==expectedHash || String(user.role||user.supervisorRole).toLowerCase()!=='superadmin' || user.active===false || ['disabled','inactive','blocked'].includes(String(user.status||'').toLowerCase()))throw Error('OPERATOR_NOT_AUTHORIZED');
 const rootId=String(user.rootId||uid);if(expectedRoot&&rootId!==expectedRoot)throw Error('OPERATOR_ROOT_CHANGED');return {uid,rootId};
}
function selectRecoveryCommands(rows,owner,includeStoppedProcessing=false){
 const states=includeStoppedProcessing?['PENDING','RESTARTING','PROCESSING']:['PENDING','RESTARTING'];
 const eligible=rows.filter(r=>r.data.connectorId==='default'&&r.data.rootId===owner.rootId&&r.data.requestedByUid===owner.uid&&r.data.type==='NEW_QR'&&states.includes(r.data.status));
 const pending=eligible.filter(r=>r.data.status==='PENDING').sort((a,b)=>(b.data.createdAt?.toMillis?.()||0)-(a.data.createdAt?.toMillis?.()||0)||a.id.localeCompare(b.id));
 return {selected:pending[0]||null,superseded:eligible.filter(r=>r.id!==pending[0]?.id)};
}
function verifyLease(row,token,owner,now){
 if(!row || row.rootId!==owner.rootId)throw Error('CONNECTOR_ROOT_CONFLICT');
 if(!Number.isFinite(now))throw Error('CONNECTOR_LEASE_LOST');
 const until=row.recoveryLeaseUntil?.toMillis?.();if(row.recoveryRunId!==token || !Number.isFinite(until) || until<=now)throw Error('CONNECTOR_LEASE_LOST');
}
function verifyAccount(info,suffix){const id=String(info?.wid?._serialized||'');if(!/^\d{7,20}(?::\d{1,6})?@(c\.us|s\.whatsapp\.net)$/.test(id))throw Error('ACCOUNT_SUFFIX_MISMATCH');const number=id.split('@')[0].split(':')[0];if(info?.wid?.user && String(info.wid.user)!==number)throw Error('ACCOUNT_SUFFIX_MISMATCH');if(!number.endsWith(suffix))throw Error('ACCOUNT_SUFFIX_MISMATCH');return hash(id);}
function verifyCommand(command,owner,type){if(!command||command.status!=='PENDING'||command.type!==type||command.connectorId!=='default'||command.rootId!==owner.rootId||command.requestedByUid!==owner.uid)throw Error('COMMAND_SCOPE_CHANGED');}
async function injectWithNavigationRetry(inject,isAlive,wait){for(let attempt=0;attempt<5;attempt++){if(!isAlive())return;try{return await inject();}catch(e){if(attempt===4||!/Execution context was destroyed|Cannot find context|Cannot find execution context/i.test(String(e.message||e)))throw e;await wait();}}}
module.exports={verifyOperator,selectRecoveryCommands,verifyLease,verifyAccount,verifyCommand,injectWithNavigationRetry,hash};
