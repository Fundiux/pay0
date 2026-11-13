// Pure rules for automatic WhatsApp delivery of client documents through Hugo's connector.
// No Firestore, Storage or network here so every rule is unit-testable.
import { isWithinWorkingHours, OWNER_WORKING_HOURS } from "../whatsappAutoReply/domain";

/** The only agent whose enrolled connector may send documents to clients. */
export const DOCUMENT_SENDER_AGENT_ID = "hugo";

// ---------------------------------------------------------------------------
// Source types: the single extensible list. Add a new client document here.
// ---------------------------------------------------------------------------

export type DeliverySourceDefinition = {
  /** FILES sends attachments; TEXT sends one text message (for example a link). */
  kind: "FILES" | "TEXT";
  /** Client-facing name of the document, used in captions and neutral file names. */
  label: string;
  /** Upload documentTypes that make up the package, in send order (FILES only). */
  uploadTypes: readonly string[];
  /** Upload entityType of the documents (FILES only). */
  entityType?: "solicitudes" | "pagos" | "clientDispersions";
  /** Text kept in the historical `message` field of the job. */
  legacyMessage: string;
  /** Module/action that may prepare the job by hand. */
  manualPermission: { module: string; action: string };
};

export const WHATSAPP_DELIVERY_SOURCES = {
  FACTURA_PDF_XML: {
    kind: "FILES", label: "Factura", uploadTypes: ["FACTURA_PDF", "FACTURA_XML"], entityType: "solicitudes",
    legacyMessage: "compartimos folio solicitado", manualPermission: { module: "solicitudes", action: "uploadDocs" },
  },
  COMPLEMENTO_PAGO_PDF_XML: {
    kind: "FILES", label: "Complemento de pago", uploadTypes: ["COMPLEMENTO_PAGO_PDF", "COMPLEMENTO_PAGO_XML"], entityType: "pagos",
    legacyMessage: "compartimos complemento de pago", manualPermission: { module: "solicitudes", action: "uploadDocs" },
  },
  DISPERSION_COMPROBANTE: {
    kind: "FILES", label: "Comprobante de dispersión", uploadTypes: ["COMPROBANTE_DISPERSION"], entityType: "clientDispersions",
    legacyMessage: "compartimos comprobante", manualPermission: { module: "wallet", action: "dispersiones" },
  },
  COTIZACION_PDF: {
    kind: "FILES", label: "Cotización", uploadTypes: ["COTIZACION"], entityType: "solicitudes",
    legacyMessage: "compartimos cotizacion", manualPermission: { module: "solicitudes", action: "uploadDocs" },
  },
  CONSTANCIA_FIRMA_LINK: {
    kind: "TEXT", label: "Firma de constancia de recibido", uploadTypes: [],
    legacyMessage: "compartimos link de firma", manualPermission: { module: "solicitudes", action: "uploadDocs" },
  },
  CONSTANCIA_FIRMADA_PDF: {
    kind: "FILES", label: "Constancia de recibido firmada", uploadTypes: ["CONSTANCIA_RECEPCION_SATISFACCION"], entityType: "solicitudes",
    legacyMessage: "compartimos constancia firmada", manualPermission: { module: "solicitudes", action: "uploadDocs" },
  },
} as const satisfies Record<string, DeliverySourceDefinition>;

export type DeliverySourceType = keyof typeof WHATSAPP_DELIVERY_SOURCES;
export const DELIVERY_SOURCE_TYPES = Object.keys(WHATSAPP_DELIVERY_SOURCES) as DeliverySourceType[];

export function normalizeDeliverySourceType(value: unknown): DeliverySourceType | null {
  const text = String(value ?? "").trim().toUpperCase();
  return (DELIVERY_SOURCE_TYPES as string[]).includes(text) ? (text as DeliverySourceType) : null;
}

export function deliverySource(sourceType: DeliverySourceType): DeliverySourceDefinition {
  return WHATSAPP_DELIVERY_SOURCES[sourceType];
}

