const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const dependencyRoot=process.env.PAY0_QA_DEPENDENCY_ROOT||path.join(root,'functions');
const actualRequire=createRequire(path.join(dependencyRoot,'package.json'));
const source=fs.readFileSync(path.join(root,'functions/src/modules/documents/canonicalPdf.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
let loads=0,closed=0;const html=[],qrCalls=[];let failPdf=false;
const qr=actualRequire('qrcode');
const context={exports:{},Buffer,process:{env:{}},require(name){
 if(name==='qrcode'){loads++;return {...qr,toBuffer:async(text,options)=>{qrCalls.push({text,options});return qr.toBuffer(text,options);}};}
 if(name==='fs')return {existsSync:()=>false};
 if(name==='./canonicalBundle')return {loadCanonicalBundle:()=>{throw Error('FIXTURE_BUNDLE_REQUIRED');}};
 if(name==='@sparticuz/chromium')return {__esModule:true,default:{args:[],executablePath:async()=>'/fake/chromium'}};
 if(name==='playwright-core')return {chromium:{launch:async()=>({newPage:async()=>({route:async()=>{},setContent:async value=>html.push(value),pdf:async()=>{if(failPdf)throw Error('FAKE_PDF_FAILURE');return Buffer.from('synthetic-pdf');}}),close:async()=>{closed++;}})}};
 throw Error('UNEXPECTED_IMPORT:'+name);
}};
vm.runInNewContext(compiled,context,{filename:'canonicalPdf.js'});
(async()=>{
 assert.equal(loads,0,'discovery must not load QRCode');
 const bundle={html:'<link href="template.css">{{qr}}{{qrSvg}}{{folio}}{{constanciaFolio}}',css:'fixture-css',logo:Buffer.from('fixture-logo')};
 const input={folio:'F-1',companyName:'Fixture',companyRfc:'FIX000000AA0',clientName:'Client',clientRfc:'FIX000000BB0',reference:'R-1',description:'Fixture',unitPrice:1,subtotal:1,iva:0,total:1,canonicalBundle:bundle,verificationUrl:'https://example.invalid/verify?fixture=1',solicitudFolio:'S-1',kind:'CONSTANCIA_SERVICIO',receiptLocation:'Fixture',receiptAddress:'Fixture',acceptanceText:'Fixture',signatureHash:'fixture'};
 const first=await context.exports.renderCanonicalQuotePdf(input);assert.equal(first.toString(),'synthetic-pdf');assert.equal(loads,1);
 await context.exports.renderCanonicalConstanciaPdf(input);assert.equal(loads,1,'both renderers share cached loader');assert.equal(closed,2);
 for(let i=0;i<2;i++){const expected=await qr.toBuffer(input.verificationUrl,{type:'png',width:i===0?220:180,margin:1,errorCorrectionLevel:'M'});assert(html[i].includes(expected.toString('base64')));assert.equal(qrCalls[i].text,input.verificationUrl);assert.equal(qrCalls[i].options.width,i===0?220:180);}
 failPdf=true;await assert.rejects(()=>context.exports.renderCanonicalConstanciaPdf(input),/FAKE_PDF_FAILURE/);assert.equal(closed,3);assert.equal(loads,1);
 assert.deepEqual(Object.keys(context.exports).sort(),['renderCanonicalConstanciaPdf','renderCanonicalQuotePdf']);
 console.log(JSON.stringify({checks:15,realQrPngComparisons:2,browserStarts:0,cloudCalls:0}));
})().catch(error=>{console.error(error);process.exitCode=1;});
