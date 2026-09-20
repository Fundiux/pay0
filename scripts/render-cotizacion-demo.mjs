import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(
  repoRoot,
  "src",
  "canonicos",
  "formatos",
  "cotizaciones",
  "manifest.json",
);
const outputDir = path.join(repoRoot, "output", "cotizaciones");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(value) {
  return Number(value || 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
  });
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function loadManifest() {
  return JSON.parse(await fs.readFile(manifestPath, "utf8"));
}

function findTemplate(manifest, selector) {
  const normalized = String(selector || "trostre").trim().toLowerCase();
  return manifest.templates.find((row) => {
    return (
      String(row.companyId).toLowerCase() === normalized ||
      String(row.rfc).toLowerCase() === normalized ||
      String(row.companyName).toLowerCase().includes(normalized)
    );
  });
}

function buildRows(items) {
  return items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.quantity)}</td>
          <td>${escapeHtml(item.unit)}</td>
          <td>${escapeHtml(item.description)}</td>
          <td>${escapeHtml(item.satKey)}</td>
          <td class="money">${money(item.unitPrice)}</td>
          <td class="money">${money(item.amount)}</td>
        </tr>`,
    )
    .join("");
}

function renderHtml(template, input) {
  const rows = buildRows(input.items);
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Cotización ${escapeHtml(input.folio)}</title>
    <style>
      @page { size: letter; margin: 14mm; }
      :root { --accent: #143c5c; --ink: #172033; --muted: #667085; --line: #d9e0ea; --paper: #ffffff; }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--paper); color: var(--ink); font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; line-height: 1.35; }
      .quote-header { display: grid; grid-template-columns: 1fr 220px; gap: 24px; align-items: start; border-bottom: 4px solid var(--accent); padding-bottom: 12px; }
      .brand { display: flex; gap: 14px; align-items: center; }
      .logo-fallback { width: 112px; height: 46px; display: grid; place-items: center; border: 2px solid var(--accent); color: var(--accent); font-weight: 800; letter-spacing: 0.12em; }
      .brand h1, .quote-title h2 { margin: 0; font-size: 18px; letter-spacing: 0.02em; }
      .brand p, .quote-title p { margin: 3px 0 0; color: var(--muted); }
      .quote-title { text-align: right; }
      .eyebrow { text-transform: uppercase; color: var(--accent); font-weight: 700; letter-spacing: 0.14em; }
      dl { margin: 0; }
      .quote-title dl, .totals dl { display: grid; gap: 4px; margin-top: 8px; }
      .quote-title div, .totals div { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      dt { color: var(--muted); font-weight: 700; }
      dd { margin: 0; }
      .party-grid, .payment-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 10px; margin-top: 14px; }
      .party-grid > div, .payment-grid > div { border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
      h3 { margin: 0 0 5px; color: var(--accent); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
      p { margin: 2px 0; }
      .strong { font-weight: 700; }
      .items { width: 100%; border-collapse: collapse; margin-top: 16px; table-layout: fixed; }
      .items th { background: var(--accent); color: white; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; }
      .items th, .items td { border: 1px solid var(--line); padding: 7px 6px; vertical-align: top; }
      .items th:nth-child(1), .items td:nth-child(1) { width: 46px; text-align: center; }
      .items th:nth-child(2), .items td:nth-child(2) { width: 62px; }
      .items th:nth-child(4), .items td:nth-child(4) { width: 80px; }
      .items th:nth-child(5), .items td:nth-child(5), .items th:nth-child(6), .items td:nth-child(6) { width: 92px; }
      .money { text-align: right; white-space: nowrap; }
      .totals { display: flex; justify-content: flex-end; margin-top: 12px; }
      .totals dl { width: 230px; }
      .totals div { border-bottom: 1px solid var(--line); padding: 5px 0; }
      .grand-total { color: var(--accent); font-size: 13px; font-weight: 800; }
      .qr-box { display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 8px; text-align: center; }
      .qr-placeholder { width: 74px; height: 74px; border: 1px dashed var(--line); display: grid; place-items: center; }
      .trace { display: grid; gap: 2px; margin-top: 14px; padding-top: 8px; border-top: 1px solid var(--line); color: var(--muted); font-size: 7.5px; }
    </style>
  </head>
  <body>
    <main>
      <header class="quote-header">
        <section class="brand">
          <div class="logo-fallback">${escapeHtml(template.companyName.slice(0, 3))}</div>
          <div>
            <h1>${escapeHtml(template.companyName)}</h1>
            <p>RFC: ${escapeHtml(template.rfc)}</p>
          </div>
        </section>
        <section class="quote-title">
          <p class="eyebrow">Cotización</p>
          <h2>${escapeHtml(input.folio)}</h2>
          <dl>
            <div><dt>Fecha</dt><dd>${escapeHtml(input.fecha)}</dd></div>
            <div><dt>Vigencia</dt><dd>${escapeHtml(input.vigencia)}</dd></div>
          </dl>
        </section>
      </header>
      <section class="party-grid">
        <div><h3>Cliente</h3><p class="strong">${escapeHtml(input.cliente.nombre)}</p><p>RFC: ${escapeHtml(input.cliente.rfc)}</p></div>
        <div><h3>Contacto</h3><p>${escapeHtml(input.cliente.contacto)}</p></div>
        <div><h3>Referencia / OC</h3><p>${escapeHtml(input.referenciaOc)}</p></div>
      </section>
      <table class="items">
        <thead><tr><th>Cant.</th><th>Unidad</th><th>Descripción</th><th>Clave</th><th class="money">P. unitario</th><th class="money">Importe</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <section class="totals"><dl><div><dt>Subtotal</dt><dd>${money(input.subtotal)}</dd></div><div><dt>IVA</dt><dd>${money(input.iva)}</dd></div><div class="grand-total"><dt>Total</dt><dd>${money(input.total)}</dd></div></dl></section>
      <section class="payment-grid">
        <div><h3>Datos bancarios</h3><p>${escapeHtml(input.bankName)}</p><p>Cuenta: ${escapeHtml(input.bankAccount)}</p><p>CLABE: ${escapeHtml(input.bankClabe)}</p></div>
        <div><h3>Condiciones</h3><p>${escapeHtml(input.terms)}</p></div>
        <div class="qr-box"><div class="qr-placeholder">QR<br />trazabilidad</div></div>
      </section>
      <footer class="trace">
        <span>templateId: ${escapeHtml(template.templateId)}</span>
        <span>referencePdfSha256: ${escapeHtml(template.referencePdfSha256)}</span>
        <span>quotationId: ${escapeHtml(input.quotationId)}</span>
        <span>solicitudId: ${escapeHtml(input.solicitudId)}</span>
        <span>materialidadId: ${escapeHtml(input.materialidadId)}</span>
        <span>purchaseOrderId: ${escapeHtml(input.purchaseOrderId)}</span>
      </footer>
    </main>
  </body>
</html>`;
}

