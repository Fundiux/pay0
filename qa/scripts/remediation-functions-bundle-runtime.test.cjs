const assert=require('node:assert/strict');
const path=require('node:path');
const {createRequire}=require('node:module');
const {loadBundle}=require('./helpers/functions-bundle-harness.cjs');
const {expectedEndpointCount}=require('./verify-functions-discovery-startup.cjs');
const artifact=process.argv[2]; if(!artifact) throw Error('ARTIFACT_REQUIRED');
const dependencyRoot=path.resolve(__dirname,'../../functions');
const native=createRequire(path.join(dependencyRoot,'package.json'));
let checks=0,posts=0,qrLoads=0,closed=0,failPdf=false; const html=[],states=[];
const originalFetch=globalThis.fetch;
const keys=['PAY0_ENVIRONMENT','PAY0_EXTERNAL_ACTIONS_MODE','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'];
const env=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
process.env.PAY0_ENVIRONMENT='production'; delete process.env.PAY0_EXTERNAL_ACTIONS_MODE;
process.env.GCLOUD_PROJECT='demo-pay0-bundle';process.env.GOOGLE_CLOUD_PROJECT='demo-pay0-bundle';
const fakeFetch=async(_url,options)=>{if(options.method==='POST'){posts++;throw Error('ETIMEDOUT_AFTER_EFFECT');}return new Response('[]',{status:200});};
globalThis.fetch=fakeFetch;
const qr=native('qrcode');
const mocks={
 'playwright-core':{chromium:{launch:async()=>({newPage:async()=>({route:async()=>{},setContent:async x=>html.push(x),pdf:async()=>{if(failPdf)throw Error('SYNTHETIC_PDF_FAILURE');return Buffer.from('synthetic-pdf');}}),close:async()=>{closed++;}})}},
 '@sparticuz/chromium':{__esModule:true,default:{args:[],executablePath:async()=>'/synthetic/chromium'}},
};
Object.defineProperty(mocks,'qrcode',{enumerable:true,get(){qrLoads++;return qr;}});
async function run(){
 const bundle=loadBundle({artifact,dependencyRoot,externalMocks:mocks,fetch:fakeFetch});
 assert.equal(Object.keys(bundle.api).length,expectedEndpointCount);checks++;
 assert.equal(typeof bundle.api.listClientDispersionNotes,'function');checks++;
 assert.equal(qrLoads,0);checks++;
 const guard=bundle.loadInternal('utils/authGuard.js');
 const valid=()=>({rootId:'root',role:'operador',active:true,modules:{pagos:{create:true,conciliate:true}}});
 const options={requiredModule:'pagos',requiredAction:['create','conciliate']};
 let profile=valid();
 const authorize=async()=>guard.assertAuthorized({uid:'actor'},profile,options);
 assert.equal(await authorize(),'operador');checks++;
 for(const change of [null,{active:false},{isActive:false},{disabled:true},{deleted:true},{isDeleted:true},{deletedAt:Date.now()},{role:'unknown'},{modules:{pagos:{create:false,conciliate:false}}},{trustedRestrictionV1:null}]){
  profile=change===null?null:{...valid(),...change};await assert.rejects(authorize);checks++;
 }
 const core=bundle.loadInternal('modules/iq/depositHttpCreateCore.js');
 const effect=()=>core.createIqDepositHttpControlled({authorizeBeforePost:authorize,auth:{apiOrigin:'https://provider.invalid',bearerToken:'synthetic'},
 identity:{pay0PagoId:'payment',iqAttemptId:'attempt',pay0CreatedAtIso:'2026-10-06T20:00:00Z',partnerId:1,partnerName:'Partner',clientId:2,clientName:'Client',companyId:3,companyName:'Company',operationTypeId:4,operationTypeName:'Deposit',saleType:'standard',sum:100,currency:'mxn',expectedSalePercentageId:1,expectedBasePercentage:'0',expectedSalePercentage:'0'},
 voucher:{bytes:new Uint8Array([1]),originalName:'synthetic.pdf',mimeType:'application/pdf'},lock:{acquire:async()=>({lockKey:'fixture',lockedAtIso:new Date().toISOString(),leaseExpiresAtIso:new Date(Date.now()+60000).toISOString()}),release:async()=>{}},journal:{transition:async x=>states.push(x.state),linkIqIdWriteOnce:async()=>{throw Error('UNEXPECTED_LINK');}},allowHttpPost:true,recovery:{pollingBackoffMs:[0],maxPages:1,pageSize:100}});
 profile={...valid(),active:false};await assert.rejects(effect);assert.equal(posts,0);checks+=2;
 profile=valid();assert.equal((await effect()).state,'OUTCOME_UNKNOWN');assert.equal(posts,1);checks+=2;
 profile={...valid(),active:false};await assert.rejects(effect);assert.equal(posts,1);assert.equal(states.at(-1),'OUTCOME_UNKNOWN');checks+=3;
 const assets=bundle.loadInternal('modules/documents/canonicalBundle.js');
 let assetBundles=0,first;
 for(const company of assets.canonicalCompanyCatalog())for(const use of ['COTIZACION','CONSTANCIA_ENTREGA_BIENES','CONSTANCIA_SERVICIO']){
  const asset=assets.loadCanonicalBundle(company.rfc,use);assert(asset.reference.length>0&&asset.logo.length>0&&asset.html.length>0&&asset.css.length>0);assert.match(asset.snapshot.templateBundleSha256,/^[a-f0-9]{64}$/);checks+=2;assetBundles++;first||=asset;
 }
 assert(assetBundles>0);checks++;
 const pdf=bundle.loadInternal('modules/documents/canonicalPdf.js');
 const input={folio:'F-1',companyName:'Fixture',companyRfc:'FIX000000AA0',clientName:'Client',clientRfc:'FIX000000BB0',reference:'R-1',description:'Fixture',unitPrice:1,subtotal:1,iva:0,total:1,canonicalBundle:{...first,html:'{{qr}}{{qrSvg}}{{folio}}'},verificationUrl:'https://example.invalid/fixture',solicitudFolio:'S-1',kind:'CONSTANCIA_SERVICIO',receiptLocation:'Fixture',receiptAddress:'Fixture',acceptanceText:'Fixture',signatureHash:'fixture'};
 assert.equal((await pdf.renderCanonicalQuotePdf(input)).toString(),'synthetic-pdf');await pdf.renderCanonicalConstanciaPdf(input);assert.equal(qrLoads,1);assert.equal(closed,2);checks+=3;
 for(let i=0;i<2;i++){const expected=await qr.toBuffer(input.verificationUrl,{type:'png',width:i===0?220:180,margin:1,errorCorrectionLevel:'M'});assert(html[i].includes(expected.toString('base64')));checks++;}
 failPdf=true;await assert.rejects(()=>pdf.renderCanonicalConstanciaPdf(input),/SYNTHETIC_PDF_FAILURE/);assert.equal(closed,3);checks+=2;
 console.log(JSON.stringify({checks,assetBundles,bundleSha256:bundle.sha256,providerRequests:0,syntheticPosts:posts,realQrPngComparisons:2,browserStarts:0}));
}
run().catch(error=>{console.error(JSON.stringify({result:'FAILED',name:error.name,code:error.code||'ASSERTION_OR_FIXTURE'}));process.exitCode=1;}).finally(()=>{globalThis.fetch=originalFetch;for(const key of keys){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}});
