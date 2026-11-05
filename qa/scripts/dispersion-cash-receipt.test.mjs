// Contract test for the cash-dispersion receipt domain.
// Run after `npm run build` in functions/: node qa/scripts/dispersion-cash-receipt.test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const domain = require(path.resolve(here, "../../functions/lib/modules/dispersionCashReceipt/domain.js"));
const documents = require(path.resolve(here, "../../functions/lib/modules/dispersionDocuments/domain.js"));

let checks = 0;
const check = (fn) => { fn(); checks += 1; };

// Cash detection reads any of the fields PAY0 has used for the type.
check(() => assert.equal(domain.isCashDispersion({ operationTypeKey: "EFECTIVO" }), true));
check(() => assert.equal(domain.isCashDispersion({ methodTipo: "efectivo" }), true));
check(() => assert.equal(domain.isCashDispersion({ destinationKind: "EFECTIVO", methodTipo: "DEBITO" }), true));
check(() => assert.equal(domain.isCashDispersion({ operationTypeKey: "TRANSFERENCIA", destinationKind: "CLABE" }), false));
check(() => assert.equal(domain.isCashDispersion({}), false));

// Creation stamp: only cash gets a receipt status.
check(() => assert.equal(domain.initialCashReceiptStatus("EFECTIVO"), "PENDIENTE_FIRMA"));
check(() => assert.equal(domain.initialCashReceiptStatus("TDC"), null));

// Derived status: legacy cash rows without the field are pending; FIRMADA wins.
check(() => assert.equal(domain.cashReceiptStatusOf({ operationTypeKey: "EFECTIVO" }), "PENDIENTE_FIRMA"));
check(() => assert.equal(domain.cashReceiptStatusOf({ operationTypeKey: "EFECTIVO", cashReceiptStatus: "FIRMADA" }), "FIRMADA"));
check(() => assert.equal(domain.cashReceiptStatusOf({ operationTypeKey: "EFECTIVO", cashReceipt: { status: "firmada" } }), "FIRMADA"));
check(() => assert.equal(domain.cashReceiptStatusOf({ operationTypeKey: "TRANSFERENCIA", cashReceiptStatus: "FIRMADA" }), null));

// Completion gate: cash is finished only when signed; terminal rows never are.
check(() => assert.equal(domain.isDispersionDeliveryComplete({ operationTypeKey: "TRANSFERENCIA", status: "REGISTRADA" }), true));
check(() => assert.equal(domain.isDispersionDeliveryComplete({ operationTypeKey: "EFECTIVO", status: "REGISTRADA" }), false));
check(() => assert.equal(domain.isDispersionDeliveryComplete({ operationTypeKey: "EFECTIVO", status: "REGISTRADA", cashReceiptStatus: "FIRMADA" }), true));
check(() => assert.equal(domain.isDispersionDeliveryComplete({ operationTypeKey: "EFECTIVO", status: "CANCELADA", cashReceiptStatus: "FIRMADA" }), false));
check(() => assert.equal(domain.isDispersionDeliveryComplete({ operationTypeKey: "TRANSFERENCIA", status: "DEVUELTA" }), false));

// Receiver match: the beneficiary is the expected receiver; a different person is flagged, not rejected.
check(() => assert.equal(domain.receiverNamesMatch("Leonel Cortez", "LEONEL CORTEZ"), true));
check(() => assert.equal(domain.receiverNamesMatch("Leonel Cortez Pérez", "leonel cortez"), true));
check(() => assert.equal(domain.receiverNamesMatch("Leonel Cortez", "Leonel Cortéz"), true));
check(() => assert.equal(domain.receiverNamesMatch("Leonel Cortez", "Maria Lopez"), false));
check(() => assert.equal(domain.receiverNamesMatch("Leonel Cortez", "Leonel Garcia"), false));
check(() => assert.equal(domain.receiverNamesMatch("", "Leonel Cortez"), false));
check(() => assert.equal(domain.expectedReceiverName({ beneficiaryNombre: "  Leonel   Cortez " }), "Leonel Cortez"));

// Acceptance text carries the immutable amount.
check(() => assert.equal(
  domain.cashReceiptAcceptanceText({ amount: 15000, currency: "mxn", folio: "D1C45U1" }),
  "Recibi la cantidad de $15,000.00 MXN en efectivo correspondiente a la dispersion D1C45U1, completa y a mi entera satisfaccion.",
));
check(() => assert.equal(domain.cashReceiptAcceptanceText({ amount: "12.5" }), "Recibi la cantidad de $12.50 MXN en efectivo, completa y a mi entera satisfaccion."));

// Signer name validation.
check(() => assert.equal(domain.validateSignerName("  Ana   Ruiz "), "Ana Ruiz"));
check(() => assert.throws(() => domain.validateSignerName("A"), /SIGNER_NAME_REQUIRED/));
check(() => assert.throws(() => domain.validateSignerName("12345"), /SIGNER_NAME_INVALID/));

// Document type registry: the signature is a recognised, server-only dispersion document.
check(() => assert.equal(documents.normalizeDispersionDocumentType("FIRMA_RECEPCION_EFECTIVO"), "FIRMA_RECEPCION_EFECTIVO"));
check(() => assert.equal(documents.normalizeDispersionDocumentType("algo"), "COMPROBANTE_DISPERSION"));
check(() => assert.equal(documents.isServerOnlyDispersionDocumentType("FIRMA_RECEPCION_EFECTIVO"), true));
check(() => assert.equal(documents.isServerOnlyDispersionDocumentType("COMPROBANTE_DISPERSION"), false));
check(() => assert.equal(documents.getDispersionDocumentTypeLabel("FIRMA_RECEPCION_EFECTIVO"), "Firma de recepcion de efectivo"));
check(() => assert.equal(domain.CASH_RECEIPT_DOCUMENT_TYPE, "FIRMA_RECEPCION_EFECTIVO"));

console.log(JSON.stringify({ ok: true, checks }));
