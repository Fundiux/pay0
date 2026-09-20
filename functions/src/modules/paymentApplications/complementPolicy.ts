import { createHash } from "crypto";
import { XMLValidator } from "fast-xml-parser";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const text = (value: unknown) => String(value ?? "").trim();
export const cents = (value: unknown) => Math.round(Number(value) * 100);
export const millis = (value: any): number => value?.toMillis?.() || (typeof value === "string" ? Date.parse(value) : 0);
export const dayMexico = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
// createPago stores the YYYY-MM-DD date input as new Date(input), i.e. midnight
// UTC. That representation is a civil date, not an 18:00 Mexico payment.
export function paymentDate(value: any): string {
  const date = new Date(millis(value));
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0
    ? date.toISOString().slice(0, 10) : dayMexico(date);
}
export function paymentDateTime(pago: any): string {
  const date = paymentDate(pago?.fechaPago);
  const time = text(pago?.paymentTime || "12:00:00");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) throw Error("REP_PAYMENT_DATE_REQUIRED");
  return `${date}T${time}`;
}
export function overdue(requestedAt: any, now: Date): boolean {
  const start = millis(requestedAt);
  return start > 0 && Date.parse(dayMexico(now)) - Date.parse(dayMexico(new Date(start))) >= 7 * 86400000;
}
export function assertSource(rootId: string, app: any, solicitud: any, pago: any) {
  if (!rootId || [app, solicitud, pago].some(row => !row || row.rootId !== rootId)) throw Error("REP_SCOPE_INVALID");
  if (app.status !== "APLICADA" || app.invoiceType !== "PPD" || solicitud.tipoFactura !== "PPD") throw Error("REP_NOT_APPLICABLE");
  if ([solicitud, pago].some(row => row.isDeleted === true || ["CANCELADA", "CANCELADO", "RECHAZADO", "RECHAZADA", "EN_SUSTITUCION"].includes(row.status))) throw Error("REP_SOURCE_CANCELLED");
  if (!solicitud.companyId || solicitud.companyId !== pago.companyId || !solicitud.clienteId || solicitud.clienteId !== pago.clienteId) throw Error("REP_PARTIES_MISMATCH");
  const paid = cents(app.montoAplicado), before = cents(app.saldoAnterior), after = cents(app.saldoInsoluto);
  if (![paid, before, after].every(Number.isSafeInteger) || paid <= 0 || after < 0 || before - paid !== after || !Number.isInteger(app.numeroParcialidad) || app.numeroParcialidad < 1) throw Error("REP_BALANCES_INVALID");
}

// Only the documented business response means "not available". Other 400s,
// authentication failures and HTML errors must not silently become pending.
export function iqAvailability(status: number, body: any): "PENDING" | "AVAILABLE" {
  if (status === 400 && Array.isArray(body?.errors) && body.errors.length === 1 && body.errors[0] === "El depósito no tiene ningún REP adjunto") return "PENDING";
  if (status === 200 && typeof body?.url === "string" && body.url.startsWith("https://")) return "AVAILABLE";
  throw Error(`IQ_REP_HTTP_${status}`);
}

