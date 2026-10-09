const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) throw Error('LOCAL_EMULATOR_REQUIRED');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const domain = require('../../functions/lib/modules/paymentApplications/automaticDomain');
const automatic = require('../../functions/lib/modules/paymentApplications/automaticApplication');
const service = require('../../functions/lib/modules/paymentApplications/service');
const iq = require('../../functions/lib/modules/paymentApplications/callables');
const rootId = `automatic-${Date.now()}`;
let checks = 0;
function check(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
const payment = {rootId, clienteId: rootId, companyId: rootId, createdBy: rootId, adminId: rootId,
  automaticApplicationEligible: true, automaticApplicationRevision: 'ASTRA_V1', status: 'CONCILIADO',
  financialPostingStatus: 'POSTED', moneda: 'MXN', montoTotal: 58, montoDisponibleSolicitudes: 58, montoAplicadoSolicitudes: 0, referencia: 'PAGO S100C1U1E1'};
const invoice = {id: 'invoice-a', rootId, clienteId: rootId, companyId: rootId, createdBy: rootId, adminId: rootId,
  status: 'PROCESANDO', moneda: 'MXN', monto: 116, totalAbonado: 0, tipoFactura: 'PPD', folio: 'S100C1U1E1',
  facturaUuid: '11111111-1111-4111-8111-111111111111', facturaSerie: 'F', facturaFolio: '12345'};
const decide = (p = {}, rows = [invoice]) => domain.decideAutomaticPayment('payment', {...payment, ...p}, rows);

(async () => {
  check(decide().status, 'READY', 'partial exact match');
  check(decide().batch.totalAmount, 58, 'partial cents');
  check(decide({referencia: invoice.facturaUuid}).status, 'READY', 'full UUID');
  check(decide({referencia: 'Pago F-12345'}).status, 'READY', 'complete series and folio');
  check(decide({referencia: 'XS100C1U1E19'}).reason, 'NO_EXACT_INVOICE_REFERENCE', 'no substring');
  check(decide({referencia: ''}).reason, 'MISSING_INVOICE_REFERENCE', 'amount is not identity');
  check(decide({automaticApplicationEligible: false}).status, 'WAITING', 'legacy excluded');
  check(decide({financialPostingStatus: 'PENDING'}).status, 'WAITING', 'posting required');
  check(decide({moneda: 'USD'}).reason, 'CURRENCY_MISMATCH', 'no currency conversion');
  check(decide({montoTotal: 117, montoDisponibleSolicitudes: 117}).reason, 'AMOUNT_EXCEEDS_INVOICE', 'no overpayment');
  check(decide({}, [{...invoice, rootId:'other'}]).reason, 'NO_EXACT_INVOICE_REFERENCE', 'root excluded');
  check(decide({}, [{...invoice, companyId:'other'}]).reason, 'NO_EXACT_INVOICE_REFERENCE', 'company excluded');
  check(decide({}, [{...invoice, clienteId:'other'}]).reason, 'NO_EXACT_INVOICE_REFERENCE', 'client excluded');
  check(decide({}, [{...invoice, status:'CANCELADA'}]).reason, 'INVOICE_NOT_PAYABLE', 'terminal protected');
  for (const source of [
    {facturamaEnvironment:'SANDBOX',facturamaAutoDraftStatus:'SANDBOX_ISSUED',facturaMetadataSource:'FACTURAMA_XML'},
    {facturamaEnvironment:'TEST'}, {facturamaAutoDraftStatus:'SANDBOX_ISSUED'}, {facturaUuidSandbox:invoice.facturaUuid},
  ]) check(decide({},[{...invoice,...source}]).reason,'NON_PRODUCTION_INVOICE','explicit non-production cannot reuse an inherited UUID');
  for (const source of [
    {facturamaEnvironment:'UNKNOWN'}, {facturaMetadataSource:'FACTURAMA_XML'},
    {facturaMetadataSource:'FACTURAMA_XML_RECONCILED',facturamaEnvironment:'PRODUCTION',facturamaAutoDraftStatus:'DRAFT'},
    {uuidCfdi:'22222222-2222-4222-8222-222222222222'},
  ]) check(decide({},[{...invoice,...source}]).reason,'AMBIGUOUS_INVOICE_FISCAL_SOURCE','contradictory fiscal metadata requires review');
  for (const source of [
    {facturaMetadataSource:'IQ_INVOICE_ZIP'}, {facturaMetadataSource:'FACTURA_XML'},
    {facturaMetadataSource:'FACTURAMA_XML',facturamaEnvironment:'PRODUCTION',facturamaAutoDraftStatus:'PRODUCTION_ISSUED'},
  ]) check(decide({},[{...invoice,...source}]).status,'READY','canonical production metadata remains eligible');
  const second = {...invoice, id:'invoice-b', folio:'S101C1U1E1', facturaUuid:'22222222-2222-4222-8222-222222222222'};
  const bothReference = `${invoice.folio} ${second.folio}`;
  check(decide({referencia:bothReference},[invoice,second]).reason, 'MULTIPLE_INVOICES_REQUIRE_ALLOCATION', 'ambiguous allocation');
  check(decide({referencia:bothReference,montoTotal:232,montoDisponibleSolicitudes:232},[invoice,second]).batch.applications.length, 2, 'exact multi-invoice sum');
  check(decide({referencia:bothReference,montoTotal:232,montoDisponibleSolicitudes:232},[invoice,{...second,facturamaEnvironment:'SANDBOX'}]).reason,'NON_PRODUCTION_INVOICE','never redistribute a mixed production/sandbox payment');
  check(decide({referencia:bothReference,montoTotal:232,montoDisponibleSolicitudes:232},[invoice,{...second,facturaUuid:invoice.facturaUuid}]).reason,'DUPLICATE_INVOICE_IDENTITY','duplicate fiscal UUID');
  check(decide({},Array.from({length:101},(_,i)=>({...invoice,id:String(i)}))).reason,'CANDIDATE_LIMIT','bounded scan');
  const iqPago = {...payment, iqPaymentApplicationAutomationEligible:true, iqDepositId:'123456', iqPaymentApplicationStatus:'PAY0_APPLIED_PENDING_IQ_PLAN', iqPaymentApplicationExecutionStatus:'NOT_EXECUTED'};
  check(iq.isPaymentApplicationAutomationCandidate(iqPago,rootId),true,'IQ clean plan');
  for(const status of ['SUCCEEDED','IN_PROGRESS','FAILED_SAFE','UNKNOWN_REVIEW_REQUIRED','REJECTED_REVIEW_REQUIRED']) check(iq.isPaymentApplicationAutomationCandidate({...iqPago,iqPaymentApplicationExecutionStatus:status},rootId),false,`IQ ${status} cannot repeat`);
  check(iq.isPaymentApplicationAutomationCandidate({...iqPago,iqPaymentApplicationAutomationFailureCount:3,iqPaymentApplicationAutomationFailureSource:iq.paymentApplicationAutomationSource(iqPago)},rootId),false,'bounded failures');

  await db.doc(`users/${rootId}`).set({rootId,role:'superadmin',active:true,userNumber:1,name:'Prueba'});
  await db.doc(`clients/${rootId}`).set({rootId,active:true,createdBy:rootId,adminId:rootId,clientNumber:1});
  await db.doc(`companies/${rootId}`).set({rootId,active:true,companyNumber:1});
  const actor = {uid:rootId,rootId,role:'superadmin',adminId:rootId,displayName:'Prueba',username:'prueba'};
  async function fixture(suffix, p = {}, rows = [invoice], receipt = true) {
    const pagoId = `${rootId}-${suffix}`;
    const clienteId = pagoId;
    await db.doc(`clients/${clienteId}`).set({rootId,active:true,createdBy:rootId,adminId:rootId,clientNumber:2});
    const pago = {...payment,clienteId,...p};
    await db.doc(`pagos/${pagoId}`).set(pago);
    const invoices=[];
    for(const row of rows) { const item = {...row,clienteId,id:`${pagoId}-${row.id}`}; await db.doc(`solicitudes/${item.id}`).set(item); invoices.push(item); }
    if(receipt) await db.doc(`uploads/${pagoId}`).set({rootId,pagoId,entityId:pagoId,entityType:'pagos',documentType:'COMPROBANTE_PAGO',status:'READY',active:true,storagePath:`roots/${rootId}/receipt.pdf`});
    return {pagoId,pago,invoices};
  }
  const one = await fixture('one');
  const results = await Promise.all([automatic.applyAutomaticPayment(one.pagoId),automatic.applyAutomaticPayment(one.pagoId)]);
  check(results.every(result=>result.status==='APPLIED'),true,'concurrent retry succeeds idempotently');
  check((await db.collection('pagoAplicaciones').where('pagoId','==',one.pagoId).get()).size,1,'one financial application');
  check((await db.doc(`solicitudes/${one.invoices[0].id}`).get()).get('totalAbonado'),58,'partial invoice balance');
  const applied = await db.doc(`pagos/${one.pagoId}`).get();
  check(applied.get('status'),'APLICADO_TOTAL','payment consumed once');
  check(applied.get('automaticApplication.status'),'APPLIED','status committed atomically');
  check((await automatic.applyAutomaticPayment(one.pagoId)).status,'WAITING','terminal payment no-op');
  assert(applied.updateTime.isEqual((await db.doc(`pagos/${one.pagoId}`).get()).updateTime)); checks++;
  const both = await fixture('multi',{referencia:bothReference,montoTotal:232,montoDisponibleSolicitudes:232},[invoice,second]);
  check((await automatic.applyAutomaticPayment(both.pagoId)).status,'APPLIED','multi transaction');
  check((await db.collection('pagoAplicaciones').where('pagoId','==',both.pagoId).get()).size,2,'two exact applications');
  const sandbox = await fixture('sandbox-retained-uuid',{},[{...invoice,facturamaEnvironment:'SANDBOX',facturamaAutoDraftStatus:'SANDBOX_ISSUED',facturaMetadataSource:'FACTURAMA_XML'}]);
  check((await automatic.applyAutomaticPayment(sandbox.pagoId)).reason,'NON_PRODUCTION_INVOICE','sandbox source does not post real payment');
  check((await db.collection('pagoAplicaciones').where('pagoId','==',sandbox.pagoId).get()).size,0,'sandbox leaves no financial application');
  check((await db.doc(`pagos/${sandbox.pagoId}`).get()).get('montoDisponibleSolicitudes'),58,'sandbox leaves payment balance unchanged');
  const correctedRef=db.doc(`solicitudes/${sandbox.invoices[0].id}`), beforeCorrection=await correctedRef.get();
  await correctedRef.update({facturamaEnvironment:'PRODUCTION',facturamaAutoDraftStatus:'PRODUCTION_ISSUED'});
  await automatic.applyPaymentsAutomaticallyOnInvoice.run({time:new Date().toISOString(),params:{solicitudId:correctedRef.id},data:{before:beforeCorrection,after:await correctedRef.get()}});
  check((await db.collection('pagoAplicaciones').where('pagoId','==',sandbox.pagoId).get()).size,1,'production source correction with unchanged UUID resumes review once');
  const fiscalRace = await fixture('fiscal-source-race');
  const fiscalDecision = domain.decideAutomaticPayment(fiscalRace.pagoId,fiscalRace.pago,fiscalRace.invoices);
  await db.doc(`solicitudes/${fiscalRace.invoices[0].id}`).update({facturamaEnvironment:'SANDBOX',facturamaAutoDraftStatus:'SANDBOX_ISSUED'});
  await assert.rejects(service.applyPaymentApplicationBatchAtomic({actor,batch:fiscalDecision.batch,automaticSourceDigest:fiscalDecision.sourceDigest}),error=>error.code==='failed-precondition'); checks++;
  check((await db.collection('pagoAplicaciones').where('pagoId','==',fiscalRace.pagoId).get()).size,0,'source change before transaction cannot apply sandbox invoice');
  const review = await fixture('review',{referencia:'TRANSFERENCIA BANCO 99999'});
  check((await automatic.applyAutomaticPayment(review.pagoId)).status,'REQUIRES_REVIEW','unmatched remains review');
  const reviewSnap = await db.doc(`pagos/${review.pagoId}`).get();
  await automatic.applyAutomaticPayment(review.pagoId);
  assert(reviewSnap.updateTime.isEqual((await db.doc(`pagos/${review.pagoId}`).get()).updateTime)); checks++;
  const missing = await fixture('missing-receipt',{},[invoice],false);
  check((await automatic.applyAutomaticPayment(missing.pagoId)).reason,'RECEIPT_NOT_READY','creation cannot precede receipt');
  const stale = await fixture('race');
  const decision = domain.decideAutomaticPayment(stale.pagoId,stale.pago,stale.invoices);
  await db.doc(`pagos/${stale.pagoId}`).update({referencia:'CAMBIO'});
  await assert.rejects(service.applyPaymentApplicationBatchAtomic({actor,batch:decision.batch,automaticSourceDigest:decision.sourceDigest}), error=>error.code==='failed-precondition'); checks++;
  check((await db.collection('pagoAplicaciones').where('pagoId','==',stale.pagoId).get()).size,0,'stale source creates nothing');
  const disabled = await fixture('inactive');
  await db.doc(`users/${rootId}`).update({active:false});
  check((await automatic.applyAutomaticPayment(disabled.pagoId)).status,'REQUIRES_REVIEW','revoked actor stopped');
  check((await db.collection('pagoAplicaciones').where('pagoId','==',disabled.pagoId).get()).size,0,'revocation no balance mutation');
  await db.doc(`users/${rootId}`).update({active:true});
  await db.doc(`pagos/${rootId}-iq`).set(iqPago);
  check((await iq.continuePaymentApplicationImmediately(`${rootId}-iq`)).action,'PAUSED','missing IQ configuration no dispatch');
  await db.doc(`iqIntegrationConfigs/${rootId}`).set({enabled:false,automation:{aplicacionPagos:true}});
  check((await iq.continuePaymentApplicationImmediately(`${rootId}-iq`)).action,'PAUSED','IQ master gate');
  check((await db.collection('paymentComplementJobs').get()).size,0,'REP never invoked by local application');
  console.log(JSON.stringify({ok:true,checks,concurrency:'PASS',financialTransaction:'PASS',scope:'PASS',ambiguousCases:'REVIEW',externalActions:0}));
})().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