const clean = (value: unknown, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const upper = (value: unknown) => clean(value, 120).toUpperCase();

/** An upload row that may complete an automatic package: active, READY, stored and scoped. */
export function isReadyUpload(row: Record<string, any> | null | undefined): boolean {
  return !!row && row.active === true && upper(row.status) === "READY" && !!clean(row.storagePath, 1200) && !!clean(row.rootId, 200);
}

/** Which source type an upload belongs to, or null when it never triggers a client delivery. */
export function sourceTypeForUpload(row: Record<string, any> | null | undefined): DeliverySourceType | null {
  if (!isReadyUpload(row)) return null;
  const type = upper(row!.documentType ?? row!.tipo ?? row!.type), entity = clean(row!.entityType, 80);
  if (["FACTURA_PDF", "FACTURA_XML"].includes(type) && upper(entity) === "SOLICITUDES") return "FACTURA_PDF_XML";
  // Only canonical complements (validated against the CFDI and sealed) carry a complementKey.
  if (["COMPLEMENTO_PAGO_PDF", "COMPLEMENTO_PAGO_XML"].includes(type) && entity === "pagos" && clean(row!.complementKey, 80) &&
      upper(row!.integritySealStatus) === "SEALED") return "COMPLEMENTO_PAGO_PDF_XML";
  if (type === "COMPROBANTE_DISPERSION" && entity === "clientDispersions") return "DISPERSION_COMPROBANTE";
  if (type === "COTIZACION" && entity === "solicitudes") return "COTIZACION_PDF";
  // The receipt certificate is only sent once the client's signature is part of it.
  if (type === "CONSTANCIA_RECEPCION_SATISFACCION" && entity === "solicitudes" && clean(row!.constanciaSnapshot?.signatureUploadId, 200))
    return "CONSTANCIA_FIRMADA_PDF";
  return null;
}

/** Same stored object and version as before: a later metadata update must not send again. */
export function sameUploadVersion(before: Record<string, any> | null | undefined, after: Record<string, any> | null | undefined): boolean {
  if (!isReadyUpload(before) || !isReadyUpload(after)) return false;
  return clean(before!.storagePath, 1200) === clean(after!.storagePath, 1200) && clean(before!.sha256, 100) === clean(after!.sha256, 100) &&
    Number(before!.version || 0) === Number(after!.version || 0);
}

// ---------------------------------------------------------------------------
// White-label texts. Built only from client-facing data, never PAY0, folios or despachos.
// ---------------------------------------------------------------------------

export type CaptionInput = { sourceType: DeliverySourceType; counterpartyName?: unknown; amount?: unknown; dateMs?: unknown; fileName?: unknown; link?: unknown };

const BRAND_OR_INTERNAL = /pay\s*-?\s*0|despacho/i;

/** A name is shown only when it carries no brand or internal reference. */
function safeName(value: unknown): string {
  const text = clean(value, 120);
  return text && !BRAND_OR_INTERNAL.test(text) ? text : "";
}

export function formatAmountMx(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(amount);
}

export function formatDateMx(value: unknown): string {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(ms));
}

function counterpartyPhrase(sourceType: DeliverySourceType, name: string): string {
  if (!name) return "";
  if (sourceType === "DISPERSION_COMPROBANTE") return ` a ${name}`;
  return ` de ${name}`;
}

export function buildDeliveryCaption(input: CaptionInput): string {
  const source = deliverySource(input.sourceType);
  const name = safeName(input.counterpartyName), amount = formatAmountMx(input.amount), date = formatDateMx(input.dateMs);
  const head = `${source.label}${counterpartyPhrase(input.sourceType, name)}${amount ? ` por ${amount}` : ""}${date ? ` del ${date}` : ""}`;
  if (source.kind === "TEXT") {
    const link = clean(input.link, 600);
    return `Hola. Para confirmar la recepción${name ? ` de ${name}` : ""}${amount ? ` por ${amount}` : ""}, por favor firma la constancia en este enlace: ${link}`;
  }
  const file = clean(input.fileName, 160);
  return `${head}.${file ? ` Archivo: ${file}` : ""}`;
}

