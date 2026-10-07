import QRCode from "qrcode";
import { existsSync } from "fs";
import { loadCanonicalBundle } from "./canonicalBundle";

function text(value: unknown, max = 700): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function mxn(value: number): string {
  return Number(value || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function date(value = new Date()): string {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Mexico_City" }).format(value);
}

export type QuotePdfInput = {
  folio: string; companyName: string; companyRfc: string; clientName: string; clientRfc: string;
  clientAddress?: string; reference: string; description: string; productCode?: string;
  unit?: string; quantity?: number; unitPrice: number; subtotal: number; iva: number; total: number;
  solicitudId?: string; verificationUrl?: string; referencePdf?: string;
  deliveryLocation?: string;
  bankName?: string;
  bankAccount?: string;
  bankClabe?: string;
  canonicalBundle?: ReturnType<typeof loadCanonicalBundle>;
  items?: Array<{ quantity?: number; unit?: string; productCode?: string; description?: string }>;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function dataUri(buffer: Buffer, mime: string): string {
  if (mime === "image/png" && buffer[0] === 255 && buffer[1] === 216) mime = "image/jpeg";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/**
 * Production renderer for the canonical quote bundle. The HTML/CSS source is
 * authoritative; static PDFs remain immutable references only. This keeps
 * tables, QR and variable-length values within their assigned layout rather
 * than painting text over a historical PDF.
 */
async function renderCanonicalQuoteHtmlPdf(input: QuotePdfInput): Promise<Buffer> {
  const bundle = input.canonicalBundle || loadCanonicalBundle(text(input.companyRfc, 13).toUpperCase(), "COTIZACION");
  const logo = dataUri(bundle.logo, "image/png");
  const qr = dataUri(await QRCode.toBuffer(text(input.verificationUrl, 900), { type: "png", width: 220, margin: 1, errorCorrectionLevel: "M" }), "image/png");
  const quoteItems = input.items?.length ? input.items.slice(0, 12) : [{ quantity: input.quantity, unit: input.unit, description: input.description, productCode: input.productCode }];
  const rows = quoteItems.map((item, index) => `<tr><td>${escapeHtml(item.quantity || 1)}</td><td>${escapeHtml(item.unit || input.unit || "SERVICIO")}</td><td>${escapeHtml(item.description || input.description)}</td><td>${escapeHtml(item.productCode || input.productCode || "-")}</td><td class="money">${index === 0 ? escapeHtml(mxn(input.unitPrice)) : ""}</td><td class="money">${index === 0 ? escapeHtml(mxn(input.subtotal)) : ""}</td></tr>`).join("");
  const values: Record<string, string> = {
    folio: input.folio, fecha: date(), vigencia: "15 dias", "cliente.nombre": input.clientName, "cliente.rfc": input.clientRfc,
    "cliente.contacto": "Operacion PAY0", referenciaOc: input.reference, items: rows, subtotal: mxn(input.subtotal), iva: mxn(input.iva), total: mxn(input.total),
    bankName: input.bankName || "Datos bancarios no configurados", bankAccount: input.bankAccount || "-", bankClabe: input.bankClabe || "-", terms: `Lugar de entrega / prestacion: ${input.deliveryLocation || "No especificado en la OC"}`,
    qr, quotationId: input.folio, solicitudId: input.solicitudId || "-", materialidadId: input.solicitudId || "-", purchaseOrderId: input.reference, cfdiUuid: "-", logoUrl: logo, companyName: input.companyName, companyRfc: input.companyRfc, companyId: text(input.companyRfc, 13).toLowerCase(),
  };
  const css = bundle.css;
  let html = bundle.html.replace(/<link[^>]*template\.css[^>]*>/i, `<style>${css}</style>`);
  html = html.replace(/{{\s*([\w.]+)\s*}}/g, (_all, key) => key === "items" ? values[key] : escapeHtml(values[key] ?? "-"));
  return renderCanonicalHtmlPdf(html);
}

async function renderCanonicalHtmlPdf(html: string): Promise<Buffer> {
  const chromium: any = (await import("@sparticuz/chromium")).default;
  const playwright: any = await import("playwright-core");
  const configuredExecutable = text(process.env.PAY0_CHROMIUM_PATH, 500);
  const executablePath = configuredExecutable && existsSync(configuredExecutable)
    ? configuredExecutable
    : await chromium.executablePath();
  const browser = await playwright.chromium.launch({ args: configuredExecutable ? [] : chromium.args, executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, javaScriptEnabled: false });
    await page.route("**/*", (route: any) => route.abort());
    await page.setContent(html, { waitUntil: "load" });
    return Buffer.from(await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true }));
  } finally {
    await browser.close();
  }
}

export async function renderCanonicalQuotePdf(input: QuotePdfInput): Promise<Buffer> {
  return renderCanonicalQuoteHtmlPdf(input);
}

export type ConstanciaPdfInput = {
  folio: string; kind: string; companyName: string; companyRfc: string; clientName: string; clientRfc: string;
  solicitudFolio: string; reference: string; cotizacion: string; cfdi: string; description: string;
  receptorName: string; signatureHash: string; iqFolio?: string;
  signaturePng?: Buffer | null;
  receptorRole?: string;
  receiptLocation: string;
  receiptAddress: string;
  observations?: string;
  acceptanceText: string;
  canonicalBundle?: ReturnType<typeof loadCanonicalBundle>;
  verificationUrl?: string;
  items?: Array<{ quantity?: number; unit?: string; productCode?: string; description?: string }>;
};

export async function renderCanonicalConstanciaPdf(input: ConstanciaPdfInput): Promise<Buffer> {
  const verificationUrl = text(input.verificationUrl || `https://pay-0-system.web.app/solicitudes?folio=${encodeURIComponent(input.solicitudFolio)}`, 900);
  const qrPng = await QRCode.toBuffer(verificationUrl, { type: "png", width: 180, margin: 1, errorCorrectionLevel: "M" });
  const bundle = input.canonicalBundle || loadCanonicalBundle(input.companyRfc.toUpperCase(), input.kind === "CONSTANCIA_ENTREGA_BIENES" ? "CONSTANCIA_ENTREGA_BIENES" : "CONSTANCIA_SERVICIO");
  const cell = (label: string, value: string) => `<div><b>${escapeHtml(label)}</b><br>${escapeHtml(value || "No disponible")}</div>`;
  const items = input.items?.length ? input.items : [{ description: input.description }];
  const raw: Record<string, string> = {
    traceabilityHtml: cell("Solicitud", input.solicitudFolio) + cell("Orden de compra", input.reference) + cell("Cotización", input.cotizacion) + cell("CFDI / UUID", input.cfdi),
    clientHtml: cell("Cliente", input.clientName) + cell("RFC", input.clientRfc) + cell("Recibe", input.receptorName),
    itemsHtml: items.map((item, index) => `<tr><td>${escapeHtml(input.kind === "CONSTANCIA_ENTREGA_BIENES" ? item.quantity || 1 : index + 1)}</td><td>${escapeHtml(item.unit || "Unidad")}</td><td>${escapeHtml(item.description || input.description)}</td><td>No declarado</td><td>Aceptado</td></tr>`).join(""),
    qrSvg: `<img alt="QR de verificación" src="${dataUri(qrPng, "image/png")}">`,
    firmaReceptor: input.signaturePng?.length ? `<img alt="Firma de quien recibe" src="${dataUri(input.signaturePng, "image/png")}">` : "",
  };
  const values: Record<string, string> = {
    constanciaFolio: input.folio, fechaConstancia: date(), executionSummary: input.description,
    observaciones: input.observations || "Sin observaciones declaradas", evidenciaIds: input.reference,
    ubicacionEvidencia: input.receiptLocation, sha256Expediente: input.signatureHash,
    verificationUrl, receptorNombre: input.receptorName, receptorCargo: input.receptorRole || "",
    receiptLocation: input.receiptLocation, receiptAddress: input.receiptAddress, acceptanceText: input.acceptanceText,
  };
  let html = bundle.html.replace(/<link[^>]*template\.css[^>]*>/i, `<style>${bundle.css}</style>`)
    .replace(/src="assets\/logo\.png"/g, `src="${dataUri(bundle.logo, "image/png")}"`);
  html = html.replace(/{{\s*([\w.]+)\s*}}/g, (_all, key) => raw[key] ?? escapeHtml(values[key] ?? ""));
  return renderCanonicalHtmlPdf(html);
}
