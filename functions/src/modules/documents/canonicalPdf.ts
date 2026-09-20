import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { PDFDocument as PDFLibDocument, StandardFonts, rgb } from "pdf-lib";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const navy = "#123B59";
const pale = "#EAF1F5";
const ink = "#18212A";
const muted = "#5D6A75";

type Pdf = PDFKit.PDFDocument;
const trostreLogoPath = resolve(__dirname, "../../assets/Trostre.png");

function companyBrand(doc: Pdf, fallback: string, companyRfc: string, x: number, y: number): void {
  const canonicalLogoPath = resolve(__dirname, `../../assets/companies/${companyRfc}.png`);
  const logoPath = existsSync(canonicalLogoPath)
    ? canonicalLogoPath
    : companyRfc === "TRO230717L64" && existsSync(trostreLogoPath)
      ? trostreLogoPath
      : null;
  if (logoPath) {
    doc.image(logoPath, x, y, { fit: [145, 40], valign: "center" });
    return;
  }
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(17).text(fallback, x, y);
}

function text(value: unknown, max = 700): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function mxn(value: number): string {
  return Number(value || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function date(value = new Date()): string {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Mexico_City" }).format(value);
}

function document(draw: (doc: Pdf) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, info: { Creator: "PAY0", Producer: "PAY0 canonical document renderer" } });
    const parts: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => parts.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(parts)));
    doc.on("error", reject);
    draw(doc);
    doc.end();
  });
}

function line(doc: Pdf, x: number, y: number, width: number, color = navy): void {
  doc.strokeColor(color).lineWidth(0.7).moveTo(x, y).lineTo(x + width, y).stroke();
}

function box(doc: Pdf, x: number, y: number, width: number, height: number, title: string, value: string): void {
  doc.roundedRect(x, y, width, height, 2).fillAndStroke("#FFFFFF", "#BAC8D2");
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(6.5).text(title.toUpperCase(), x + 6, y + 5, { width: width - 12 });
  doc.fillColor(ink).font("Helvetica").fontSize(8).text(value || "—", x + 6, y + 15, { width: width - 12, height: height - 18, ellipsis: true });
}

function section(doc: Pdf, title: string, y: number): number {
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text(title.toUpperCase(), 36, y);
  line(doc, 36, y + 13, 523, "#9BB3C3");
  return y + 19;
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
  items?: Array<{ quantity?: number; unit?: string; productCode?: string; description?: string }>;
};

