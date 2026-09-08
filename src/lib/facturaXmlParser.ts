export type FacturaXmlTipoFactura = "PUE" | "PPD" | "";

export interface ParsedFacturaXml {
  ok: boolean;
  sourceFileName: string;
  version: string;
  serie: string;
  folio: string;
  fecha: string;
  uuid: string;
  tipoComprobante: string;
  clienteNombre: string;
  proveedorNombre: string;
  rfcReceptor: string;
  rfcEmisor: string;
  metodoPago: string;
  tipoFactura: FacturaXmlTipoFactura;
  moneda: string;
  formaPago: string;
  usoCfdi: string;
  subtotal: number;
  iva: number;
  total: number;
  montoSolicitud: number;
  conceptoPrincipal: string;
  referencia: string;
  operationTypeName: "Factura subtotal";
  warnings: string[];
}

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }

  const raw = String(value || "").trim();
  if (!raw) return 0;

  const clean = raw.replace(/[^0-9,.-]/g, "");
  if (!clean) return 0;

  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");

  const normalized =
    comma > dot
      ? clean.replace(/\./g, "").replace(",", ".")
      : clean.replace(/,/g, "");

  const n = Number(normalized);
  if (!Number.isFinite(n)) return 0;

  return Math.round(n * 100) / 100;
}

function attr(node: Element | null | undefined, name: string) {
  if (!node) return "";
  return cleanText(node.getAttribute(name) || node.getAttribute(name.toLowerCase()) || "");
}

function firstByLocalName(doc: Document | Element, localName: string): Element | null {
  const direct = Array.from(doc.getElementsByTagName(localName || ""));
  if (direct.length > 0) return direct[0] as Element;

  const all = Array.from(doc.getElementsByTagName("*"));
  return (all.find((node) => node.localName === localName) as Element | undefined) || null;
}

function allByLocalName(doc: Document | Element, localName: string): Element[] {
  const direct = Array.from(doc.getElementsByTagName(localName || "")) as Element[];
  if (direct.length > 0) return direct;

  return Array.from(doc.getElementsByTagName("*")).filter((node) => node.localName === localName) as Element[];
}

function detectTipoFactura(metodoPago: string): FacturaXmlTipoFactura {
  const value = cleanText(metodoPago).toUpperCase();

  if (value === "PPD" || value.includes("PPD")) return "PPD";
  if (value === "PUE" || value.includes("PUE")) return "PUE";

  return "";
}

function getRootElement(doc: Document): Element {
  const root = doc.documentElement;
  if (!root || root.localName !== "Comprobante") {
    throw new Error("XML invalido: no es un CFDI Comprobante.");
  }

  return root;
}

function getParserError(doc: Document) {
  const parserError = doc.getElementsByTagName("parsererror")?.[0];
  return parserError ? cleanText(parserError.textContent || "") : "";
}

export function parseFacturaXmlText(xmlText: string, sourceFileName = "factura.xml"): ParsedFacturaXml {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const parserError = getParserError(doc);

  if (parserError) {
    throw new Error("XML invalido o ilegible.");
  }

  const root = getRootElement(doc);
  const emisor = firstByLocalName(doc, "Emisor");
  const receptor = firstByLocalName(doc, "Receptor");
  const timbre = firstByLocalName(doc, "TimbreFiscalDigital");

  const concepto = firstByLocalName(doc, "Concepto");
  const impuestosRoot = Array.from(root.children).find((node) => node.localName === "Impuestos") as Element | undefined;

  const version = attr(root, "Version");
  const serie = attr(root, "Serie");
  const folio = attr(root, "Folio");
  const fecha = attr(root, "Fecha");
  const subtotal = toNumber(attr(root, "SubTotal"));
  const total = toNumber(attr(root, "Total"));
  const moneda = attr(root, "Moneda");
  const formaPago = attr(root, "FormaPago");
  const metodoPago = attr(root, "MetodoPago");
  const tipoComprobante = attr(root, "TipoDeComprobante").toUpperCase();

  const iva =
    toNumber(attr(impuestosRoot, "TotalImpuestosTrasladados")) ||
    allByLocalName(doc, "Traslado").reduce((sum, node) => sum + toNumber(attr(node, "Importe")), 0);

  const tipoFactura = detectTipoFactura(metodoPago);

  const rfcEmisor = attr(emisor, "Rfc").toUpperCase();
  const rfcReceptor = attr(receptor, "Rfc").toUpperCase();
  const proveedorNombre = attr(emisor, "Nombre");
  const clienteNombre = attr(receptor, "Nombre");
  const uuid = attr(timbre, "UUID");
  const usoCfdi = attr(receptor, "UsoCFDI");
  const conceptoPrincipal = attr(concepto, "Descripcion");

  const warnings: string[] = [];

  if (tipoComprobante !== "I") warnings.push("XML no es factura de ingreso.");
  if (!clienteNombre) warnings.push("Cliente receptor no detectado.");
  if (!proveedorNombre) warnings.push("Empresa emisora no detectada.");
  if (!total) warnings.push("Total XML no detectado.");
  if (!tipoFactura) warnings.push("Tipo factura PUE/PPD no detectado.");
  if (!uuid) warnings.push("UUID no detectado.");

  const montoSolicitud = tipoComprobante === "I" ? total : 0;

  return {
    ok: warnings.length === 0,
    sourceFileName,
    version,
    serie,
    folio,
    fecha,
    uuid,
    tipoComprobante,
    clienteNombre,
    proveedorNombre,
    rfcReceptor,
    rfcEmisor,
    metodoPago,
    tipoFactura,
    moneda,
    formaPago,
    usoCfdi,
    subtotal,
    iva: Math.round(iva * 100) / 100,
    total,
    montoSolicitud,
    conceptoPrincipal,
    referencia: [
      sourceFileName,
      uuid ? `UUID ${uuid}` : "",
      rfcReceptor ? `RFC receptor ${rfcReceptor}` : "",
      rfcEmisor ? `RFC emisor ${rfcEmisor}` : "",
      total ? `Total XML ${total}` : "",
    ].filter(Boolean).join(" | "),
    operationTypeName: "Factura subtotal",
    warnings,
  };
}

export async function parseFacturaXmlFile(file: File): Promise<ParsedFacturaXml> {
  const text = await file.text();
  return parseFacturaXmlText(text, file.name);
}