export const HUGO_ERROR_CATEGORIES = [
  "PERMISSION_DENIED", "CAPABILITY_NOT_AVAILABLE", "AMBIGUOUS_INTENT", "ENTITY_NOT_FOUND",
  "EMPTY_RESULT", "PARTIAL_RESULT", "TIMEOUT", "CONNECTOR_ERROR", "INTERNAL",
] as const;

export type HugoErrorCategory = typeof HUGO_ERROR_CATEGORIES[number];

export const MOVEMENT_CLARIFICATION = "¿Te refieres al último pago, solicitud, dispersión o actividad operativa?";

const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function isAmbiguousLatestMovement(message: string) {
  const value = plain(message);
  return /\b(ultimo|reciente)\s+(movimiento|actividad)\b/.test(value)
    && !/\b(pago|solicitud|dispersion|actividad\s+operativa)\b/.test(value.replace(/\b(ultimo|reciente)\s+/, ""));
}

export function normalizePay0Brand(text: string) {
  return text.replace(/\b(?:pay\s*zero|pay\s*cero|pay0)\b/gi, "PAY0");
}

export function receiptReadingLocationReply(message: string): string | null {
  const value = plain(message);
  if (!/\b(comprobante|recibo)s?\b/.test(value)) return null;
  if (!/\b(donde|como|puedes|puedo)\b/.test(value) || !/\b(leer|lees|lectura|analizar|analizas|subir|adjuntar|cargar)\b/.test(value)) return null;
  return "En PAY0 abre /hugo y busca «Revisar un comprobante con María». Selecciona un PDF o imagen de hasta 1 MB y pulsa «Analizar comprobante». Ahí puedes revisar la lectura, editar un campo y volver a analizar para comprobar tu corrección. El acceso depende de tu sesión autorizada; el análisis no registra un pago.";
}

export function formatLatestSolicitud(data: any) {
  return data?.item ? formatSolicitudDetails(data.item, true) : "No hay solicitudes visibles dentro de tu alcance autorizado.";
}

export function formatSolicitudDetails(item: any, latest = false) {
  const client = typeof item?.cliente === "string" && item.cliente.trim() ? item.cliente.trim() : "nombre de cliente no disponible en la evidencia autorizada";
  const method = item?.metodoPago === "PPD" || item?.metodoPago === "PUE" ? item.metodoPago : "no registrado como PPD/PUE";
  const amount = formatRecordedAmount(item?.monto, item?.moneda);
  return `${latest ? "La solicitud más reciente visible" : "La solicitud consultada"} corresponde a ${client}. Método de pago: ${method}. Monto: ${amount}.${item?.folio ? ` Folio: ${item.folio}.` : ""}`;
}

export function formatRecordedAmount(raw: unknown, currencyValue: unknown): string {
  const validAmount = (typeof raw === "number" || typeof raw === "string" && raw.trim() !== "") && Number.isFinite(Number(raw));
  const currency = typeof currencyValue === "string" && /^[A-Z]{3}$/.test(currencyValue) ? currencyValue : "MXN";
  let amount = "no registrado";
  if (validAmount) {
    try { amount = Number(raw).toLocaleString("es-MX", {style:"currency", currency}); }
    catch { amount = `${Number(raw).toLocaleString("es-MX")} ${currency}`; }
  }
  return amount;
}

export function formatPaymentClients(rows: any[]): string {
  const names = [...new Set(rows.map(row => typeof row?.cliente === "string" ? row.cliente.trim() : "").filter(Boolean))];
  if (!names.length) return "No tengo un nombre de cliente verificado para ese pago en la evidencia autorizada. Un banco o un remitente detectado en el comprobante no identifica al cliente.";
  return `${names.length === 1 ? "El cliente asociado es" : "Los clientes asociados a los pagos consultados son"} ${names.join(", ")}.${rows.some(row => !row?.cliente) ? " Hay pagos consultados sin nombre de cliente verificado." : ""}`;
}

export function formatSystemCatalog(rowsValue: any, message = "") {
  const rows = Array.isArray(rowsValue) ? rowsValue : [];
  if (/\bassets\b/i.test(message)) {
    const assets = rows.find((row: any) => row.id === "ASSETS");
    if (!assets) return "ASSETS no está registrado en el catálogo canónico actual.";
    if (assets.status !== "CONNECTED") return `ASSETS está registrado con estado ${assets.status}; no hay un conector activo para consultar sus datos${assets.allowed ? "" : " y tu sesión tampoco tiene acceso permitido"}.`;
    return assets.allowed ? "ASSETS está conectado y permitido para tu sesión." : "ASSETS está conectado, pero tu sesión no tiene acceso permitido.";
  }
  const apart = rows.filter((row: any) => row.id !== "HUGO");
  return `Hay ${rows.length} sistemas registrados, incluido HUGO: ${rows.map((row: any) => `${row.id} (${row.status}${row.allowed ? "" : ", sin acceso"})`).join(", ")}. Aparte de HUGO son ${apart.length}: ${apart.map((row: any) => row.id).join(", ")}.`;
}

export function formatAuthorizedCapabilities(data: any, diagnostic?: any) {
  const modules = Object.entries(data?.modules || {}).filter(([, actions]: any) => actions?.view === true).map(([key]) => key);
  const diagnosis = diagnostic?.status === "ERROR" && diagnostic?.errorCategory === "PERMISSION_DENIED"
    ? " La última operación sí fue denegada por autorización backend."
    : diagnostic?.status === "ERROR"
      ? ` La última operación falló por ${diagnostic.errorCategory || "INTERNAL"}, no por una denegación de permisos demostrada.`
      : " No hay una denegación backend reciente que demuestre falta de permisos.";
  const readScope = data?.role === "superadmin" ? " Como superadmin puedes consultar toda la información PAY0 dentro del root administrado, sin asignación personal ni delegación; esto no autoriza escrituras, ejecuciones financieras ni otros sistemas." : " Tus lecturas conservan los filtros de módulo, asignación y delegación aplicables a tu rol.";
  return `Tu rol efectivo es ${data?.role || "desconocido"} dentro de la raíz actual. Tu acceso incluye: ${modules.length ? modules.join(", ") : "ningún módulo operativo"}.${readScope} Que una herramienta no exista o un alias no coincida no demuestra una falta de permiso.${diagnosis}`;
}

export function canonicalErrorCategory(error: unknown): HugoErrorCategory {
  const raw = `${(error as any)?.code || ""} ${(error as any)?.message || error || ""}`.toUpperCase().replace(/[-/]/g, "_");
  if (/PERMISSION|UNAUTHORIZED|FORBIDDEN/.test(raw)) return "PERMISSION_DENIED";
  if (/NOT_ALLOWED|CAPABILITY|UNKNOWN_TOOL/.test(raw)) return "CAPABILITY_NOT_AVAILABLE";
  if (/AMBIGUOUS/.test(raw)) return "AMBIGUOUS_INTENT";
  if (/NOT_FOUND/.test(raw)) return "ENTITY_NOT_FOUND";
  if (/EMPTY/.test(raw)) return "EMPTY_RESULT";
  if (/PARTIAL/.test(raw)) return "PARTIAL_RESULT";
  if (/TIMEOUT|DEADLINE/.test(raw)) return "TIMEOUT";
  if (/UNAVAILABLE|CONNECTOR/.test(raw)) return "CONNECTOR_ERROR";
  return "INTERNAL";
}
