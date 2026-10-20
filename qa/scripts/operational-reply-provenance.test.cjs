const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = path.resolve(__dirname, '../..', process.env.PAY0_OPERATIONAL_LIB || 'functions/lib');
const { formatLatestSolicitud, formatSolicitudDetails, formatPaymentClients, formatRecordedAmount, receiptReadingLocationReply } = require(path.join(base, 'modules/agent007/hugoCore/interactionSemantics'));
test('recorded amounts preserve zero and reject absent or invalid amounts', () => {
  assert.match(formatRecordedAmount(0,'MXN'),/0\.00/);
  for(const value of [null,undefined,'',' ',true,{},Infinity]) assert.equal(formatRecordedAmount(value,'MXN'),'no registrado');
});
test('latest solicitud states canonical client, method and amount together', () => {
  const text = formatLatestSolicitud({item:{cliente:'Cliente Alfa',metodoPago:'PPD',monto:1234.5,moneda:'MXN',folio:'SABC123'}});
  for (const token of ['Cliente Alfa','PPD','1,234.50','SABC123']) assert.ok(text.includes(token));
  assert.match(text,/solicitud más reciente/);
});
test('missing client is not the absence of solicitudes; missing amounts never become zero', () => {
  const text = formatSolicitudDetails({folio:'SABC123',monto:null,metodoPago:'CONCILIADO'});
  assert.match(text,/nombre de cliente no disponible/);
  assert.match(text,/no registrado como PPD\/PUE/);
  assert.match(text,/Monto: no registrado/);
  assert.doesNotMatch(text,/\$0|No hay solicitudes/);
});
test('payment clients are never replaced by banks, payers or OCR names', () => {
  const text = formatPaymentClients([{cliente:'Cliente Alfa',pagador:'Banco Sintético',remitenteDetectado:'Otro Banco'},{pagador:'Banco Dos'}]);
  assert.match(text,/Cliente Alfa/);assert.match(text,/sin nombre de cliente verificado/);
  assert.doesNotMatch(text,/Banco Sintético|Otro Banco|Banco Dos/);
  assert.match(formatPaymentClients([{pagador:'Banco Sintético'}]),/No tengo un nombre de cliente verificado/);
});
test('receipt discovery points to the actual review surface without interpreting a document', () => {
  for (const message of ['puedes leer un comprobante de pago y donde?','¿Dónde puedo subir un comprobante?','cómo analizar un recibo']) {
    const reply = receiptReadingLocationReply(message);
    assert.match(reply,/\/hugo/);assert.match(reply,/Revisar un comprobante con María/);assert.match(reply,/no registra un pago/);
  }
  for(const message of ['último cliente en hacer una solicitud','último pago registrado','el comprobante tiene un monto incorrecto']) assert.equal(receiptReadingLocationReply(message),null);
});