function quoteTemplatePath(referencePdf?: string): string | null {
  const safeName = String(referencePdf || "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeName) return null;
  const candidate = resolve(__dirname, `../../assets/cotizaciones/${safeName}`);
  return existsSync(candidate) ? candidate : null;
}

function quoteText(value: unknown, max = 120): string {
  return text(value, max) || "-";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function dataUri(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/** Visual identity belongs to the issuer, never to the old reference PDF. */
function quotationAccent(companyRfc: string): string {
  const accents: Record<string, string> = {
    TRO230717L64: "#143C5C",
    ECO1907171N7: "#C72B47",
  };
  return accents[text(companyRfc, 13).toUpperCase()] || "#0F4C81";
}

/**
 * Production renderer for the canonical quote bundle. The HTML/CSS source is
 * authoritative; static PDFs remain immutable references only. This keeps
 * tables, QR and variable-length values within their assigned layout rather
 * than painting text over a historical PDF.
 */
async function renderCanonicalQuoteHtmlPdf(input: QuotePdfInput): Promise<Buffer> {
  const templateRoot = resolve(__dirname, "../../assets/cotizaciones/templates/base");
  const htmlPath = resolve(templateRoot, "template.html");
  const cssPath = resolve(templateRoot, "template.css");
  if (!existsSync(htmlPath) || !existsSync(cssPath)) throw new Error("Canonical quotation HTML bundle is missing.");
  const companyRfc = text(input.companyRfc, 13).toUpperCase();
  const logoPath = companyRfc === "TRO230717L64" && existsSync(trostreLogoPath)
    ? trostreLogoPath
    : resolve(__dirname, `../../assets/companies/${companyRfc}.png`);
  const logo = existsSync(logoPath) ? dataUri(readFileSync(logoPath), "image/png") : "";
  const qr = dataUri(await QRCode.toBuffer(text(input.verificationUrl, 900), { type: "png", width: 220, margin: 1, errorCorrectionLevel: "M" }), "image/png");
  const quoteItems = input.items?.length ? input.items.slice(0, 12) : [{ quantity: input.quantity, unit: input.unit, description: input.description, productCode: input.productCode }];
  const rows = quoteItems.map((item, index) => `<tr><td>${escapeHtml(item.quantity || 1)}</td><td>${escapeHtml(item.unit || input.unit || "SERVICIO")}</td><td>${escapeHtml(item.description || input.description)}</td><td>${escapeHtml(item.productCode || input.productCode || "-")}</td><td class="money">${index === 0 ? escapeHtml(mxn(input.unitPrice)) : ""}</td><td class="money">${index === 0 ? escapeHtml(mxn(input.subtotal)) : ""}</td></tr>`).join("");
  const values: Record<string, string> = {
    folio: input.folio, fecha: date(), vigencia: "15 dias", "cliente.nombre": input.clientName, "cliente.rfc": input.clientRfc,
    "cliente.contacto": "Operacion PAY0", referenciaOc: input.reference, items: rows, subtotal: mxn(input.subtotal), iva: mxn(input.iva), total: mxn(input.total),
    bankName: input.bankName || "Datos bancarios no configurados", bankAccount: input.bankAccount || "-", bankClabe: input.bankClabe || "-", terms: `Lugar de entrega / prestacion: ${input.deliveryLocation || "No especificado en la OC"}`,
    qr, quotationId: input.folio, solicitudId: input.solicitudId || "-", materialidadId: input.solicitudId || "-", purchaseOrderId: input.reference, cfdiUuid: "-", logoUrl: logo, companyName: input.companyName, companyRfc: input.companyRfc, companyId: text(input.companyRfc, 13).toLowerCase(),
  };
  const css = readFileSync(cssPath, "utf8");
  const theme = `<style>:root { --accent: ${quotationAccent(input.companyRfc)}; }</style>`;
  let html = readFileSync(htmlPath, "utf8").replace(/<link[^>]*template\.css[^>]*>/i, `<style>${css}</style>${theme}`);
  html = html.replace(/{{\s*([\w.]+)\s*}}/g, (_all, key) => values[key] ?? "-");
  const chromium: any = (await import("@sparticuz/chromium")).default;
  const playwright: any = await import("playwright-core");
  const configuredExecutable = text(process.env.PAY0_CHROMIUM_PATH, 500);
  const executablePath = configuredExecutable && existsSync(configuredExecutable)
    ? configuredExecutable
    : await chromium.executablePath();
  const browser = await playwright.chromium.launch({ args: configuredExecutable ? [] : chromium.args, executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
    await page.setContent(html, { waitUntil: "networkidle" });
    return Buffer.from(await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true }));
  } finally {
    await browser.close();
  }
}

/**
 * The quotation PDFs in the canonical catalog are the actual presentation
 * contract for each issuer.  Fill those pages in-place so company branding,
 * colors, tables, and layout do not silently fall back to a generic PAY0 PDF.
 */
async function renderPublishedQuoteTemplate(input: QuotePdfInput, templatePath: string): Promise<Buffer> {
  const pdf = await PDFLibDocument.load(readFileSync(templatePath));
  const page = pdf.getPage(0);
  const { height } = page.getSize();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const verificationUrl = text(input.verificationUrl, 900);
  const qr = await pdf.embedPng(await QRCode.toBuffer(verificationUrl, { type: "png", width: 180, margin: 1, errorCorrectionLevel: "M" }));
  const black = rgb(0.14, 0.14, 0.14);
  const red = rgb(0.94, 0.15, 0.16);
  const white = rgb(1, 1, 1);
  const y = (top: number) => height - top;
  const erase = (x: number, top: number, w: number, h: number, color = white) => page.drawRectangle({ x, y: height - top - h, width: w, height: h, color });
  const draw = (value: string, x: number, top: number, size = 7, options: { font?: any; color?: any; max?: number } = {}) => {
    const raw = quoteText(value, options.max || 120);
    const maxWidth = options.max || 120;
    const font = options.font || regular;
    let shown = raw;
    while (shown.length > 1 && font.widthOfTextAtSize(shown, size) > maxWidth) shown = `${shown.slice(0, -2)}.`;
    page.drawText(shown, { x, y: y(top + size), size, font, color: options.color || black });
  };

  // TROSTRE has an A4 v2 canonical layout, while the remaining catalogue
  // templates use the letter-size v1 grid below. It is still filled from its
  // actual published page, never replaced by a generic quotation.
  if (height > 820) {
    const blue = rgb(0.06, 0.22, 0.35);
    const panel = rgb(0.95, 0.96, 0.98);
    erase(458, 60, 112, 18); draw(quoteText(input.folio, 45), 462, 65, 8, { max: 104 });
    erase(518, 75, 52, 16); draw(date(), 521, 79, 7, { max: 46 });
    erase(505, 89, 65, 16); draw("15 dias", 509, 93, 7, { max: 58 });
    erase(32, 163, 132, 18); draw(input.clientName, 35, 169, 6, { max: 128 });
    erase(177, 163, 128, 18); draw(input.clientRfc, 181, 168, 7, { max: 120 });
    erase(318, 163, 124, 18); draw("Operacion PAY0", 322, 168, 7, { max: 116 });
    erase(446, 163, 112, 18); draw(input.reference, 450, 168, 7, { max: 104 });
    const tableTop = 216; const tableBottom = 344;
    erase(36, tableTop, 535, tableBottom - tableTop);
    page.drawRectangle({ x: 36, y: height - tableBottom, width: 524, height: tableBottom - tableTop, borderColor: rgb(0.72, 0.78, 0.84), borderWidth: 0.45 });
    [80, 144, 360, 434, 504].forEach((x) => page.drawLine({ start: { x, y: height - tableTop }, end: { x, y: height - tableBottom }, color: rgb(0.72, 0.78, 0.84), thickness: 0.45 }));
    [242, 268, 294, 320].forEach((top) => page.drawLine({ start: { x: 36, y: height - top }, end: { x: 560, y: height - top }, color: rgb(0.72, 0.78, 0.84), thickness: 0.45 }));
    const quoteItems = input.items?.length ? input.items.slice(0, 4) : [{ quantity: input.quantity, unit: input.unit, description: input.description, productCode: input.productCode }];
    quoteItems.forEach((item, index) => {
      const rowTop = 222 + (index * 26);
      draw(String(item.quantity || 1), 40, rowTop, 7, { max: 35 });
      draw(item.unit || input.unit || "SERVICIO", 83, rowTop, 7, { max: 56 });
      draw(item.description || input.description, 148, rowTop, 7, { max: 207 });
      draw(item.productCode || input.productCode || "-", 365, rowTop, 7, { max: 64 });
      draw(index === 0 ? mxn(input.unitPrice) : "", 437, rowTop, 7, { max: 62 });
      draw(index === 0 ? mxn(input.subtotal) : "", 507, rowTop, 7, { max: 51 });
    });
    erase(496, 346, 64, 15, panel); draw(mxn(input.subtotal), 501, 350, 8, { font: bold, color: blue, max: 56 });
    erase(526, 367, 34, 15, panel); draw(mxn(input.iva), 501, 371, 8, { font: bold, color: blue, max: 56 });
    erase(482, 388, 78, 15, panel); draw(mxn(0), 501, 392, 8, { font: bold, color: blue, max: 56 });
    erase(511, 409, 49, 15, blue); draw(mxn(input.total), 501, 413, 8, { font: bold, color: white, max: 56 });
    erase(70, 491, 150, 15, panel); draw("MXN", 74, 496, 7, { max: 140 });
    erase(98, 503, 160, 15, panel); draw("Transferencia", 101, 508, 7, { max: 150 });
    erase(94, 515, 165, 15, panel); draw("Pago en una sola exhibicion", 98, 520, 7, { max: 155 });
    erase(145, 527, 130, 15, panel); draw("15 dias", 149, 532, 7, { max: 120 });
    erase(142, 539, 190, 15, panel); draw(input.deliveryLocation || "Segun Orden de Compra", 145, 544, 7, { max: 180 });
    erase(94, 551, 190, 15, panel); draw("Documento generado por PAY0", 98, 556, 7, { max: 180 });
    erase(367, 539, 95, 15, panel); draw(input.reference, 372, 544, 7, { max: 86 });
    erase(405, 570, 165, 115);
    page.drawImage(qr, { x: 470, y: height - 655, width: 82, height: 82 });
    page.drawText("QR DE VERIFICACION", { x: 458, y: height - 669, size: 6, font: bold, color: blue });
    return Buffer.from(await pdf.save());
  }

  // Header values for the letter-size canonical v1 grid.
  erase(449, 54, 132, 18); draw(`Folio: ${quoteText(input.folio, 50)}`, 454, 58, 8, { max: 125 });
  erase(528, 79, 53, 14); draw(date(), 531, 82, 7, { max: 48 });
  erase(517, 92, 64, 14); draw("15 dias", 530, 95, 7, { max: 48 });
  // Client/reference row.
  erase(34, 177, 100, 22); draw(quoteText(input.clientName, 42), 39, 181, 7, { max: 125 });
  erase(170, 177, 75, 22); draw(quoteText(input.clientRfc, 18), 173, 181, 7, { max: 70 });
  erase(307, 177, 105, 22); draw("Operacion PAY0", 310, 181, 7, { max: 100 });
  erase(442, 177, 88, 22); draw(quoteText(input.reference, 28), 445, 181, 7, { max: 84 });

  // The catalog intentionally allocates five printable lines. A sixth and
  // later OC item is summarised in the final line to retain a single page.
  const rows = (input.items?.length ? input.items.slice(0, 5) : [{ quantity: input.quantity, unit: input.unit, description: input.description, productCode: input.productCode }]).map((item, index) => [
    String(item.quantity || 1), quoteText(item.unit || input.unit || "SERVICIO", 14), quoteText(item.description || input.description, 72), quoteText(item.productCode || input.productCode || "-", 14), index === 0 ? mxn(input.unitPrice) : "", index === 0 ? mxn(input.subtotal) : "",
  ]);
  // Clear the pre-printed placeholder grid as a whole, then restore the exact
  // table structure. This handles templates whose placeholder braces wrap.
  const tableTop = 235;
  const tableBottom = 360;
  erase(28, tableTop, 558, tableBottom - tableTop);
  const tableLine = rgb(0.2, 0.2, 0.2);
  page.drawRectangle({ x: 28, y: height - tableBottom, width: 558, height: tableBottom - tableTop, borderColor: tableLine, borderWidth: 0.45 });
  [68, 122, 377, 461, 530].forEach((x) => page.drawLine({ start: { x, y: height - tableTop }, end: { x, y: height - tableBottom }, color: tableLine, thickness: 0.45 }));
  [260, 285, 310, 335].forEach((top) => page.drawLine({ start: { x: 28, y: height - top }, end: { x: 586, y: height - top }, color: tableLine, thickness: 0.45 }));
  for (let index = 0; index < 5; index += 1) {
    const top = 237 + index * 25;
    const row = rows[index];
    if (!row) continue;
    draw(row[0], 30, top + 3, 7, { max: 34 });
    draw(row[1], 72, top + 3, 7, { max: 48 });
    draw(row[2], 124, top + 3, 7, { max: 248 });
    draw(row[3], 380, top + 3, 7, { max: 72 });
    draw(row[4], 462, top + 3, 7, { max: 62 });
    draw(row[5], 532, top + 3, 7, { max: 50 });
  }
  erase(510, 359, 70, 15); draw(mxn(input.subtotal), 516, 362, 8, { max: 61 });
  erase(538, 381, 42, 15); draw(mxn(input.iva), 515, 384, 8, { max: 62 });
  erase(498, 403, 82, 15); draw(mxn(0), 515, 406, 8, { max: 62 });
  erase(523, 425, 57, 16); draw(mxn(input.total), 515, 428, 8, { font: bold, color: red, max: 62 });
  // Only data fields are replaced; canonical headers and issuer banking copy
  // remain part of the signed-off template.
  const panel = rgb(0.95, 0.96, 0.97);
  erase(70, 468, 160, 14, panel); draw("MXN", 72, 472, 7, { max: 155 });
  erase(95, 480, 160, 14, panel); draw("Transferencia", 98, 483, 7, { max: 155 });
  erase(92, 491, 160, 14, panel); draw("Pago en una sola exhibicion", 95, 494, 7, { max: 155 });
  erase(142, 502, 140, 14, panel); draw("15 dias", 145, 505, 7, { max: 132 });
  erase(140, 513, 190, 14, panel); draw(input.deliveryLocation || "Segun Orden de Compra", 143, 516, 7, { max: 182 });
  erase(92, 524, 190, 14, panel); draw("Documento generado por PAY0", 95, 527, 7, { max: 184 });
  erase(423, 511, 92, 14, panel); draw(quoteText(input.reference, 18), 426, 514, 7, { max: 84 });
  erase(475, 642, 105, 89);
  page.drawImage(qr, { x: 504, y: height - 716, width: 58, height: 58 });
  page.drawText("QR DE VERIFICACION", { x: 493, y: height - 724, size: 5.5, font: regular, color: red });
  return Buffer.from(await pdf.save());
}

export async function renderCanonicalQuotePdf(input: QuotePdfInput): Promise<Buffer> {
  // Reference PDFs are immutable visual evidence. Generated documents use the
  // structured canonical layout below instead of writing over placeholders.
  try {
    return await renderCanonicalQuoteHtmlPdf(input);
  } catch (error) {
    // The fallback keeps document generation available during a transient
    // browser-runtime failure; it never re-enables PDF overlay rendering.
    console.error("[documents] canonical HTML quotation renderer failed", error);
  }
  const verificationUrl = text(
    input.verificationUrl || `https://pay-0-system.web.app/solicitudes?folio=${encodeURIComponent(input.reference)}`,
    900,
  );
  const qrPng = await QRCode.toBuffer(verificationUrl, {
    type: "png",
    width: 180,
    margin: 1,
    errorCorrectionLevel: "M",
  });
  return document((doc) => {
    const left = 36; const right = 559; const width = right - left;
    doc.rect(0, 0, 595, 22).fill(navy);
    companyBrand(doc, text(input.companyName), text(input.companyRfc), left, 27);
    doc.fillColor(muted).font("Helvetica").fontSize(7.5).text(`${text(input.companyName)}  |  RFC ${text(input.companyRfc)}`, left, 68);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(18).text("COTIZACIÓN", 390, 33, { width: 169, align: "right" });
    doc.fillColor(ink).font("Helvetica").fontSize(8).text(`Folio: ${text(input.folio)}`, 390, 57, { width: 169, align: "right" });
    doc.text(`Fecha: ${date()}`, 390, 68, { width: 169, align: "right" });
    line(doc, left, 91, width);

    let y = section(doc, "Datos de la operación", 103);
    box(doc, left, y, 255, 35, "Cliente", text(input.clientName));
    box(doc, 297, y, 262, 35, "RFC cliente", text(input.clientRfc)); y += 41;
    box(doc, left, y, 255, 35, "Domicilio fiscal", text(input.clientAddress || "Conforme a Constancia de Situación Fiscal"));
    box(doc, 297, y, 262, 35, "Orden de compra / referencia", text(input.reference)); y += 53;

    y = section(doc, "Conceptos cotizados", y);
    const cols = [45, 60, 222, 70, 70, 56];
    const labels = ["CANT.", "UNIDAD", "DESCRIPCIÓN", "CLAVE", "P. UNITARIO", "IMPORTE"];
    let x = left;
    doc.rect(left, y, width, 19).fill(navy);
    labels.forEach((label, index) => { doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(6.4).text(label, x + 4, y + 6, { width: cols[index] - 8, align: index >= 4 ? "right" : "left" }); x += cols[index]; });
    y += 19; x = left;
    doc.rect(left, y, width, 47).fillAndStroke("#FFFFFF", "#BAC8D2");
    const values = [String(input.quantity || 1), text(input.unit || "SERVICIO"), text(input.description), text(input.productCode || "—"), mxn(input.unitPrice), mxn(input.subtotal)];
    values.forEach((value, index) => { doc.fillColor(ink).font("Helvetica").fontSize(7.3).text(value, x + 4, y + 7, { width: cols[index] - 8, height: 35, align: index >= 4 ? "right" : "left", ellipsis: true }); x += cols[index]; });
    y += 58;
    const totalX = 385;
    [["Subtotal", input.subtotal], ["IVA 16%", input.iva], ["TOTAL", input.total]].forEach(([label, amount], index) => {
      const isTotal = index === 2;
      doc.fillColor(isTotal ? navy : muted).font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(isTotal ? 10 : 8.5).text(String(label), totalX, y + index * 17, { width: 80, align: "right" });
      doc.fillColor(isTotal ? navy : ink).font(isTotal ? "Helvetica-Bold" : "Helvetica").text(mxn(Number(amount)), 470, y + index * 17, { width: 89, align: "right" });
    });
    y += 69;
    y = section(doc, "Datos bancarios", y);
    box(doc, left, y, width, 39, input.bankName || "Cuenta de deposito", `Cuenta: ${text(input.bankAccount || "-")}   CLABE: ${text(input.bankClabe || "-")}`);
    y += 51;
    y = section(doc, "Condiciones y datos de pago", y);
    doc.fillColor(ink).font("Helvetica").fontSize(7.7).text(`Lugar de entrega / prestacion: ${text(input.deliveryLocation || "No especificado en la OC")}`, left, y, { width: 425 });
    doc.text("Vigencia: 15 dias naturales. Pago mediante transferencia bancaria. Esta cotizacion queda vinculada con la Orden de Compra y el expediente PAY0.", left, y + 13, { width: 425 });

    // The current canonical quotation has no signature block. Keep its QR as
    // the compact, verifiable traceability entry for the originating record.
    doc.image(qrPng, 490, y - 7, { fit: [60, 60] });
    doc.fillColor(muted).font("Helvetica").fontSize(5.8).text("QR DE TRAZABILIDAD", 469, y + 54, { width: 90, align: "center" });
    doc.fillColor("#6C7F8D").fontSize(6.2).text(
      `PAY0 | ${text(input.folio)} | Solicitud ${text(input.solicitudId || input.reference)} | Documento verificable por QR`,
      left,
      780,
      { width },
    );
  });
}

export type ConstanciaPdfInput = {
  folio: string; kind: string; companyName: string; companyRfc: string; clientName: string; clientRfc: string;
  solicitudFolio: string; reference: string; cotizacion: string; cfdi: string; description: string;
  receptorName: string; signatureHash: string; iqFolio?: string;
  signaturePng?: Buffer | null;
  receptorRole?: string;
  verificationUrl?: string;
  items?: Array<{ quantity?: number; unit?: string; productCode?: string; description?: string }>;
};

export async function renderCanonicalConstanciaPdf(input: ConstanciaPdfInput): Promise<Buffer> {
  const verificationUrl = text(input.verificationUrl || `https://pay-0-system.web.app/solicitudes?folio=${encodeURIComponent(input.solicitudFolio)}`, 900);
  const qrPng = await QRCode.toBuffer(verificationUrl, { type: "png", width: 180, margin: 1, errorCorrectionLevel: "M" });
  return document((doc) => {
    const left = 36; const width = 523;
    doc.rect(0, 0, 595, 22).fill(navy);
    companyBrand(doc, text(input.companyName), text(input.companyRfc), left, 29);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(14).text("CONSTANCIA DE RECEPCIÓN Y SATISFACCIÓN", 220, 35, { width: 339, align: "right" });
    doc.fillColor(muted).font("Helvetica").fontSize(7.5).text(`${text(input.companyName)} | RFC ${text(input.companyRfc)}`, left, 57);
    doc.fillColor(ink).fontSize(7.5).text(`Folio: ${text(input.folio)}  ·  Fecha: ${date()}`, 320, 57, { width: 239, align: "right" });
    line(doc, left, 79, width);
    let y = section(doc, "Trazabilidad de la operación", 92);
    box(doc, left, y, 255, 34, "Solicitud PAY0", text(input.solicitudFolio));
    box(doc, 297, y, 262, 34, "OC / referencia", text(input.reference)); y += 40;
    box(doc, left, y, 255, 34, "Cotización", text(input.cotizacion));
    box(doc, 297, y, 262, 34, "CFDI / UUID", text(input.cfdi)); y += 52;
    y = section(doc, "Cliente receptor", y);
    box(doc, left, y, 255, 34, "Razón social", text(input.clientName));
    box(doc, 297, y, 262, 34, "RFC", text(input.clientRfc)); y += 52;
    y = section(doc, input.kind === "CONSTANCIA_ENTREGA_BIENES" ? "Bienes entregados" : "Servicios prestados", y);
    doc.rect(left, y, width, 19).fill(navy);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(6.5).text("DESCRIPCIÓN", left + 6, y + 6);
    doc.fillColor("#FFFFFF").text("EJECUCIÓN", 432, y + 6, { width: 120, align: "right" });
    y += 19;
    const itemsDescription = input.items?.length
      ? input.items.slice(0, 4).map((item, index) => `${index + 1}. ${text(item.description || input.description, 180)}${item.unit ? ` (${text(item.unit, 30)})` : ""}`).join("\n")
      : text(input.description);
    doc.rect(left, y, width, 55).fillAndStroke("#FFFFFF", "#BAC8D2");
    doc.fillColor(ink).font("Helvetica").fontSize(8).text(itemsDescription, left + 7, y + 8, { width: 380, height: 40, ellipsis: true });
    doc.fillColor(ink).fontSize(7.5).text("Recibido a satisfacción", 410, y + 8, { width: 142, align: "right" });
    y += 67;
    y = section(doc, "Declaración de recepción y conformidad", y);
    doc.fillColor(ink).font("Helvetica").fontSize(7.5).text("El receptor manifiesta haber recibido y aceptado a satisfacción los bienes o servicios descritos. La firma electrónica vinculada a este documento constituye evidencia de recepción y conformidad, salvo observaciones asentadas expresamente.", left, y + 2, { width, lineGap: 2 });
    y += 46;
    y = section(doc, "Evidencia y firma", y);
    doc.fillColor(muted).font("Helvetica").fontSize(7).text(`Firma vinculada: ${text(input.signatureHash || "pendiente", 70)}`, left, y + 3, { width });
    doc.fillColor(ink).fontSize(8).text(`Recibe y acepta: ${text(input.receptorName)}`, left, y + 17, { width: 235 });
    if (input.receptorRole) doc.fillColor(muted).fontSize(6.8).text(text(input.receptorRole), left, y + 29, { width: 235 });
    // The captured signature is evidence, not merely a hash reference. Embed
    // the exact sealed PNG in the recipient signature block of this immutable
    // generated version.
    if (input.signaturePng?.length) {
      try {
        doc.image(input.signaturePng, left + 42, y + 31, { fit: [150, 28], align: "center", valign: "center" });
      } catch {
        doc.fillColor(muted).fontSize(6.5).text("Firma capturada (ver hash)", left, y + 38, { width: 235, align: "center" });
      }
    }
    line(doc, left, y + 53, 205, "#718796");
    line(doc, 250, y + 53, 170, "#718796");
    doc.fillColor(muted).fontSize(6.5).text("CLIENTE / RECEPTOR", left, y + 58, { width: 205, align: "center" });
    doc.text(text(input.companyName), 250, y + 58, { width: 170, align: "center" });
    doc.image(qrPng, 455, y + 2, { fit: [74, 74] });
    doc.fillColor(muted).fontSize(5.8).text("QR DE VERIFICACION", 435, y + 79, { width: 115, align: "center" });
    doc.fillColor("#6C7F8D").fontSize(6.2).text(`PAY0 · ${text(input.folio)} · ${text(input.iqFolio || "Sin folio IQ")}`, left, 800, { width });
  });
}