export function xmlAttribute(tag: string | undefined, key: string): string {
  const match = new RegExp(`\\s${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag || "");
  return (match?.[1] || match?.[2] || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
export const xmlTags = (xml: string, name: string) => xml.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>`, "g")) || [];
export function assertXml(xml: string) {
  if (Buffer.byteLength(xml) > 2_000_000 || /<!DOCTYPE|<!ENTITY|<!--|<!\[CDATA\[/i.test(xml) || XMLValidator.validate(xml) !== true || xmlTags(xml, "Comprobante").length !== 1) throw Error("REP_XML_INVALID");
}

// Original stamped XML is authoritative. Do not infer taxes from OC totals.
// This first adapter deliberately blocks foreign currency and mixed/retained
// taxes instead of inventing fiscal amounts.
export function buildFacturamaRep(xml: string, app: any, pago: any, expectedUuid: string, folio: string) {
  assertXml(xml);
  const top = xmlTags(xml, "Comprobante")[0], issuer = xmlTags(xml, "Emisor")[0] || "", receiver = xmlTags(xml, "Receptor")[0] || "";
  const stamp = xmlTags(xml, "TimbreFiscalDigital")[0] || "";
  if (xmlAttribute(top, "TipoDeComprobante") !== "I" || xmlAttribute(top, "MetodoPago") !== "PPD" || xmlAttribute(stamp, "UUID").toUpperCase() !== expectedUuid.toUpperCase()) throw Error("REP_ORIGINAL_CFDI_MISMATCH");
  if (xmlAttribute(top, "Moneda") !== "MXN" || text(pago.moneda).toUpperCase() !== "MXN") throw Error("REP_CURRENCY_REQUIRES_REVIEW");
  const form = text(pago.paymentForm || pago.formaPagoSat);
  if (!/^(01|02|03|04|05|06|08|12|13|14|15|17|23|24|25|26|27|28|29|30|31)$/.test(form)) throw Error("REP_PAYMENT_FORM_REQUIRED");
  const date = millis(pago.fechaPago);
  if (!(date > 0) || date > Date.now()) throw Error("REP_PAYMENT_DATE_REQUIRED");
  if (form !== "03") throw Error("REP_PAYMENT_FORM_REQUIRES_REVIEW");
  const signals = pago.receiptLearningSignals || {};
  const normalizedRfc = (value: unknown) => text(value).toUpperCase().replace(/[^A-ZÑ&0-9]/g, "");
  const invoiceIssuerRfc = normalizedRfc(xmlAttribute(issuer, "Rfc"));
  const invoiceReceiverRfc = normalizedRfc(xmlAttribute(receiver, "Rfc"));
  const payerRfc = normalizedRfc(signals.detectedPayerRfc || signals.clientRfcSnapshot);
  const beneficiaryRfc = normalizedRfc(signals.detectedBeneficiaryRfc || signals.companyRfcSnapshot);
  if (!payerRfc || payerRfc !== invoiceReceiverRfc || !beneficiaryRfc || beneficiaryRfc !== invoiceIssuerRfc) throw Error("REP_PAYMENT_RFC_MISMATCH");
  const concepts = xmlTags(xml, "Concepto"), objects = [...new Set(concepts.map(tag => xmlAttribute(tag, "ObjetoImp")))];
  if (!concepts.length || objects.length !== 1 || !["01", "02"].includes(objects[0]) || xmlTags(xml, "Retencion").length || Number(xmlAttribute(top, "Descuento") || 0) !== 0) throw Error("REP_TAXES_REQUIRE_REVIEW");
  const paid = cents(app.montoAplicado), total = cents(xmlAttribute(top, "Total"));
  if (!(total > 0) || total !== cents(app.montoTotal) || cents(app.saldoAnterior) > total) throw Error("REP_ORIGINAL_TOTAL_MISMATCH");
  const related: any = { Uuid: expectedUuid, Currency: "MXN", PaymentMethod: "PPD", PartialityNumber: app.numeroParcialidad,
    PreviousBalanceAmount: cents(app.saldoAnterior) / 100, AmountPaid: paid / 100, ImpSaldoInsoluto: cents(app.saldoInsoluto) / 100, TaxObject: objects[0] };
  if (objects[0] === "02") {
    const taxes = xmlTags(xml, "Traslado");
    if (!taxes.length || taxes.some(tag => xmlAttribute(tag, "Impuesto") !== "002" || xmlAttribute(tag, "TipoFactor") !== "Tasa" || Number(xmlAttribute(tag, "TasaOCuota")) !== 0.16)) throw Error("REP_TAXES_REQUIRE_REVIEW");
    // Allocate cumulative tax rounded to cents; final installment consumes the
    // remainder, so splitting a payment cannot duplicate pennies.
    const base = cents(xmlAttribute(top, "SubTotal")), tax = total - base;
    if (base + Math.round(base * 0.16) !== total) throw Error("REP_TAXES_REQUIRE_REVIEW");
    const paidBefore = total - cents(app.saldoAnterior), paidAfter = paidBefore + paid;
    const allocatedTax = Math.round(tax * paidAfter / total) - Math.round(tax * paidBefore / total);
    related.Taxes = [{ Name: "IVA", Rate: 0.16, Base: (paid - allocatedTax) / 100, Total: allocatedTax / 100, IsRetention: false }];
  }
  const payment: any = { Date: paymentDateTime(pago), PaymentForm: form, Currency: "MXN", Amount: paid / 100, RelatedDocuments: [related] };
  const payerAccount = text(signals.detectedSourceAccount).replace(/\s/g, "");
  const beneficiaryAccount = text(signals.detectedDestinationAccount || signals.operatorSelectedAccount).replace(/\s/g, "");
  const operationNumber = text(pago.referencia).slice(0, 100);
  if (payerAccount) payment.PayerAccount = payerAccount;
  if (beneficiaryAccount) payment.BeneficiaryAccount = beneficiaryAccount;
  if (operationNumber) payment.OperationNumber = operationNumber;
  const payload: any = { CfdiType: "P", NameId: 14, Folio: folio, ExpeditionPlace: xmlAttribute(top, "LugarExpedicion"),
    Issuer: { Rfc: xmlAttribute(issuer, "Rfc"), Name: xmlAttribute(issuer, "Nombre"), FiscalRegime: xmlAttribute(issuer, "RegimenFiscal") },
    Receiver: { Rfc: xmlAttribute(receiver, "Rfc"), Name: xmlAttribute(receiver, "Nombre"), FiscalRegime: xmlAttribute(receiver, "RegimenFiscalReceptor"), TaxZipCode: xmlAttribute(receiver, "DomicilioFiscalReceptor"), CfdiUse: "CP01" },
    Complemento: { Payments: [payment] } };
  const bankName = text(signals.detectedBankName).slice(0, 50);
  if (bankName) payload.PaymentBankName = bankName;
  if (Object.values(payload.Issuer).some(v => !v) || Object.values(payload.Receiver).some(v => !v) || !/^\d{5}$/.test(payload.ExpeditionPlace)) throw Error("REP_FISCAL_DATA_REQUIRED");
  return payload;
}
