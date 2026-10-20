import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const FAMILIES = ['uploads', 'entityDocuments', 'assetDocuments'];
export const FIELDS = ['rootId','status','active','isDeleted','deleted','deletedAt','uploadStatus','entityType','entityId','documentType','solicitudId','pagoId','dispersionId','ownerUid','storagePath','sizeBytes','fileSize'];
const LIMIT = 32 * 1024 * 1024;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 180 && !/[\/\\\x00-\x1f]/.test(value);
const clean = value => typeof value === 'string' ? value.trim() : '';
const upper = value => clean(value).toUpperCase();
const unavailable = row => !row || row.active === false || row.isDeleted === true || row.deleted === true || row.deletedAt != null || ['ELIMINADA','ELIMINADO','DELETED'].includes(upper(row.status));
const operations = {solicitudes:['solicitudes','solicitudId','solicitudes'],pagos:['pagos','pagoId','pagos'],clientDispersions:['clientDispersions','dispersionId','dispersiones']};
export function classify(family, documentId, row, rootId) {
  const flags = [];
  if (row.rootId !== rootId) return { eligible:false, flags:['OUT_OF_SCOPE'] };
  const status = upper(row.status);
  if (unavailable(row) || (family === 'uploads' ? !(['READY','ACTIVE','FINALIZED'].includes(status) || (!status && row.active === true)) : status !== 'ACTIVE')) return {eligible:false,flags:['NOT_FINALIZED_OR_INACTIVE']};
  let prefix, parent;
  if (family === 'uploads') {
    const kind = Object.hasOwn(operations, clean(row.entityType)) ? clean(row.entityType) : row.dispersionId ? 'clientDispersions' : row.pagoId ? 'pagos' : row.solicitudId ? 'solicitudes' : '';
    const config = operations[kind];
    if (!config) flags.push('UNKNOWN_UPLOAD_FAMILY');
    else if (!id(row[config[1]])) flags.push('MISSING_CANONICAL_PARENT_FIELD');
    else {parent={collection:config[0],id:row[config[1]]};prefix=`roots/${rootId}/${config[2]}/${parent.id}/`;}
    if (id(row.entityId) && (!config || !id(row[config[1]]))) flags.push('ENTITY_ID_ONLY_LEGACY');
  } else if (family === 'entityDocuments') {
    const entities = {CLIENTE:'clients',COMPANY:'companies',DESPACHO:'despachos'};
    const collection = Object.hasOwn(entities,row.entityType)?entities[row.entityType]:null;
    if (!collection || !id(row.entityId) || !id(row.documentType)) flags.push('INVALID_ENTITY_REFERENCE');
    else {parent={collection,id:row.entityId,legacyRootAllowed:true};prefix=`roots/${rootId}/entityDocuments/${row.entityType}/${row.entityId}/${row.documentType}/`;}
    if (row.uploadStatus !== 'FINALIZED') flags.push('ENTITY_UPLOAD_NOT_FINALIZED');
  } else if (family === 'assetDocuments') {
    if (!id(row.ownerUid) || !id(documentId)) flags.push('INVALID_ASSET_REFERENCE');
    else prefix=`roots/${rootId}/assets/${row.ownerUid}/documents/${documentId}/`;
  }
  if(family==='uploads'&&!parent)flags.push('CANONICAL_PARENT_UNRESOLVED');
  const storagePath=clean(row.storagePath);
  const safePath=!!prefix && storagePath.startsWith(prefix) && storagePath.length>prefix.length && !storagePath.includes('..') && !/[\\\x00-\x1f]/.test(storagePath);
  if (!storagePath) flags.push('MISSING_STORAGE_PATH');
  else if (!safePath) flags.push('INVALID_OR_UNVERIFIABLE_PREFIX');
  else if (family === 'uploads') {const tail=storagePath.slice(prefix.length);flags.push(!tail.includes('/')?'FLAT_LEGACY':tail.startsWith('docs/')?'DOCS_LAYOUT':'OTHER_PREFIX_LAYOUT');}
  const size=Number(row.sizeBytes ?? row.fileSize);
  flags.push(!Number.isSafeInteger(size)||size<0?'RECORDED_SIZE_UNKNOWN':size>LIMIT?'RECORDED_OVER_32_MIB':'RECORDED_WITHIN_32_MIB');
  return {eligible:true,flags,parent,storagePath:safePath?storagePath:null};
}
const inc=(counts,key)=>{counts[key]=(counts[key]||0)+1;};
export function validateOptions(options) {
  assert.match(options.project,/^[a-z][a-z0-9-]{4,62}$/);
  assert.ok(id(options.root));
  assert.ok(options.families.length && new Set(options.families).size===options.families.length && options.families.every(x=>FAMILIES.includes(x)));
  assert.ok(Number.isInteger(options.pageSize)&&options.pageSize>=1&&options.pageSize<=100);
  assert.ok(Number.isInteger(options.maxRecords)&&options.maxRecords>=1&&options.maxRecords<=1000);
  assert.ok(Number.isInteger(options.maxMetadata)&&options.maxMetadata>=0&&options.maxMetadata<=1000);
  if(options.withStorageMetadata)assert.match(options.bucket,/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/);
  return options;
}
export function scopeHash(options) {return createHash('sha256').update(JSON.stringify([1,options.project,options.root,options.bucket||'',options.families,!!options.withStorageMetadata])).digest('hex');}
export async function inventory(adapter, options, checkpoint) {
  validateOptions(options);
  const scope=scopeHash(options);
  const state=checkpoint?structuredClone(checkpoint):{schemaVersion:1,scope,familyIndex:0,cursors:{},counts:{},complete:false};
  assert.equal(state.schemaVersion,1);assert.equal(state.scope,scope);assert.ok(Number.isInteger(state.familyIndex)&&state.familyIndex>=0&&state.familyIndex<=options.families.length);
  let records=0,pages=0,parentReads=0,metadataReads=0;
  const parentCache=new Map();
  while(state.familyIndex<options.families.length && records<options.maxRecords){
    const family=options.families[state.familyIndex],cursor=state.cursors[family]||null;
    const page=await adapter.list(family,{rootId:options.root,after:cursor,limit:Math.min(options.pageSize,options.maxRecords-records),fields:FIELDS});pages++;
    assert.ok(Array.isArray(page)&&page.length<=Math.min(options.pageSize,options.maxRecords-records));
    if(!page.length){state.familyIndex++;continue;}
    let previous=cursor;
    for(const item of page){
      assert.ok(id(item.id)&&(!previous||item.id>previous),'Adapter must return ordered unique IDs');previous=item.id;records++;
      const counts=state.counts[family] ||= {};inc(counts,'SCANNED');
      const result=classify(family,item.id,item.data,options.root);for(const flag of result.flags)inc(counts,flag);
      if(result.eligible){inc(counts,'ELIGIBLE_STATUS');
        if(result.parent){const key=result.parent.collection+'/'+result.parent.id;let parent;
          if(parentCache.has(key))parent=parentCache.get(key);else{parent=await adapter.parent(result.parent.collection,result.parent.id);parentCache.set(key,parent);parentReads++;}
          inc(counts,!parent?'PARENT_DOCUMENT_MISSING':unavailable(parent)?'PARENT_UNAVAILABLE':parent.rootId!==options.root&&!(result.parent.legacyRootAllowed&&!parent.rootId)?'PARENT_ROOT_MISMATCH':'PARENT_METADATA_MATCH');
        }
        if(options.withStorageMetadata&&result.storagePath){
          if(metadataReads>=options.maxMetadata)inc(counts,'OBJECT_SIZE_NOT_CHECKED_BUDGET');
          else{metadataReads++;try{const metadata=await adapter.metadata(result.storagePath);const size=Number(metadata.size);inc(counts,!Number.isSafeInteger(size)||size<0?'OBJECT_SIZE_UNKNOWN':size>LIMIT?'OBJECT_OVER_32_MIB':'OBJECT_WITHIN_32_MIB');}catch(error){if(Number(error.code)===404)inc(counts,'OBJECT_MISSING');else throw Error('METADATA_READ_FAILED');}}
        }
      }
      state.cursors[family]=item.id;
    }
    if(adapter.save)await adapter.save(state);
  }
  state.complete=state.familyIndex===options.families.length;if(adapter.save)await adapter.save(state);
  return {checkpoint:state,summary:{mode:'READ_ONLY',scope,complete:state.complete,counts:state.counts,batch:{records,pages,parentReads,metadataReads},securityClosure:false}};
}
export function parseArgs(args){
  const allowed=['project','root','bucket','families','page-size','max-records','max-metadata','checkpoint'];const values={};let execute=false,withStorageMetadata=false;
  for(let i=0;i<args.length;i++){const key=args[i];if(key==='--execute-read-only'){execute=true;continue;}if(key==='--with-storage-metadata'){withStorageMetadata=true;continue;}assert.ok(key.startsWith('--')&&allowed.includes(key.slice(2))&&args[i+1]&&!args[i+1].startsWith('--'),'Unknown or missing option');assert.ok(!Object.hasOwn(values,key.slice(2)),'Duplicate option');values[key.slice(2)]=args[++i];}
  const options=validateOptions({project:values.project||'demo-pay0-document-inventory',root:values.root||'fixture-root',bucket:values.bucket||'',families:(values.families||'uploads,entityDocuments,assetDocuments').split(','),pageSize:Number(values['page-size']||50),maxRecords:Number(values['max-records']||200),maxMetadata:Number(values['max-metadata']||50),withStorageMetadata});
  if(execute){assert.ok(values.project&&values.root&&values.checkpoint,'Execution needs explicit project, root and local checkpoint');assert.ok(!process.env.FIRESTORE_EMULATOR_HOST&&!process.env.FIREBASE_STORAGE_EMULATOR_HOST,'Use injected fixtures for local tests');}
  return {execute,options,checkpointFile:values.checkpoint};
}
export async function main(args){
  const {execute,options,checkpointFile}=parseArgs(args);
  if(!execute){console.log(JSON.stringify({mode:'DRY_RUN',scope:scopeHash(options),collections:options.families,maxRecords:options.maxRecords,pageSize:options.pageSize,maxParentReads:options.maxRecords,maxMetadataReads:options.withStorageMetadata?Math.min(options.maxRecords,options.maxMetadata):0,noNetwork:true,noWrites:true}));return;}
  process.env.DEBUG='';
  const require=createRequire(new URL('../../functions/package.json',import.meta.url));const admin=require('firebase-admin');
  const app=admin.initializeApp({projectId:options.project,...(options.withStorageMetadata?{storageBucket:options.bucket}:{})},'document-inventory');
  try{const db=app.firestore();const checkpoint=fs.existsSync(checkpointFile)?JSON.parse(fs.readFileSync(checkpointFile,'utf8')):undefined;
    const adapter={
      async list(family,{rootId,after,limit,fields}){let query=db.collection(family).where('rootId','==',rootId).orderBy(admin.firestore.FieldPath.documentId()).select(...fields).limit(limit);if(after)query=query.startAfter(after);const snap=await query.get();return snap.docs.map(doc=>({id:doc.id,data:doc.data()}));},
      async parent(collection,id){const snap=await db.collection(collection).select('rootId','status','active','isDeleted','deleted','deletedAt').where(admin.firestore.FieldPath.documentId(),'==',id).limit(1).get();return snap.empty?null:snap.docs[0].data();},
      async metadata(storagePath){const [metadata]=await app.storage().bucket(options.bucket).file(storagePath).getMetadata({fields:'size'});return {size:metadata.size};},
      async save(state){const target=path.resolve(checkpointFile),pending=target+'.pending';fs.writeFileSync(pending,JSON.stringify(state,null,2)+'\n',{mode:0o600});fs.renameSync(pending,target);},
    };
    const result=await inventory(adapter,options,checkpoint);console.log(JSON.stringify(result.summary));
  }finally{await app.delete();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(()=>{console.error(JSON.stringify({error:'INVENTORY_FAILED',detailsRedacted:true,productionWrites:false}));process.exitCode=1;});
