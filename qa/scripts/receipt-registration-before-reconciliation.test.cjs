const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {createEvaluationReader}=require('./remediation-ocr-quota.test.cjs');
const reader=createEvaluationReader();
function load(file,deps={}){const exports={};const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',source)(exports,name=>{assert(Object.hasOwn(deps,name),'UNEXPECTED_DEPENDENCY');return deps[name];});return exports;}
const domain=load('functions/src/modules/pagos/receiptIdentificationDomain.ts');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const unexpected=()=>{throw Error('UNEXPECTED_IDENTIFICATION_SIDE_EFFECT');};
const identification=load('functions/src/modules/pagos/receiptIdentification.ts',{'node:crypto':require('node:crypto'),'firebase-admin/firestore':{FieldValue:{serverTimestamp:()=> 'SYNTHETIC_TIME'}},'firebase-functions/v2/https':{HttpsError},'../clientDelegations/access':{requireClientOperationalAccess:unexpected},'./receiptLearning':{getReceiptActorCorrectionState:unexpected},'./receiptIdentificationDomain':domain});
const body=amount=>['Transferencia SPEI MXN','Ordenante: Cliente Demo','Beneficiario: Empresa Demo',amount,'Fecha de operación: 2026-10-16','Referencia: DEMO1234','Estado: Pendiente'].join('\n');

for (const label of ['Saldo total', 'Comisión total']) test(label+' cannot match the generic total amount label', () => {
  const receipt=reader.parse(body(`${label}: $9999.00`));
  assert.equal(receipt.amount,0);
  assert(domain.receiptRegistrationReasons(receipt,'OP_DEMO').includes('INVALID_AMOUNT'));
});
test('valid unique amount and unconfirmed execution can be registered without falsifying either flag',()=>{
  const receipt=reader.parse(body('$100.00 MXN')),before=structuredClone(receipt);
  assert.equal(receipt.amount,100);assert.equal(receipt.amountVerified,false);assert.equal(receipt.executionConfirmed,false);
  assert.equal(receipt.warnings.some(value=>/Importe sin etiqueta inequívoca|Ejecución de la transferencia sin confirmar/.test(value)),false);
  assert.deepEqual(domain.receiptRegistrationReasons(receipt,'OP_DEMO'),[]);assert.deepEqual(receipt,before);
  const semantic=reader.semantic(body('$100.00 MXN'),receipt);
  assert.equal(semantic.reviewRequired,false);assert.equal(semantic.fields.transferAmount.confidence,'LOW');assert.equal(semantic.fields.transferAmount.decision,'REVIEW');assert.equal(semantic.fields.executionStatus.value,'UNCONFIRMED');
  assert.equal(semantic.fields.executionStatus.decision,'REVIEW');
});
for(const [name,amount] of [['balance-only','Saldo disponible: $9999.00'],['commission-only','Comisión bancaria: $16.00'],['split balance-only','Saldo disponible\n$9999.00'],['split commission-only','Comisión bancaria\n$16.00'],['explicit contradiction','Monto: $100.00\nMonto transferido: $200.00'],['malformed explicit amount','Monto: $1,00.50']])test(name+' never supplies a valid transfer amount',()=>{
  const receipt=reader.parse(body(amount));assert.equal(receipt.amount,0);assert.equal(receipt.amountVerified,false);assert(domain.receiptRegistrationReasons(receipt,'OP_DEMO').includes('INVALID_AMOUNT'));
});
test('transfer amount stays distinct from balance, commission and tax',()=>{
  const text=body('Monto transferido: $100.00\nSaldo disponible: $9999.00\nComisión bancaria: $16.00\nIVA: $2.56'),receipt=reader.parse(text),semantic=reader.semantic(text,receipt);
  assert.equal(receipt.amount,100);assert.equal(semantic.fields.accountBalance.value,9999);assert.equal(semantic.fields.bankCommission.value,16);assert.equal(receipt.executionConfirmed,false);assert.deepEqual(domain.receiptRegistrationReasons(receipt,'OP_DEMO'),[]);
});
test('invalid amount and remaining registration requirements are still enforced',()=>{
  const receipt=reader.parse(body('Monto: $100.00'));
  for(const amount of [0,-1,NaN,Infinity,undefined,null])assert(domain.receiptRegistrationReasons({...receipt,amount},'OP_DEMO').includes('INVALID_AMOUNT'));
  for(const [patch,reason] of [[{dateVerified:false},'DATE_REQUIRES_REVIEW'],[{date:'2026-02-31'},'MISSING_DATE'],[{currency:'USD'},'UNSUPPORTED_CURRENCY'],[{reference:''},'MISSING_REFERENCE'],[{paymentForm:'01'},'PAYMENT_FORM_REQUIRES_REVIEW'],[{identityConflict:true},'CONFLICTING_RFC']])assert(domain.receiptRegistrationReasons({...receipt,...patch},'OP_DEMO').includes(reason));
  assert(domain.receiptRegistrationReasons(receipt,'').includes('MISSING_OPERATION_TYPE'));
});
test('ownership, duplicate and amount-tamper guards remain active without advisory flags',()=>{
  const actor={uid:'actor-demo',rootId:'root-demo'},payload={montoTotal:100,referencia:'DEMO1234'},stored={...actor,actorUid:actor.uid,status:'READY',createPayload:payload};
  const snap=row=>({exists:true,get:key=>row[key]});
  assert.doesNotThrow(()=>identification.assertReceiptCreation(snap(stored),actor,payload));
  for(const changed of [{...actor,rootId:'other-root'},{...actor,uid:'other-actor'}])assert.throws(()=>identification.assertReceiptCreation(snap(stored),changed,payload),error=>error.code==='permission-denied');
  assert.throws(()=>identification.assertReceiptCreation(snap({...stored,status:'REGISTERED'}),actor,payload),error=>error.code==='already-exists');
  assert.throws(()=>identification.assertReceiptCreation(snap(stored),actor,{...payload,montoTotal:101}),error=>error.code==='failed-precondition');
});
test('receipt registration acknowledgment never asserts bank reconciliation or execution',()=>{
  const patch=identification.receiptRegisteredPatch('synthetic-payment');
  assert.equal(patch.status,'REGISTERED');assert.equal(patch.stage,'REGISTERED_AWAITING_RECEIPT');
  for(const key of ['conciliado','executionConfirmed','amountVerified','balance','saldo'])assert.equal(Object.hasOwn(patch,key),false);
});
