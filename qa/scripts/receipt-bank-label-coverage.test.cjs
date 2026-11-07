const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseReceiptText } = require('../../functions/lib/modules/pagos/receiptPdfCallables.js');

// Text layout of real receipts; the status of a transfer is never a reason to refuse registering it.
const samples = {
  banregio: {
    text: `Tipo de Transferencia Mismo día hábil (SPEI)
Cuenta Origen HB MULTISERVICIOS PLAYA DEL CARMEN S.A. DE C.V. - *0012
Cuenta Destino REFACCIONARIA ELITE, S.A DE C.V - 659455000000000132
Cantidad a Transferir $5,319.15
Concepto de pago Transferencia de HB MULTISERVICIOS PLAYA
RFC
Número de referencia 933661
REL221012741
Fecha solicita 6 noviembre 2026 - 10:21 a. m.
Banco ASP INTEGRA OPC
Tu clave de rastreo
Fecha de operación SPEI 6 noviembre 2026`,
    expect: { senderName: 'HB MULTISERVICIOS PLAYA DEL CARMEN S.A. DE C.V.', beneficiaryName: 'REFACCIONARIA ELITE, S.A DE C.V', amount: 5319.15, date: '2026-11-06', reference: '933661', destinationAccount: '659455000000000132', currency: 'MXN', paymentForm: '03' },
  },
  santanderEnviada: {
    text: `Comprobante de Operación
Tipo de
Operación: TRANSFERENCIA INTERBANCARIA
Referencia: 9920261030211656641830
Estado: ENVIADA
Divisa: MXN
Cuenta Cargo: 65510401289 - KANOVAS MKT SA DE CV
Cuenta Abono: 147180000000995862 - BIERZO PUBLICIDAD PAYO
Importe: $ 15,000.00 MXN
Concepto: Servicio campana digital octubre
Fecha
aplicación: 30/10/2026
RFC
Beneficiario:
Este no es un comprobante de pago ya que no se ha confirmado la operación`,
    expect: { senderName: 'KANOVAS MKT SA DE CV', beneficiaryName: 'BIERZO PUBLICIDAD PAYO', amount: 15000, date: '2026-10-30', dateVerified: true, reference: '9920261030211656641830', destinationAccount: '147180000000995862', account: '65510401289', paymentForm: '03' },
  },
  pcDirecto: {
    text: `Operación: Transferencia a Otros Bancos Nacionales - SPEI
Fecha de Operación: 21/Oct./2026
Hora de Operación: 09:00:25 horas
Nombre del Ordenante: PC DIRECTO SA DE CV
RFC o CURP del Ordenante: PDI071206LC7
CLABE, Plastico o Celular: Setubal ASP - 659455001000001266
Nombre del Beneficiario: Sistemas Setubal
RFC del Beneficiario: No capturado
Banco Destino: ASP INTEGRA OPC
Importe: $44,776.00 MXN
Número de Referencia: 13407
Concepto de Pago: 13407
Fecha de Aplicación: 21/Oct./2026
Clave de Rastreo: 7875APR1202610215916297304`,
    expect: { senderName: 'PC DIRECTO SA DE CV', payerRfc: 'PDI071206LC7', beneficiaryName: 'Sistemas Setubal', destinationAccount: '659455001000001266', amount: 44776, date: '2026-10-21', reference: '7875APR1202610215916297304' },
  },
  wrappedNameAndMn: {
    text: `Confirmación de Transacción
Operación: Transferencia SPEI
Fecha Operación: 29-Oct-2026
Hora Operación: 15:20:02 horas
Cuenta Origen: 309337580201
Ordenante: OIL SPILL CONTROL
SOLUTIONS SA DE CV
Cuenta Destino: 659455020000000002
Banco Destino: ASP INTEGRA OPC
Beneficiario: Renofec SA de CV
Importe: $45,800.00 MN
Concepto de Pago: Pago
Referencia: 2571984`,
    expect: { senderName: 'OIL SPILL CONTROL SOLUTIONS SA DE CV', beneficiaryName: 'Renofec SA de CV', amount: 45800, date: '2026-10-29', reference: '2571984', destinationAccount: '659455020000000002' },
  },
};

for (const [name, { text, expect }] of Object.entries(samples)) {
  test(`${name}: every field needed to register the pago is read`, () => {
    const parsed = parseReceiptText(text);
    for (const [key, value] of Object.entries(expect)) assert.equal(parsed[key], value, key);
  });
}

test('masked source accounts are kept, a name with a masked tail is not an account', () => {
  const base = ['Importe: $100.00', 'Fecha de Operación: 21/Oct./2026', 'Referencia: 123456', 'SPEI', ''].join(String.fromCharCode(10));
  for (const mask of ['XXXXXX1234', '******1234']) assert.equal(parseReceiptText(`${base}Cuenta origen: ${mask}`).account, mask);
  assert.equal(parseReceiptText(`${base}Cuenta Origen ACME SA DE CV - *0012`).account, '');
});
