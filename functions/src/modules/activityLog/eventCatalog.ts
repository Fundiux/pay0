export type ActivityEventSeverity = "info" | "success" | "warning" | "danger";

export type ActivityEventCategory =
  | "auth"
  | "business"
  | "catalog"
  | "config"
  | "document"
  | "financial"
  | "maintenance"
  | "repair"
  | "system"
  | "telegram";

export type ActivityEventModule =
  | "activityLog"
  | "auth"
  | "beneficiarios"
  | "catalogos"
  | "clientes"
  | "costos"
  | "despachos"
  | "dispersiones"
  | "docs"
  | "empresas"
  | "facturacion"
  | "agente007"
  | "mantenimiento"
  | "iq"
  | "pagos"
  | "solicitudes"
  | "system"
  | "telegram"
  | "usuarios"
  | "wallet";

export type ActivityEventCatalogEntry = {
  key: string;
  label: string;
  module: ActivityEventModule;
  category: ActivityEventCategory;
  severity: ActivityEventSeverity;
  selectable?: boolean;
};

function eventEntry(
  key: string,
  label: string,
  module: ActivityEventModule,
  category: ActivityEventCategory,
  severity: ActivityEventSeverity = "info",
  selectable = true,
): ActivityEventCatalogEntry {
  return {
    key,
    label,
    module,
    category,
    severity,
    selectable,
  };
}

