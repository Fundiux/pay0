const assert = require("node:assert/strict");
const { iqCancellationReceiptAction } = require("../../functions/lib/modules/iq/cancellationReceiptDomain.js");
const { fetchIqCancellationReceipt } = require("../../functions/lib/modules/iq/cancellationReceiptHttp.js");
const { iqCancellationReconcileAction } = require("../../functions/lib/modules/iq/cancellationReconcileDomain.js");
const { facturamaCancellationBlock } = require("../../functions/lib/modules/facturama/cancellationGuard.js");

const origin = "https://iq.example.com";
const base = { rootId: "root", iqFolio: "123" };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const run = (fetcher, iqFolio = "123") => fetchIqCancellationReceipt({ apiOrigin: origin, accessToken: "token", iqFolio, fetcher });

(async () => {
  assert.equal(iqCancellationReceiptAction(base), "NOT_APPLICABLE", "sin factura no hay acuse");
  assert.equal(iqCancellationReceiptAction({ ...base, iqInvoiceUuid: "UUID" }), "LOOKUP");
  assert.equal(iqCancellationReceiptAction({ ...base, iqInvoiceImportStatus: "IMPORTED" }), "LOOKUP");
  assert.equal(iqCancellationReceiptAction({ ...base, iqInvoiceUuid: "UUID", iqCancellationReceiptStatus: "READY" }), "SKIP");
  assert.equal(iqCancellationReceiptAction({ ...base, iqInvoiceUuid: "UUID", facturamaInvoiceId: "F1" }), "SKIP", "Facturama tiene su propio acuse");
  assert.equal(iqCancellationReceiptAction({ ...base, iqCancellationReceiptStatus: "NOT_APPLICABLE", iqInvoiceUuid: "UUID" }), "LOOKUP", "factura importada despues de cancelar");

  const missing = await run(async () => json(400, { errors: ["Cancellation voucher La solicitud no tiene comprobante de cancelación"] }));
  assert.equal(missing.status, "NOT_AVAILABLE");
  await assert.rejects(run(async () => json(400, { errors: ["Otro error"] })), /IQ_ACUSE_LOOKUP_HTTP_400/);
  await assert.rejects(run(async () => json(200, { url: "https://evil.example.net/a.pdf" })), /IQ_RECEIPT_HOST_UNVERIFIED/);
  await assert.rejects(run(async () => json(200, {}), "1/../2"), /IQ_ACUSE_FOLIO_INVALID/);

  const methods = [];
  const found = await run(async (url, init) => {
    methods.push(init.method);
    if (url.pathname === "/invoices/cancellation/123") return json(200, { url: `${origin}/files/acuse` });
    return new Response(Buffer.from("%PDF-1.7 acuse"), { status: 200 });
  });
  assert.equal(found.status, "AVAILABLE");
  assert.equal(found.extension, "pdf");
  assert.deepEqual(methods, ["GET", "GET"], "nunca usa PATCH sobre la ruta que cancela");

  const auth = [];
  const redirected = await run(async (url, init) => {
    auth.push([url.hostname, !!init.headers.Authorization]);
    if (url.pathname === "/invoices/cancellation/123") return json(200, { url: `${origin}/rails/blob` });
    if (url.pathname === "/rails/blob") return new Response(null, { status: 302, headers: { location: "https://iq3-production.s3.us-east-2.amazonaws.com/acuse?sig=1" } });
    return new Response(Buffer.from("%PDF-1.7 acuse"), { status: 200 });
  });
  assert.equal(redirected.extension, "pdf", "IQ entrega el acuse por redirect a S3");
  assert.deepEqual(auth.at(-1), ["iq3-production.s3.us-east-2.amazonaws.com", false], "el token de IQ no viaja a S3");

  const xml = await run(async url => url.pathname.startsWith("/invoices") ? json(200, { url: `${origin}/f` }) : new Response('<?xml version="1.0"?><Acuse/>', { status: 200 }));
  assert.equal(xml.extension, "xml");
  const now = 10 * 3600000;
  const action = (cancellationStatus, operationStatus, requestedAtMs = 0) => iqCancellationReconcileAction({ cancellationStatus, operationStatus, requestedAtMs, now });
  assert.equal(action("REQUESTED", "Cancelada"), "CONFIRM");
  assert.equal(action("REQUESTED", "Pendiente Cancelación"), "KEEP");
  assert.equal(action("REQUESTED", "Pendiente de cancelación"), "KEEP");
  assert.equal(action("OUTCOME_UNKNOWN", "Pendiente Cancelacion"), "PROMOTE", "el intento incierto sí llegó a IQ");
  assert.equal(action("REQUESTED", "En Operacion"), "REJECT");
  assert.equal(action("REQUESTED", "En Operacion", now - 60000), "KEEP", "recién solicitada no se da por rechazada");
  assert.equal(action("OUTCOME_UNKNOWN", "En Operacion"), "NOT_APPLIED");
  assert.equal(action("REQUESTED", ""), "KEEP", "sin dato de IQ no se decide nada");

  const block = (solicitud, invoice, motive, appliedPayments = 0) => facturamaCancellationBlock({ solicitud, invoice, motive, appliedPayments, now });
  assert.match(block({ totalAbonado: 10 }, {}, "02"), /abonos/, "con abonos no se cancela sin sustitución");
  assert.match(block({}, {}, "03", 1), /abonos/, "una aplicación cuenta aunque totalAbonado no esté al día");
  assert.equal(block({ totalAbonado: 10 }, {}, "01"), null);
  assert.match(block({ status: "CANCELADA" }, {}, "02"), /ya está cancelada/);
  assert.match(block({}, { cancellationStatus: "CANCELED" }, "02"), /ya está cancelada/);
  const requestedAt = { toMillis: () => now - 3600000 };
  assert.match(block({}, { cancellationStatus: "REQUESTING", cancellationRequestedAt: requestedAt }, "02"), /en curso/, "doble clic no llega dos veces");
  assert.equal(block({}, { cancellationStatus: "REQUEST_FAILED", cancellationRequestedAt: requestedAt }, "02"), null, "un rechazo se puede reintentar");

  console.log("PASS cancelaciones: reglas de abonos, reclamo único y conciliación de estados IQ.");
  console.log("PASS acuse IQ: solo con factura, solo GET, hosts verificados y PDF o XML identificados.");
})().catch(error => { console.error(error); process.exit(1); });
