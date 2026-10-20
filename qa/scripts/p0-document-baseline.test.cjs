const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createRequire}=require('node:module');
const functionsRequire=createRequire(require('node:path').resolve('functions/package.json'));
const {renderCanonicalQuotePdf,renderCanonicalConstanciaPdf}=functionsRequire('./lib/modules/documents/canonicalPdf.js');
process.env.PAY0_CHROMIUM_PATH=require('@playwright/test').chromium.executablePath();
const base={folio:'LOCAL-ONLY',companyName:'Synthetic company',companyRfc:'ACA180724QV3',clientName:'Synthetic client',clientRfc:'XAXX010101000',description:'Local regression fixture',verificationUrl:'https://example.invalid/local',reference:'LOCAL-OC',unitPrice:100,subtotal:100,iva:16,total:116};
test('preserved production renderer generates quotation locally with all network blocked',{timeout:60000},async()=>{
 const bytes=await renderCanonicalQuotePdf(base);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert(bytes.length>1000);
});
test('preserved production renderer generates receipt from canonical bundle locally',{timeout:60000},async()=>{
 const bytes=await renderCanonicalConstanciaPdf({...base,kind:'CONSTANCIA_SERVICIO',solicitudFolio:'LOCAL',receptorName:'Synthetic receiver',receptorRole:'Receiver',receiptLocation:'Local',receiptAddress:'Local address',acceptanceText:'Synthetic consent',observations:'',signatureHash:'synthetic',signaturePng:null,cfdi:'LOCAL',cotizacion:'LOCAL',iqFolio:''});assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert(bytes.length>1000);
});
