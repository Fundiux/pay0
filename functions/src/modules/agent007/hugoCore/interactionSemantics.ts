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

export function formatLatestSolicitud(data: any) {
  return data?.item?.cliente
    ? `El cliente asociado a la solicitud más reciente visible es ${data.item.cliente}.`
    : "No hay solicitudes visibles dentro de tu alcance autorizado.";
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
