"use strict";
// Closed projections only: never serialize an exception, arguments, or payload.
const assert = require('node:assert/strict');
const STAGES = new Set(['PREPARE','DEPLOY','RELEASE','STREAM','UPLOAD_URL','UPLOAD_PUT']);
const CODES = new Set(['UPLOAD_EXTENSIONS','UPLOAD_NONINTERACTIVE','UPLOAD_PROJECT','UPLOAD_REGION','UPLOAD_PLATFORM','UPLOAD_FILTERS','UPLOAD_CODEBASE_COUNT','UPLOAD_CODEBASE','UPLOAD_MANIFEST_IDS','UPLOAD_TARGETING','STREAM_ORDER_OR_REPLAY','ZIP_PATH','ZIP_DRIFT','UPLOAD_URL_ORDER_OR_REPLAY','UPLOAD_SOURCE','UPLOAD_GENERATION','UPLOAD_URL','UPLOAD_URL_PROTOCOL','UPLOAD_URL_HOST','UPLOAD_URL_COMPONENTS','UPLOAD_URL_SIGNATURE','UPLOAD_ORDER_OR_REPLAY','UPLOAD_PATH','UPLOAD_STREAM','UPLOAD_DESTINATION','UPLOAD_HEADERS','UPLOAD_QUOTA','UPLOADED_GENERATION','GENERATION_MISMATCH']);
function code(error) {
 try {
  // AssertionError may append a diff: accept only a known first line.
  const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error,'message') : null;
  const first = descriptor && typeof descriptor.value === 'string' ? descriptor.value.split('\n',1)[0].trim() : '';
  return CODES.has(first) ? first : 'UNCLASSIFIED';
 } catch { return 'UNCLASSIFIED'; }
}
function instrument(owner,key,stage,emit,{sync=false}={}) {
  assert.ok(STAGES.has(stage),'DIAGNOSTIC_STAGE');
  const original=owner[key];assert.equal(typeof original,'function','DIAGNOSTIC_CONTRACT');
  const report=(state,error)=>{
    try {emit({stage,state,...(state==='FAILED'?{code:code(error)}:{})});}
    catch {try {process.stderr.write('NOTES_UPDATE_DIAGNOSTIC_UNAVAILABLE\n');} catch {}}
  };
  owner[key]=sync ? function(...args) {
    report('ENTER');try {const result=original.apply(this,args);report('RETURN');return result;}
    catch(error){report('FAILED',error);throw error;}
  } : async function(...args) {
    report('ENTER');try {const result=await original.apply(this,args);report('RETURN');return result;}
    catch(error){report('FAILED',error);throw error;}
  };
}
module.exports={instrument,code};