async function renderPdf(htmlPath, pdfPath) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath.replace(/\\/g, "/")}`);
  await page.pdf({
    path: pdfPath,
    format: "Letter",
    printBackground: true,
    margin: { top: "14mm", right: "14mm", bottom: "14mm", left: "14mm" },
  });
  await browser.close();
}

async function main() {
  const selector = process.argv[2] || "trostre";
  const manifest = await loadManifest();
  const template = findTemplate(manifest, selector);
  if (!template) throw new Error(`Template not found: ${selector}`);

  const subtotal = 278811.17;
  const iva = subtotal * 0.16;
  const total = subtotal + iva;
  const input = {
    folio: "COT-DEMO-0001",
    fecha: "2026-09-16",
    vigencia: "15 dias",
    cliente: {
      nombre: "OIL SPILL CONTROL SOLUTIONS",
      rfc: "OSC2010305CA",
      contacto: "Operacion PAY0",
    },
    referenciaOc: "OC-DEMO-PAY0",
    items: [
      {
        quantity: 1,
        unit: "SERVICIO",
        description: "RENTA DE BARRERA ANTI-DERRAME",
        satKey: "72141702",
        unitPrice: subtotal,
        amount: subtotal,
      },
    ],
    subtotal,
    iva,
    total,
    bankName: "BBVA Empresarial",
    bankAccount: "****",
    bankClabe: "****",
    terms: "Cotizacion generada para prueba local PAY0. No representa CFDI ni compromiso fiscal.",
    quotationId: "demo-quotation-local",
    solicitudId: "demo-solicitud-local",
    materialidadId: "demo-materialidad-local",
    purchaseOrderId: "demo-oc-local",
  };

  await fs.mkdir(outputDir, { recursive: true });
  const html = renderHtml(template, input);
  const safeName = `${template.companyId}-cotizacion-demo`;
  const htmlPath = path.join(outputDir, `${safeName}.html`);
  const pdfPath = path.join(outputDir, `${safeName}.pdf`);
  const snapshotPath = path.join(outputDir, `${safeName}.snapshot.json`);
  await fs.writeFile(htmlPath, html, "utf8");

  let pdfSha256 = "";
  try {
    await renderPdf(htmlPath, pdfPath);
    pdfSha256 = sha256(await fs.readFile(pdfPath));
  } catch (error) {
    console.warn(`PDF render skipped/failed: ${error?.message || error}`);
  }

  const htmlSha256 = sha256(await fs.readFile(htmlPath));
  const snapshot = {
    documentType: manifest.documentType,
    templateId: template.templateId,
    templateVersion: template.version,
    companyId: template.companyId,
    companyName: template.companyName,
    companyRfc: template.rfc,
    referencePdf: template.referencePdf,
    referencePdfSha256: template.referencePdfSha256,
    generatedHtml: path.relative(repoRoot, htmlPath).replace(/\\/g, "/"),
    generatedHtmlSha256: htmlSha256,
    generatedPdf: pdfSha256 ? path.relative(repoRoot, pdfPath).replace(/\\/g, "/") : "",
    generatedDocumentSha256: pdfSha256,
    quotationId: input.quotationId,
    solicitudId: input.solicitudId,
    materialidadId: input.materialidadId,
    purchaseOrderId: input.purchaseOrderId,
    status: pdfSha256 ? "PDF_GENERATED" : "HTML_GENERATED",
  };
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");

  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
