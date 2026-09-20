import {
  buildCotizacionMaterialityTemplateSnapshot,
  resolveCanonicalCotizacionTemplate,
  type CotizacionCanonicalTemplate,
} from "@/canonicos/cotizaciones";

export type CotizacionRenderItem = {
  quantity: number | string;
  unit: string;
  description: string;
  satKey?: string;
  unitPrice: number | string;
  amount: number | string;
};

export type CotizacionRenderInput = {
  companyId?: string;
  companyRfc?: string;
  companyName?: string;
  logoUrl?: string;
  folio: string;
  fecha: string;
  vigencia: string;
  cliente: {
    nombre: string;
    rfc: string;
    contacto?: string;
  };
  referenciaOc?: string;
  items: CotizacionRenderItem[];
  subtotal: number | string;
  iva: number | string;
  total: number | string;
  bankName?: string;
  bankAccount?: string;
  bankClabe?: string;
  terms?: string;
  qr?: string;
  quotationId?: string;
  solicitudId?: string;
  materialidadId?: string;
  purchaseOrderId?: string;
  cfdiUuid?: string;
};

export type CotizacionRenderResult = {
  html: string;
  template: CotizacionCanonicalTemplate;
  materialitySnapshot: ReturnType<typeof buildCotizacionMaterialityTemplateSnapshot> & {
    generatedDocumentSha256: "";
    quotationId: string;
    solicitudId: string;
    materialidadId: string;
    purchaseOrderId: string;
    cfdiUuid: string;
  };
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(value: number | string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("es-MX", {
      style: "currency",
      currency: "MXN",
    });
  }
  return esc(value);
}

function renderRows(items: CotizacionRenderItem[]): string {
  return items
    .map(
      (item) => `
          <tr>
            <td>${esc(item.quantity)}</td>
            <td>${esc(item.unit)}</td>
            <td>${esc(item.description)}</td>
            <td>${esc(item.satKey || "")}</td>
            <td class="money">${money(item.unitPrice)}</td>
            <td class="money">${money(item.amount)}</td>
          </tr>`,
    )
    .join("");
}

export function renderCotizacionHtml(input: CotizacionRenderInput): CotizacionRenderResult {
  const template = resolveCanonicalCotizacionTemplate({
    companyId: input.companyId,
    rfc: input.companyRfc,
    companyName: input.companyName,
  });
  if (!template) {
    throw new Error("COTIZACION_CANONICAL_TEMPLATE_NOT_FOUND");
  }
  if (!input.items.length) {
    throw new Error("COTIZACION_ITEMS_REQUIRED");
  }

  const companyName = input.companyName || template.companyName;
  const companyRfc = input.companyRfc || template.rfc;
  const items = renderRows(input.items);

  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Cotización ${esc(input.folio)}</title>
    <style>
      @page { size: letter; margin: 14mm; }
      :root { --accent: #0f4c81; --ink: #172033; --muted: #667085; --line: #d9e0ea; --paper: #ffffff; }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--paper); color: var(--ink); font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; line-height: 1.35; }
      .quote-header { display: grid; grid-template-columns: 1fr 220px; gap: 24px; align-items: start; border-bottom: 4px solid var(--accent); padding-bottom: 12px; }
      .brand { display: flex; gap: 14px; align-items: center; }
      .brand-logo { max-width: 130px; max-height: 54px; object-fit: contain; }
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
      .qr-box { display: flex; align-items: center; justify-content: center; }
      .qr-box img { width: 74px; height: 74px; object-fit: contain; }
      .trace { display: grid; gap: 2px; margin-top: 14px; padding-top: 8px; border-top: 1px solid var(--line); color: var(--muted); font-size: 7.5px; }
    </style>
  </head>
  <body>
    <main class="quote quote-${esc(template.companyId)}">
      <header class="quote-header">
        <section class="brand">
          ${input.logoUrl ? `<img class="brand-logo" src="${esc(input.logoUrl)}" alt="${esc(companyName)}" />` : ""}
          <div><h1>${esc(companyName)}</h1><p>RFC: ${esc(companyRfc)}</p></div>
        </section>
        <section class="quote-title">
          <p class="eyebrow">Cotización</p>
          <h2>${esc(input.folio)}</h2>
          <dl><div><dt>Fecha</dt><dd>${esc(input.fecha)}</dd></div><div><dt>Vigencia</dt><dd>${esc(input.vigencia)}</dd></div></dl>
        </section>
      </header>
      <section class="party-grid">
        <div><h3>Cliente</h3><p class="strong">${esc(input.cliente.nombre)}</p><p>RFC: ${esc(input.cliente.rfc)}</p></div>
        <div><h3>Contacto</h3><p>${esc(input.cliente.contacto || "")}</p></div>
        <div><h3>Referencia / OC</h3><p>${esc(input.referenciaOc || "")}</p></div>
      </section>
      <table class="items"><thead><tr><th>Cant.</th><th>Unidad</th><th>Descripción</th><th>Clave</th><th class="money">P. unitario</th><th class="money">Importe</th></tr></thead><tbody>${items}</tbody></table>
      <section class="totals"><dl><div><dt>Subtotal</dt><dd>${money(input.subtotal)}</dd></div><div><dt>IVA</dt><dd>${money(input.iva)}</dd></div><div class="grand-total"><dt>Total</dt><dd>${money(input.total)}</dd></div></dl></section>
      <section class="payment-grid">
        <div><h3>Datos bancarios</h3><p>${esc(input.bankName || "")}</p><p>Cuenta: ${esc(input.bankAccount || "")}</p><p>CLABE: ${esc(input.bankClabe || "")}</p></div>
        <div><h3>Condiciones</h3><p>${esc(input.terms || "")}</p></div>
        <div class="qr-box">${input.qr ? `<img src="${esc(input.qr)}" alt="QR de trazabilidad" />` : ""}</div>
      </section>
      <footer class="trace">
        <span>quotationId: ${esc(input.quotationId || "")}</span>
        <span>solicitudId: ${esc(input.solicitudId || "")}</span>
        <span>materialidadId: ${esc(input.materialidadId || "")}</span>
        <span>purchaseOrderId: ${esc(input.purchaseOrderId || "")}</span>
        <span>cfdiUuid: ${esc(input.cfdiUuid || "")}</span>
      </footer>
    </main>
  </body>
</html>`;

  return {
    html,
    template,
    materialitySnapshot: {
      ...buildCotizacionMaterialityTemplateSnapshot(template),
      generatedDocumentSha256: "",
      quotationId: input.quotationId || "",
      solicitudId: input.solicitudId || "",
      materialidadId: input.materialidadId || "",
      purchaseOrderId: input.purchaseOrderId || "",
      cfdiUuid: input.cfdiUuid || "",
    },
  };
}
