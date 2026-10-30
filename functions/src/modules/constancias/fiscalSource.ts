/** Delivery receipts take fiscal classification from the invoice XML, never the OC. */
export function requireDeliveryFiscalItems(solicitud: Record<string, any>) {
  const items = Array.isArray(solicitud.facturaFiscalItems) ? solicitud.facturaFiscalItems : [];
  if (!solicitud.facturaFiscalXmlUploadId || !items.length || items.some((item: any) =>
    !/^\d{8}$/.test(String(item.productCode || "").trim()) || !String(item.unit || "").trim() ||
    !String(item.description || "").trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
    throw Error("CONSTANCIA_XML_FISCAL_ITEMS_REQUIRED");
  }
  return items;
}
