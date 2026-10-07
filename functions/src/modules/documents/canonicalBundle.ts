import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";

export type CanonicalDocumentUse = "COTIZACION" | "CONSTANCIA_ENTREGA_BIENES" | "CONSTANCIA_SERVICIO";
const assets = resolve(__dirname, "../../assets");
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
export const CONSTANCIA_RENDER_VERSION = "1.2";

export function canonicalCompanyCatalog(): Array<{ companyId: string; companyName: string; rfc: string }> {
  const manifest = JSON.parse(readFileSync(resolve(assets, "cotizaciones-manifest.json"), "utf8"));
  return (manifest.templates || []).map(({ companyId, companyName, rfc }: any) => ({ companyId, companyName, rfc }));
}

export function loadCanonicalBundle(rfc: string, use: CanonicalDocumentUse) {
  if (!/^[A-ZÑ&0-9]{12,13}$/.test(rfc)) throw Error("CANONICAL_COMPANY_INVALID");
  const quotation = JSON.parse(readFileSync(resolve(assets, "cotizaciones-manifest.json"), "utf8"));
  const company = quotation.templates.find((row: any) => row.rfc === rfc && row.status === "ACTIVE");
  if (!company) throw Error("CANONICAL_COMPANY_TEMPLATE_MISSING");
  const kind = use === "CONSTANCIA_ENTREGA_BIENES" ? "constancia-entrega" : "constancia-servicio";
  const folder = use === "COTIZACION" ? resolve(assets, "cotizaciones/templates/base") : resolve(assets, "constancias", rfc, kind);
  const manifest = use === "COTIZACION" ? company : JSON.parse(readFileSync(resolve(folder, "manifest.json"), "utf8"));
  let html = readFileSync(resolve(folder, "template.html"), "utf8");
  let css = readFileSync(resolve(folder, "template.css"), "utf8");
  const logo = readFileSync(resolve(assets, "companies", `${rfc}.png`));
  if (use === "COTIZACION") {
    // This company identity was extracted from its quotation reference and is
    // already part of the published company package; do not invent a palette.
    const identity = JSON.parse(readFileSync(resolve(assets, "constancias", rfc, "constancia-servicio", "manifest.json"), "utf8"));
    const accent = String(identity.styleRules?.accentColor || "");
    if (!/^#[a-f0-9]{6}$/i.test(accent)) throw Error("CANONICAL_COMPANY_IDENTITY_MISSING");
    css += `\n:root{--accent:${accent}}`;
  }
  if (use !== "COTIZACION") {
    // Version 1.2 is a deterministic, versioned projection of the preserved
    // company-specific v1.1 bundle. Never edit an issued reference or old file.
    html = html.replace(/<section class="sign">[\s\S]*?<\/section>/, '<section class="sign"><div><b>RECIBE / ACEPTA</b><br>{{receptorNombre}}<br>{{receptorCargo}}<div class="signature-image">{{firmaReceptor}}</div><hr>Firma de la persona receptora</div></section>')
      .replace('<h2>EVIDENCIA Y ACEPTACIÓN</h2>', '<h2>LUGAR DECLARADO DE RECEPCIÓN / PRESTACIÓN</h2><div class="location"><b>{{receiptLocation}}</b><br>{{receiptAddress}}</div><h2>EVIDENCIA Y ACEPTACIÓN</h2>')
      .replace('<section class="sign">', '<p class="acceptance">{{acceptanceText}}</p><section class="sign">')
      .replace('Hash expediente:', 'Hash de la firma:')
      .replace('Plantilla canónica v1.1', `Plantilla canónica v${CONSTANCIA_RENDER_VERSION}`);
    css += '\n.sign{grid-template-columns:1fr;width:65%;margin:12px auto 0}.signature-image{height:55px;margin:6px}.signature-image img{max-width:220px;max-height:55px}.location{border:1px solid #ccc;padding:8px;overflow-wrap:anywhere}.acceptance{line-height:1.5}.qr img{width:70px;height:70px}.evidence{break-inside:avoid;overflow-wrap:anywhere}.grid>div{overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}.sign{break-inside:avoid}footer{position:static;margin-top:16px}';
  }
  const reference = readFileSync(use === "COTIZACION"
    ? resolve(assets, "cotizaciones", company.referencePdf) : resolve(folder, "reference.pdf"));
  const snapshot = {
    templateId: use === "COTIZACION" ? company.templateId : String(manifest.templateId).replace(/v1\.1$/, `v${CONSTANCIA_RENDER_VERSION}`),
    templateVersion: use === "COTIZACION" ? company.version : CONSTANCIA_RENDER_VERSION,
    companyId: company.companyId, companyRfc: rfc, companyName: company.companyName,
    referencePdfSha256: digest(reference), templateBundleSha256: digest(Buffer.concat([Buffer.from(html), Buffer.from(css), logo])),
    templateEngine: "PAY0_CANONICAL_HTML_CSS_PRINT_V2", documentUse: use,
  };
  return { html, css, logo, reference, snapshot };
}
