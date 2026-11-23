import { mexicoDate, type DailyReview } from "./domain";

/**
 * What a person needs to understand a pending IQ operation: which kind it is, which client, how much, when and why
 * it was not brought into PAY0. Built from the IQ row the sync already read; it carries no PAY0 identifiers.
 */
export type ReviewDisplay = {
  kind: string;
  clientName: string | null;
  rfc: string | null;
  amount: number | null;
  currency: string | null;
  date: string | null;
  beneficiaryName: string | null;
  bank: string | null;
  partner: string | null;
  /** How the client name matched the IQ client catalog (only for operations that name a client). */
  clientMatch: { status: string; candidateCount: number } | null;
};

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const orNull = (value: unknown) => text(value) || null;

export const KIND_LABEL: Record<string, string> = {
  CLIENT: "Cliente",
  SOLICITUD: "Factura",
  PAYMENT: "Depósito",
  APPLICATION: "Aplicación de depósito",
  DISPERSION: "Dispersión",
  PAYMENT_POSTING: "Depósito (registro en cartera)",
};

export function kindLabel(entityType: string): string {
  return KIND_LABEL[entityType] || "Operación";
}

/** Group id to the person it belongs to. */
export function groupLabel(groupId: string): string {
  if (groupId === "iq-group-rr") return "RR (BETELL)";
  if (groupId === "iq-group-pay0") return "PAY0 (EBASOR)";
  return "Grupo desconocido";
}

function firstNumber(raw: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(raw[key]);
    if (raw[key] !== null && raw[key] !== undefined && text(raw[key]) !== "" && Number.isFinite(value)) return value;
  }
  return null;
}

function dateOf(raw: Record<string, unknown>): string | null {
  for (const key of ["created_at", "createdAt", "date", "fecha", "deposit_date"]) {
    const value = text(raw[key]);
    if (!value) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return mexicoDate(new Date(ms));
  }
  return null;
}

export function displayFromIqRow(kind: string, raw: Record<string, unknown>): ReviewDisplay {
  const resolution = (raw.__p4ClientResolution && typeof raw.__p4ClientResolution === "object" ? raw.__p4ClientResolution : null) as Record<string, unknown> | null;
  const isClient = kind === "CLIENT";
  return {
    kind: kindLabel(kind),
    clientName: orNull(isClient ? (raw.name ?? raw.business_name ?? raw.razon_social) : (raw.client ?? raw.client_name ?? raw.customer_name)),
    rfc: isClient ? orNull(raw.rfc ?? raw.tax_id) : null,
    amount: isClient ? null : firstNumber(raw, kind === "SOLICITUD" ? ["total", "amount", "subtotal"] : ["amount", "total", "total_amount", "sum", "monto", "deposit_amount"]),
    currency: orNull(raw.currency)?.toUpperCase() || null,
    date: dateOf(raw),
    beneficiaryName: null,
    bank: null,
    partner: orNull(raw.partner),
    clientMatch: resolution ? { status: text(resolution.status), candidateCount: Number(resolution.candidateCount) || 0 } : null,
  };
}

export function displayFromIqDispersion(raw: Record<string, unknown>): ReviewDisplay {
  return {
    kind: kindLabel("DISPERSION"),
    clientName: orNull(raw.client),
    rfc: null,
    amount: firstNumber(raw, ["total_to_disperse", "amount", "sum"]),
    currency: orNull(raw.currency)?.toUpperCase() || null,
    date: dateOf(raw),
    beneficiaryName: orNull(raw.beneficiary_name),
    bank: orNull(raw.bank_name),
    partner: orNull(raw.partner),
    clientMatch: null,
  };
}