export const ACTIVITY_EVENT_CATALOG: Record<string, ActivityEventCatalogEntry> = {
  SOLICITUD_CREADA: eventEntry("SOLICITUD_CREADA", "Solicitud creada", "solicitudes", "business", "success"),
  SOLICITUD_CANCELADA: eventEntry("SOLICITUD_CANCELADA", "Solicitud cancelada", "solicitudes", "business", "warning"),
  SOLICITUD_COMPLETADA: eventEntry("SOLICITUD_COMPLETADA", "Solicitud completada", "solicitudes", "business", "success"),
  SOLICITUD_RECHAZADA: eventEntry("SOLICITUD_RECHAZADA", "Solicitud rechazada", "solicitudes", "business", "warning"),
  SOLICITUD_STATUS_ACTUALIZADO: eventEntry("SOLICITUD_STATUS_ACTUALIZADO", "Estatus de solicitud actualizado", "solicitudes", "business"),
  SOLICITUD_EN_CONCILIACION: eventEntry("SOLICITUD_EN_CONCILIACION", "Solicitud en conciliacion", "solicitudes", "business"),
  SOLICITUD_EN_SUSTITUCION: eventEntry("SOLICITUD_EN_SUSTITUCION", "Solicitud en sustitucion", "solicitudes", "business"),
  SOLICITUD_SUSTITUCION_ACTUALIZADA: eventEntry("SOLICITUD_SUSTITUCION_ACTUALIZADA", "Sustitucion actualizada", "solicitudes", "business"),
  SOLICITUD_ELIMINADA: eventEntry("SOLICITUD_ELIMINADA", "Solicitud eliminada", "solicitudes", "business", "warning"),

  IQ_SOLICITUD_CREACION_INICIADA: eventEntry("IQ_SOLICITUD_CREACION_INICIADA", "Creacion IQ iniciada", "iq", "system"),
  IQ_SOLICITUD_CREACION_EXITOSA: eventEntry("IQ_SOLICITUD_CREACION_EXITOSA", "Solicitud creada en IQ", "iq", "business", "success"),
  IQ_SOLICITUD_CREACION_FALLIDA: eventEntry("IQ_SOLICITUD_CREACION_FALLIDA", "Creacion IQ fallida", "iq", "system", "danger"),
  IQ_SOLICITUD_RESULTADO_INCIERTO: eventEntry("IQ_SOLICITUD_RESULTADO_INCIERTO", "Resultado IQ incierto", "iq", "system", "warning"),
  IQ_SOLICITUD_CREACION_REUTILIZADA: eventEntry("IQ_SOLICITUD_CREACION_REUTILIZADA", "Solicitud IQ ya creada", "iq", "system"),
  IQ_SOLICITUD_CONCILIADA: eventEntry("IQ_SOLICITUD_CONCILIADA", "Solicitud IQ conciliada", "iq", "business", "success"),
  IQ_CALENDARIO_ACTUALIZADO: eventEntry("IQ_CALENDARIO_ACTUALIZADO", "Calendario IQ actualizado", "iq", "config", "success"),
  IQ_SOLICITUD_ENCOLADA: eventEntry("IQ_SOLICITUD_ENCOLADA", "Solicitud encolada para envio automatico", "iq", "system"),
  IQ_SOLICITUD_COLA_REUTILIZADA: eventEntry("IQ_SOLICITUD_COLA_REUTILIZADA", "Solicitud ya estaba en cola", "iq", "system"),
  IQ_CREATE_QUEUE_PROCESSED: eventEntry("IQ_CREATE_QUEUE_PROCESSED", "Cola IQ procesada", "iq", "system", "success"),
  IQ_SOLICITUD_RECHAZADA: eventEntry("IQ_SOLICITUD_RECHAZADA", "Solicitud IQ rechazada", "iq", "business", "warning"),
  IQ_PAGO_CREADO: eventEntry("IQ_PAGO_CREADO", "Pago IQ creado", "iq", "financial", "success"),
  IQ_PAGO_VINCULADO: eventEntry("IQ_PAGO_VINCULADO", "Pago IQ vinculado", "iq", "financial", "success"),
  IQ_PAGO_CONCILIADO: eventEntry("IQ_PAGO_CONCILIADO", "Pago IQ conciliado", "iq", "financial", "success"),
  IQ_PAGO_ERROR: eventEntry("IQ_PAGO_ERROR", "Error pago IQ", "iq", "system", "danger"),
  IQ_PAGO_REQUIERE_REVISION: eventEntry("IQ_PAGO_REQUIERE_REVISION", "Pago IQ requiere revision", "iq", "system", "warning"),
  IQ_JOB_OMITIDO: eventEntry("IQ_JOB_OMITIDO", "Seguimiento IQ omitido", "iq", "system", "warning"),

  PAGO_CREADO: eventEntry("PAGO_CREADO", "Pago creado", "pagos", "financial", "success"),
  PAGO_STATUS_ACTUALIZADO: eventEntry("PAGO_STATUS_ACTUALIZADO", "Estatus de pago actualizado", "pagos", "financial"),
  PAGO_APLICADO_A_SOLICITUD: eventEntry("PAGO_APLICADO_A_SOLICITUD", "Pago aplicado a solicitud", "pagos", "financial", "success"),
  PAGO_FINANCIAL_POSTED: eventEntry("PAGO_FINANCIAL_POSTED", "Pago posteado financieramente", "pagos", "financial", "success"),
  PAGO_POSTEO_FINANCIERO_PENDIENTE: eventEntry("PAGO_POSTEO_FINANCIERO_PENDIENTE", "Posteo financiero pendiente", "pagos", "financial", "warning"),
  ABONO_REGISTRADO: eventEntry("ABONO_REGISTRADO", "Abono registrado", "pagos", "financial", "success"),
  ABONO: eventEntry("ABONO", "Abono", "pagos", "financial", "success", false),

  ADELANTO_OTORGADO: eventEntry("ADELANTO_OTORGADO", "Adelanto otorgado", "wallet", "financial", "success"),
  ADELANTO_LIQUIDADO: eventEntry("ADELANTO_LIQUIDADO", "Adelanto liquidado", "wallet", "financial", "success"),
  ADELANTO_CANCELADO: eventEntry("ADELANTO_CANCELADO", "Adelanto cancelado", "wallet", "financial", "warning"),
  ADELANTO_CORREGIDO: eventEntry("ADELANTO_CORREGIDO", "Adelanto corregido", "wallet", "financial", "warning"),

  AJUSTE_MANUAL_APLICADO: eventEntry("AJUSTE_MANUAL_APLICADO", "Ajuste manual aplicado", "wallet", "financial", "warning"),

  DISPERSION_REGISTRADA: eventEntry("DISPERSION_REGISTRADA", "Dispersion registrada", "dispersiones", "financial", "success"),
  DISPERSION_INCIDENCIA_ABIERTA: eventEntry("DISPERSION_INCIDENCIA_ABIERTA", "Incidencia de dispersion abierta", "dispersiones", "business", "warning"),
  DISPERSION_INCIDENCIA_SOLICITADA: eventEntry("DISPERSION_INCIDENCIA_SOLICITADA", "Incidencia de dispersion solicitada", "dispersiones", "business", "warning"),
  DISPERSION_INCIDENCIA_RESUELTA: eventEntry("DISPERSION_INCIDENCIA_RESUELTA", "Incidencia de dispersion resuelta", "dispersiones", "business", "success"),
  DISPERSION_REINTEGRADA: eventEntry("DISPERSION_REINTEGRADA", "Dispersion reintegrada", "dispersiones", "financial", "success"),

  DOCUMENTO_SOLICITUD_SUBIDO: eventEntry("DOCUMENTO_SOLICITUD_SUBIDO", "Documento de solicitud subido", "docs", "document", "success"),
  DOCUMENTO_SOLICITUD_DESACTIVADO: eventEntry("DOCUMENTO_SOLICITUD_DESACTIVADO", "Documento de solicitud desactivado", "docs", "document", "warning"),
  DOCUMENTO_DISPERSION_SUBIDO: eventEntry("DOCUMENTO_DISPERSION_SUBIDO", "Comprobante de dispersion subido", "docs", "document", "success"),
  DOCUMENTO_DISPERSION_DESACTIVADO: eventEntry("DOCUMENTO_DISPERSION_DESACTIVADO", "Comprobante de dispersion desactivado", "docs", "document", "warning"),

  BENEFICIARIO_CREADO: eventEntry("BENEFICIARIO_CREADO", "Beneficiario creado", "beneficiarios", "business", "success"),
  BENEFICIARIO_METODO_CREADO: eventEntry("BENEFICIARIO_METODO_CREADO", "Metodo de beneficiario creado", "beneficiarios", "business", "success"),
  BENEFICIARIO_METODO_REEMPLAZADO: eventEntry("BENEFICIARIO_METODO_REEMPLAZADO", "Metodo de beneficiario reemplazado", "beneficiarios", "business", "warning"),

  CLIENT_CREATE: eventEntry("CLIENT_CREATE", "Cliente creado", "clientes", "business", "success"),
  CLIENT_UPDATE: eventEntry("CLIENT_UPDATE", "Cliente actualizado", "clientes", "business"),
  CLIENT_TOGGLE: eventEntry("CLIENT_TOGGLE", "Cliente activado o desactivado", "clientes", "business", "warning"),
  CLIENT_REPAIR_NUMBERS: eventEntry("CLIENT_REPAIR_NUMBERS", "Numeracion de clientes reparada", "clientes", "repair", "warning"),

  COMPANY_CREATE: eventEntry("COMPANY_CREATE", "Empresa creada", "empresas", "business", "success"),
  COMPANY_TOGGLE: eventEntry("COMPANY_TOGGLE", "Empresa activada o desactivada", "empresas", "business", "warning"),
  FACTURA_BORRADOR_CREADO: eventEntry("FACTURA_BORRADOR_CREADO", "Borrador CFDI creado", "facturacion", "financial", "success"),
  AGENTE_007_OBSERVACION: eventEntry("AGENTE_007_OBSERVACION", "Observación registrada por Hugo", "agente007", "business", "success"),

  DESPACHO_CREATE: eventEntry("DESPACHO_CREATE", "Despacho creado", "despachos", "business", "success"),
  DESPACHO_UPDATE: eventEntry("DESPACHO_UPDATE", "Despacho actualizado", "despachos", "business"),

  OPERATION_TYPE_CREATED: eventEntry("OPERATION_TYPE_CREATED", "Tipo de operacion creado", "catalogos", "catalog", "success"),
  DESPACHO_OPERATION_COST_SET: eventEntry("DESPACHO_OPERATION_COST_SET", "Costo despacho configurado", "costos", "config", "success"),
  USER_OPERATION_COST_SET: eventEntry("USER_OPERATION_COST_SET", "Costo usuario configurado", "costos", "config", "success"),
  COSTO_CLIENTE_CONFIGURADO: eventEntry("COSTO_CLIENTE_CONFIGURADO", "Costo cliente configurado", "costos", "config", "success"),

  LOGIN: eventEntry("LOGIN", "Inicio de sesion", "auth", "auth", "success"),
  LOGOUT: eventEntry("LOGOUT", "Cierre de sesion", "auth", "auth"),
  UNAUTHORIZED_ROUTE_ATTEMPT: eventEntry("UNAUTHORIZED_ROUTE_ATTEMPT", "Intento de acceso no autorizado", "system", "auth", "warning"),

  TELEGRAM_CUENTA_VINCULADA: eventEntry("TELEGRAM_CUENTA_VINCULADA", "Cuenta Telegram vinculada", "telegram", "telegram", "success"),
  TELEGRAM_CUENTA_DESVINCULADA: eventEntry("TELEGRAM_CUENTA_DESVINCULADA", "Cuenta Telegram desvinculada", "telegram", "telegram", "warning"),
  CLIENTE_TELEGRAM_VINCULADO: eventEntry("CLIENTE_TELEGRAM_VINCULADO", "Telegram cliente vinculado", "telegram", "telegram", "success"),
  CLIENTE_TELEGRAM_DESVINCULADO: eventEntry("CLIENTE_TELEGRAM_DESVINCULADO", "Telegram cliente desvinculado", "telegram", "telegram", "warning"),
  TELEGRAM_FACTURA_CLIENTE_ENVIADA: eventEntry("TELEGRAM_FACTURA_CLIENTE_ENVIADA", "Factura cliente enviada por Telegram", "telegram", "telegram", "success"),
  TELEGRAM_COMPROBANTE_DISPERSION_CLIENTE_ENVIADO: eventEntry("TELEGRAM_COMPROBANTE_DISPERSION_CLIENTE_ENVIADO", "Comprobante dispersion enviado por Telegram", "telegram", "telegram", "success"),

  WEB_MAINTENANCE_ON: eventEntry("WEB_MAINTENANCE_ON", "Modo mantenimiento activado", "mantenimiento", "maintenance", "warning"),
  WEB_MAINTENANCE_OFF: eventEntry("WEB_MAINTENANCE_OFF", "Modo mantenimiento desactivado", "mantenimiento", "maintenance", "success"),

  USER_NUMBERS_REPAIRED: eventEntry("USER_NUMBERS_REPAIRED", "Numeros usuario reparados", "usuarios", "repair", "warning"),

  IQ_FACTURA_DISPONIBLE: eventEntry("IQ_FACTURA_DISPONIBLE", "Factura externa disponible", "iq", "system", "info", false),
  IQ_FACTURA_ZIP_DESCARGADA: eventEntry("IQ_FACTURA_ZIP_DESCARGADA", "ZIP factura externa descargado", "iq", "system", "success", false),
  IQ_FACTURA_IMPORTADA: eventEntry("IQ_FACTURA_IMPORTADA", "Factura externa importada", "iq", "system", "success", false),
  FACTURA_CLIENTE_DISPONIBLE: eventEntry("FACTURA_CLIENTE_DISPONIBLE", "Factura cliente disponible", "telegram", "telegram", "info", false),
  COMPROBANTE_DISPERSION_CLIENTE: eventEntry("COMPROBANTE_DISPERSION_CLIENTE", "Comprobante dispersion cliente", "telegram", "telegram", "info", false),
};