/** Neutral file name: never the stored name, which can carry internal folios. */
export function clientFacingFileName(input: { sourceType: DeliverySourceType; documentType?: unknown; contentType?: unknown; storagePath?: unknown; dateMs?: unknown }): string {
  const source = deliverySource(input.sourceType);
  const path = clean(input.storagePath, 1200).toLowerCase(), contentType = clean(input.contentType, 120).toLowerCase(), type = upper(input.documentType);
  const extension = type.endsWith("_XML") || contentType.includes("xml") || path.endsWith(".xml") ? "xml"
    : contentType.includes("png") || path.endsWith(".png") ? "png"
    : contentType.includes("jpeg") || path.endsWith(".jpg") || path.endsWith(".jpeg") ? "jpg" : "pdf";
  const date = formatDateMx(input.dateMs).replace(/\//g, "-");
  const base = source.label.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return `${base}${date ? ` ${date}` : ""}.${extension}`;
}

// ---------------------------------------------------------------------------
// Hugo's hours: Mon-Fri 7:30-19:30, Sat 8:00-15:00, America/Mexico_City.
// ---------------------------------------------------------------------------

export function isWithinHugoHours(nowMs: number): boolean {
  return isWithinWorkingHours(OWNER_WORKING_HOURS, nowMs);
}

// ---------------------------------------------------------------------------
// Destination order: client group seen by Hugo, then legacy route, then client phone.
// ---------------------------------------------------------------------------

export type DestinationCandidate = { safeDocId: string; chatId: string; chatName: string; chatType: "GROUP" | "CONTACT"; destinationType: "CLIENT_GROUP" | "ADDITIONAL" | "CLIENT_PRIMARY"; phone?: string; connectorId: string };

export type DestinationInputs = {
  assignment: { groupChatId?: unknown; groupName?: unknown } | null;
  /** Hugo's synced row for the assigned group, if his binding sees it. */
  hugoGroup: { bindingId: string; chatId?: unknown; name?: unknown; isGroup?: unknown; active?: unknown; rootId?: unknown } | null;
  rootId: string;
  legacyRoute: { routeId: string; matchType: "EXACT" | "DEFAULT"; destinations: Array<{ safeDocId?: unknown; chatId?: unknown; chatName?: unknown; chatType?: unknown }> } | null;
  clientPhone: string | null;
  clientName: string;
};

export type DestinationChoice =
  | { source: "CLIENT_GROUP"; destinations: DestinationCandidate[] }
  | { source: "LEGACY_ROUTE"; routeId: string; matchType: "EXACT" | "DEFAULT"; destinations: DestinationCandidate[] }
  | { source: "LEGACY_ROUTE_INVALID"; routeId: string; matchType: "EXACT" | "DEFAULT"; destinations: [] }
  | { source: "CLIENT_PHONE"; destinations: DestinationCandidate[] }
  | { source: "NONE"; destinations: [] };

export function chooseDeliveryDestination(input: DestinationInputs): DestinationChoice {
  const groupChatId = clean(input.assignment?.groupChatId, 200);
  const group = input.hugoGroup;
  if (groupChatId && group && clean(group.chatId, 200) === groupChatId && group.isGroup === true && group.active === true && clean(group.rootId, 200) === input.rootId && groupChatId.endsWith("@g.us")) {
    return { source: "CLIENT_GROUP", destinations: [{ safeDocId: encodeURIComponent(groupChatId), chatId: groupChatId,
      chatName: clean(group.name, 160) || clean(input.assignment?.groupName, 160) || "Grupo WhatsApp", chatType: "GROUP", destinationType: "CLIENT_GROUP", connectorId: group.bindingId }] };
  }
  if (input.legacyRoute) {
    const destinations: DestinationCandidate[] = input.legacyRoute.destinations
      .map(item => ({ safeDocId: clean(item.safeDocId, 1000), chatId: clean(item.chatId, 200), chatName: clean(item.chatName, 160),
        chatType: clean(item.chatType) === "GROUP" ? "GROUP" as const : "CONTACT" as const, destinationType: "ADDITIONAL" as const, connectorId: "default" }))
      .filter(item => Boolean(item.chatId && item.safeDocId));
    if (!destinations.length) return { source: "LEGACY_ROUTE_INVALID", routeId: input.legacyRoute.routeId, matchType: input.legacyRoute.matchType, destinations: [] };
    return { source: "LEGACY_ROUTE", routeId: input.legacyRoute.routeId, matchType: input.legacyRoute.matchType, destinations };
  }
  if (input.clientPhone) {
    return { source: "CLIENT_PHONE", destinations: [{ safeDocId: "CLIENT_PRIMARY", chatId: `${input.clientPhone}@c.us`, chatName: clean(input.clientName, 160) || "Cliente",
      chatType: "CONTACT", destinationType: "CLIENT_PRIMARY", phone: input.clientPhone, connectorId: "default" }] };
  }
  return { source: "NONE", destinations: [] };
}

// ---------------------------------------------------------------------------
// Delivery lease state machine. A delivery is never sent twice.
// ---------------------------------------------------------------------------

export const DELIVERY_LEASE_MS = 3 * 60 * 1000;

/** Delivery statuses that must never be reset by routing or release. */
export const PROTECTED_DELIVERY_STATUSES = ["SENT", "SENDING", "SEND_UNCERTAIN"] as const;

export type LeaseRow = { status?: unknown; lease?: { leaseId?: unknown; bindingId?: unknown; generation?: unknown; expiresAtMs?: unknown } | null; attemptStartedAtMs?: unknown };

export type ClaimDecision = "CLAIM" | "RECLAIM_EXPIRED" | "MARK_UNCERTAIN" | "SKIP";

export function decideClaim(row: LeaseRow, nowMs: number): ClaimDecision {
  const status = upper(row.status);
  if (status === "PENDING_SEND") return "CLAIM";
  if (status !== "SENDING") return "SKIP";
  const expires = Number(row.lease?.expiresAtMs || 0);
  if (expires > nowMs) return "SKIP";
  // An attempt may have reached WhatsApp: never send again without a human.
  return Number(row.attemptStartedAtMs || 0) > 0 ? "MARK_UNCERTAIN" : "RECLAIM_EXPIRED";
}

export type ReportOutcome = "ATTEMPT" | "SENT" | "ERROR" | "UNCERTAIN";
export type ReportDecision =
  | { action: "ATTEMPT_AUTHORIZED" }
  | { action: "MARK_SENT" }
  | { action: "ALREADY_SENT" }
  | { action: "MARK_ERROR" }
  | { action: "MARK_UNCERTAIN" }
  | { action: "REJECT"; reason: string };

export function decideReport(row: LeaseRow, report: { outcome: ReportOutcome; leaseId: string; bindingId: string; generation: number }, nowMs: number): ReportDecision {
  const status = upper(row.status), lease = row.lease || {};
  const sameLease = clean(lease.leaseId, 80) === report.leaseId && clean(lease.bindingId, 200) === report.bindingId && Number(lease.generation) === report.generation;
  if (!sameLease) return { action: "REJECT", reason: "LEASE_MISMATCH" };
  const attempted = Number(row.attemptStartedAtMs || 0) > 0;
  if (report.outcome === "ATTEMPT") {
    if (status !== "SENDING") return { action: "REJECT", reason: "NOT_SENDING" };
    if (attempted) return { action: "REJECT", reason: "ALREADY_ATTEMPTED" };
    if (Number(lease.expiresAtMs || 0) <= nowMs) return { action: "REJECT", reason: "LEASE_EXPIRED" };
    return { action: "ATTEMPT_AUTHORIZED" };
  }
  if (report.outcome === "SENT") {
    if (status === "SENT") return { action: "ALREADY_SENT" };
    if (!attempted) return { action: "REJECT", reason: "NOT_ATTEMPTED" };
    // A late SENT is the truth and also resolves an uncertainty raised by an expired lease.
    if (status === "SENDING" || status === "SEND_UNCERTAIN") return { action: "MARK_SENT" };
    return { action: "REJECT", reason: "STATUS_CHANGED" };
  }
  if (status !== "SENDING") return { action: "REJECT", reason: "NOT_SENDING" };
  // A failure after the attempt started may still have reached the chat.
  if (report.outcome === "ERROR" && !attempted) return { action: "MARK_ERROR" };
  return { action: "MARK_UNCERTAIN" };
}

/** Job status derived from its deliveries. */
export function aggregateJobStatus(statuses: unknown[], fallback: string): string {
  const list = statuses.map(upper).filter(status => status && status !== "OMITTED");
  if (!list.length) return fallback;
  if (list.includes("SENDING")) return "SENDING";
  if (list.includes("PENDING_SEND")) return "READY_FOR_SEND";
  if (list.includes("SEND_UNCERTAIN")) return "BLOCKED_UNCERTAIN";
  if (list.some(status => status === "PENDING_MANUAL_RELEASE")) return fallback;
  const sent = list.filter(status => status === "SENT").length;
  if (sent === list.length) return "SENT";
  return sent > 0 ? "ERROR_PARTIAL" : "ERROR";
}