const REASONS: Record<string, string> = {
  IQ_DISPERSION_NOT_IN_PAY0: "Dispersión hecha directamente en IQ que todavía no existe en PAY0.",
  FINANCIAL_COMPONENT_DEPENDS_ON_AN_UNRESOLVED_CLIENT: "Depende de un cliente que el sistema no pudo identificar con certeza.",
  OPERATIONAL_IDENTITY_SCOPE_MISMATCH: "No se pudo determinar a qué usuario de PAY0 pertenece este cliente.",
  DAILY_RECONCILE_REQUIRES_REVIEW: "Ya existe en PAY0 y no coincide por completo con IQ; se deja para revisar y no se modifica.",
  POSSIBLE_PAY0_DUPLICATE: "Parece un movimiento que ya existe en PAY0 sin enlace a IQ (mismo cliente, monto y fecha); no se crea para no duplicarlo.",
  POSSIBLE_PAY0_CLIENT_DUPLICATE: "Parece un cliente que ya existe en PAY0 (mismo RFC o nombre); no se crea para no duplicarlo.",
  APPLICATION_ON_EXISTING_PARENT: "Aplica un depósito a una factura que ya existía en PAY0; requiere revisión.",
  CANONICAL_FIELDS_REVIEW: "Faltan datos obligatorios en IQ para poder crearlo en PAY0.",
  COMPONENT_IN_REVIEW: "Forma parte de un conjunto de operaciones que tiene una pendiente.",
  DEPENDENCY_IN_REVIEW: "Depende de otra operación que está en revisión.",
  DISPERSION_NOT_FINISHED: "La dispersión todavía no está terminada en IQ; se trae cuando termine.",
  DISPERSION_CLIENT_NOT_IDENTIFIED: "No se encontró en PAY0 un cliente enlazado a IQ con ese nombre y de ese dueño.",
  DISPERSION_CLIENT_AMBIGUOUS: "Hay varios clientes en PAY0 con ese nombre enlazados a IQ; hay que elegir cuál es.",
  DISPERSION_CLIENT_CHANGED: "El cliente cambió o ya no es del dueño de este grupo de IQ.",
  DISPERSION_CLIENT_NOT_ACTIVE: "El cliente está inactivo o fusionado en PAY0.",
  DISPERSION_ACCOUNT_UNREADABLE: "La cuenta de destino no viene completa o no es válida en IQ.",
  DISPERSION_CASH_NOT_SUPPORTED: "Las dispersiones en efectivo todavía se revisan a mano.",
  DISPERSION_TYPE_UNKNOWN: "El tipo de dispersión de IQ no se reconoce.",
  DISPERSION_TYPE_UNUSABLE: "El tipo de dispersión de PAY0 está inactivo o no es de dispersiones.",
  DISPERSION_METHOD_INACTIVE: "La cuenta del beneficiario existe en PAY0 pero está inactiva.",
  DISPERSION_NUMBERING_MISSING: "Falta el número de cliente o de usuario para dar de alta al beneficiario.",
  DISPERSION_PERCENTAGE_INVALID: "El porcentaje de venta de IQ no es legible.",
  DISPERSION_DATE_INVALID: "IQ no entregó una fecha legible.",
  DISPERSION_AMOUNT_INVALID: "IQ no entregó un monto legible.",
  DISPERSION_IMPORT_FAILED: "No se pudo crear la dispersión; se reintenta en la siguiente corrida.",
  WALLET_POSTING_REQUIRES_OPERATION_TYPE: "Depósito traído de IQ que falta registrar en la cartera con su tipo de operación.",
};

/** The reason in plain Spanish. The client match, when known, says why a client could not be identified. */
export function reasonEs(code: string, display?: ReviewDisplay | null): string {
  const base = REASONS[code] || "Requiere revisión del equipo.";
  if (code !== "FINANCIAL_COMPONENT_DEPENDS_ON_AN_UNRESOLVED_CLIENT" || !display?.clientMatch) return base;
  const { status, candidateCount } = display.clientMatch;
  if (status === "CONFLICT") return `${base} En IQ hay ${candidateCount} clientes con ese mismo nombre.`;
  if (status === "NOT_FOUND") return `${base} En IQ no se encontró un cliente con ese nombre.`;
  return base;
}

/** Adds the readable data of the IQ row to each review's evidence. Reviews without a known row keep what they had. */
export function attachDisplay(reviews: DailyReview[], index: Map<string, ReviewDisplay>): DailyReview[] {
  return reviews.map((review) => {
    // A deposit waiting to be posted to the wallet is the same IQ deposit.
    const type = review.entityType === "PAYMENT_POSTING" ? "PAYMENT" : review.entityType;
    const display = index.get(`${type}:${review.iqEntityId}`);
    return display ? { ...review, evidence: { ...review.evidence, display } } : review;
  });
}