export const ACTIVITY_EVENT_SELECT_KEYS = Object.keys(ACTIVITY_EVENT_CATALOG)
  .filter((key) => ACTIVITY_EVENT_CATALOG[key]?.selectable !== false)
  .sort();

export const ACTIVITY_EVENT_LABELS = Object.keys(ACTIVITY_EVENT_CATALOG).reduce<Record<string, string>>(
  (acc, key) => {
    acc[key] = ACTIVITY_EVENT_CATALOG[key].label;
    return acc;
  },
  {},
);

const ACRONYMS: Record<string, string> = {
  CFDI: "CFDI",
  PDF: "PDF",
  PPD: "PPD",
  PUE: "PUE",
  SAT: "SAT",
  UUID: "UUID",
  XML: "XML",
};

export function normalizeActivityEventKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}

export function humanizeActivityEventKey(value: unknown): string {
  const key = normalizeActivityEventKey(value);
  if (!key) return "---";

  return key
    .split("_")
    .filter(Boolean)
    .map((part) => {
      if (ACRONYMS[part]) return ACRONYMS[part];
      const lower = part.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function getActivityEventMeta(value: unknown): ActivityEventCatalogEntry {
  const key = normalizeActivityEventKey(value);
  const known = ACTIVITY_EVENT_CATALOG[key];

  if (known) return known;

  return {
    key,
    label: humanizeActivityEventKey(key),
    module: "activityLog",
    category: "system",
    severity: "info",
    selectable: false,
  };
}

export function getActivityEventLabel(value: unknown): string {
  const key = normalizeActivityEventKey(value);
  if (!key) return "---";
  return ACTIVITY_EVENT_CATALOG[key]?.label || humanizeActivityEventKey(key);
}
