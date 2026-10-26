import { createHash } from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const DOCUMENT_TEMPLATE_TYPES = ["COTIZACION", "CONSTANCIA_ENTREGA_BIENES", "CONSTANCIA_SERVICIO", "ORDEN_COMPRA", "FACTURA", "CONTRATO", "OTRO"] as const;
export type DocumentTemplateType = typeof DOCUMENT_TEMPLATE_TYPES[number];
export const DOCUMENT_TEMPLATE_NAMES: Record<DocumentTemplateType, string> = {
  COTIZACION: "Cotización", CONSTANCIA_ENTREGA_BIENES: "Constancia de entrega", CONSTANCIA_SERVICIO: "Constancia de servicio",
  ORDEN_COMPRA: "Orden de compra", FACTURA: "Factura", CONTRATO: "Contrato", OTRO: "Otro documento",
};
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const css = "body{font-family:Arial,sans-serif;color:#172235;padding:36px}h1{color:#183652}table{width:100%;border-collapse:collapse;margin:18px 0}td,th{border:1px solid #d6dde8;padding:7px;text-align:left}.money{text-align:right}.meta{color:#526278}.sign{margin-top:32px}.signature-image img{max-height:55px}.qr img{height:70px}";
const logo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=", "base64");

/** Neutral global starter. Editing creates a new immutable version; issued PDFs keep their snapshot. */
export async function globalTemplateBase(input: { use: DocumentTemplateType; companyId: string; companyName: string; rfc: string; heading?: string; footer?: string; accent?: string }) {
  const label = DOCUMENT_TEMPLATE_NAMES[input.use];
  const title = escape(input.heading || input.companyName), footer = escape(input.footer || "");
  const accent = /^#[0-9a-fA-F]{6}$/.test(input.accent || "") ? input.accent! : "#183652";
  const styledCss = css.replace("#183652", accent);
  const html = input.use === "COTIZACION"
    ? `<html><head><link href="template.css" rel="stylesheet"></head><body><h1>${title}</h1><h2>Cotización {{folio}}</h2><p class="meta">Fecha {{fecha}} · Cliente {{cliente.nombre}} · RFC {{cliente.rfc}} · OC {{referenciaOc}}</p><table><thead><tr><th>Cantidad</th><th>Unidad</th><th>Concepto</th><th>Clave fiscal, si existe</th><th>Precio</th><th>Importe</th></tr></thead><tbody>{{items}}</tbody></table><p>Subtotal {{subtotal}} · IVA {{iva}} · Total {{total}}</p><p>{{terms}}</p><p>{{bankName}} {{bankAccount}} {{bankClabe}}</p><div>{{qr}}</div><footer>${footer}</footer></body></html>`
    : input.use.startsWith("CONSTANCIA")
      ? `<html><head><link href="template.css" rel="stylesheet"></head><body><h1>${title}</h1><h2>${label} {{constanciaFolio}}</h2><p>Fecha {{fechaConstancia}}</p><div>{{clientHtml}}</div><div>{{traceabilityHtml}}</div><table><tbody>{{itemsHtml}}</tbody></table><p>{{executionSummary}}</p><p>{{receiptLocation}} {{receiptAddress}}</p><p>{{acceptanceText}}</p><div class="sign">{{receptorNombre}} {{firmaReceptor}}</div><div class="qr">{{qrSvg}}</div><footer>${footer}</footer></body></html>` : "";
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(`${label} - plantilla base`, { x: 44, y: 780, size: 20, font, color: rgb(0.1, 0.2, 0.3) });
  page.drawText((input.heading || input.companyName).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?").slice(0, 75), { x: 44, y: 746, size: 11, font });
  page.drawText((input.footer || "Personalizar y aprobar antes de utilizar.").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?").slice(0, 90), { x: 44, y: 722, size: 10, font });
  const reference = Buffer.from(await pdf.save());
  const snapshot = { templateId: `PAY0-GLOBAL-${input.use}`, templateVersion: "1.0", companyId: input.companyId, companyRfc: input.rfc,
    companyName: input.companyName, referencePdfSha256: sha(reference), templateBundleSha256: sha(Buffer.concat([Buffer.from(html), Buffer.from(styledCss), logo])),
    templateEngine: html ? "PAY0_CANONICAL_HTML_CSS_PRINT_V2" : "REFERENCE_ONLY", documentUse: input.use };
  return { html, css: styledCss, logo, reference, snapshot };
}
