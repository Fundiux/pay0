const assert=require('node:assert/strict'),path=require('node:path');
const {createRequire}=require('node:module');
const {loadBundle}=require('./helpers/functions-bundle-harness.cjs');
const artifact=process.argv[2];if(!artifact)throw Error('ARTIFACT_REQUIRED');
const dependencyRoot=path.resolve(__dirname,'../../functions'),native=createRequire(path.join(dependencyRoot,'package.json'));
global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
async function run(){
 const SQL=await native('sql.js')({locateFile:name=>native.resolve(`sql.js/dist/${name}`)});
 const seed=new SQL.Database();
 seed.run("CREATE TABLE cfdi_40_productos_servicios(id,texto,iva_trasladado,ieps_trasladado,complemento,vigencia_desde,vigencia_hasta,estimulo_frontera,similares); INSERT INTO cfdi_40_productos_servicios VALUES('12345678','Synthetic','','','','2020-01-01','',0,''); CREATE TABLE cfdi_40_claves_unidades(id,texto,descripcion,notas,vigencia_desde,vigencia_hasta,simbolo); INSERT INTO cfdi_40_claves_unidades VALUES('E48','Synthetic','','','2020-01-01','','');");
 const sqlite=Buffer.from(seed.export());seed.close();
 const bzip=Buffer.from('BZhsynthetic');let wasmLoads=0,batchAttempts=0;
 const rows=new Map([['users/actor',{rootId:'root',role:'superadmin',active:true}],['satCatalogImports/fixture',{rootId:'root',status:'PENDING_UPLOAD',storagePath:'synthetic',fileSize:bzip.length}]]);
 const ref=key=>({path:key,id:key.split('/').at(-1),get:async()=>({exists:rows.has(key),data:()=>rows.get(key)}),update:async value=>{assert(rows.has(key));Object.assign(rows.get(key),value);}});
 const db={doc:ref,collection:key=>({doc:id=>ref(`${key}/${id}`)}),batch:()=>({set:(_ref,value)=>{assert.equal(value.code,'12345678');assert.equal(value.description,'Synthetic');batchAttempts++;throw Error('SYNTHETIC_STOP_AFTER_SQLITE_PARSE');}})};
 const realAdmin=native('firebase-admin'),realFirestore=native('firebase-admin/firestore');if(!realAdmin.apps.length)realAdmin.initializeApp({projectId:'demo-pay0-bundle-wasm'});
 const fakeAdmin={...realAdmin,firestore:Object.assign(()=>db,realAdmin.firestore)};Object.defineProperty(fakeAdmin,'apps',{enumerable:true,get:()=>realAdmin.apps});
 const mocks={'firebase-admin':fakeAdmin,'firebase-admin/firestore':{...realFirestore,getFirestore:()=>db},'firebase-admin/storage':{...native('firebase-admin/storage'),getStorage:()=>({bucket:()=>({file:()=>({exists:async()=>[true],download:async()=>[bzip]})})})},'seek-bzip':{decode:()=>sqlite},'sql.js':async options=>{wasmLoads++;const resolved=options.locateFile('sql-wasm.wasm');assert.equal(resolved,native.resolve('sql.js/dist/sql-wasm.wasm'));return native('sql.js')(options);}};
 const bundle=loadBundle({artifact,dependencyRoot,externalMocks:mocks});
 const catalog=bundle.loadInternal('modules/facturama/satGlobalCatalog.js');
 await assert.rejects(()=>catalog.finalizeGlobalSatCatalogImportCore({auth:{uid:'actor'},data:{importId:'fixture',effectiveAsOf:'2026-10-10'}}),/SYNTHETIC_STOP_AFTER_SQLITE_PARSE/);
 assert.equal(wasmLoads,1);assert.equal(batchAttempts,1);assert.equal(rows.get('satCatalogImports/fixture').status,'IMPORT_FAILED');
 console.log(JSON.stringify({bundleSha256:bundle.sha256,realWasmInitializations:2,bundledResolverExecutions:1,syntheticParsedRowsVerified:1,remoteReads:0,remoteWrites:0}));
}
run().catch(error=>{console.error(JSON.stringify({result:'FAILED',name:error.name,code:error.code||'FIXTURE_OR_ASSERTION'}));process.exitCode=1;});
