import { Timestamp } from "firebase-admin/firestore";

export const CONTROL_CENTER_SCHEMA_VERSION = 1 as const;
export const CONTROL_CENTER_TIME_ZONE = "America/Mexico_City" as const;

export const ANALYTICS_EVENT_TYPES = [
  "SOURCE_RECONCILED",
  "SOLICITUD_CREATED",
  "SOLICITUD_STATUS_CHANGED",
  "INVOICE_DRAFTED",
  "INVOICE_ISSUED",
  "INVOICE_CANCELED",
  "PAYMENT_CREATED",
  "PAYMENT_APPLIED",
  "PAYMENT_RECONCILED",
  "EXPENSE_RECORDED",
  "DISPERSION_CREATED",
  "DISPERSION_COMPLETED",
  "MATERIALITY_COMPLETED",
  "DOCUMENT_MISSING",
  "INTEGRATION_FAILED",
  "HUGO_ANOMALY_DETECTED",
  "HUGO_RECOMMENDATION_CREATED",
] as const;

export type AnalyticsEventType = typeof ANALYTICS_EVENT_TYPES[number];
export type AnalyticsModule = "solicitudes" | "pagos" | "facturama" | "gastos" | "wallet" | "materialidad" | "integraciones" | "hugo";

export type AnalyticsMoney = {
  currency: "MXN";
  grossMinor: number;
  taxMinor?: number;
  netMinor?: number;
  costMinor?: number;
  marginMinor?: number;
};

export type AnalyticsDimensions = {
  companyId?: string;
  clientId?: string;
  userId?: string;
  despachoId?: string;
  operationTypeKey?: string;
  destinationAccountId?: string;
  bankId?: string;
  status?: string;
  paymentMethod?: string;
  invoiceMethod?: string;
  satKey?: string;
};

export type AnalyticsEvent = {
  eventId: string;
  rootId: string;
  eventType: AnalyticsEventType;
  module: AnalyticsModule;
  entityType: string;
  entityId: string;
  occurredAt: Timestamp;
  businessDate: string;
  periods: PeriodKeys;
  money?: AnalyticsMoney;
  dimensions: AnalyticsDimensions;
  sourceVersion: number;
  schemaVersion: typeof CONTROL_CENTER_SCHEMA_VERSION;
};

export type AnalyticsEventInput = Omit<AnalyticsEvent, "businessDate" | "periods" | "schemaVersion">;

export type PeriodKeys = {
  day: string;
  week: string;
  month: string;
  year: string;
};

const clean = (value: unknown) => String(value ?? "").trim();
const EVENT_TYPES = new Set<string>(ANALYTICS_EVENT_TYPES);

function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CONTROL_CENTER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function isoWeek(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  const weekday = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - weekday);
  const weekYear = value.getUTCFullYear();
  const first = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((value.getTime() - first.getTime()) / 86400000) + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

export function getCanonicalPeriodKeys(date: Date): PeriodKeys {
  if (!Number.isFinite(date.getTime())) throw new Error("CONTROL_CENTER_INVALID_DATE");
  const { year, month, day } = zonedParts(date);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  return {
    day: `${monthKey}-${String(day).padStart(2, "0")}`,
    week: isoWeek(year, month, day),
    month: monthKey,
    year: String(year),
  };
}

function assertMinor(value: unknown, field: string) {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`CONTROL_CENTER_INVALID_${field}`);
}

export function normalizeAnalyticsEvent(input: AnalyticsEventInput): AnalyticsEvent {
  const eventId = clean(input.eventId);
  const rootId = clean(input.rootId);
  const entityId = clean(input.entityId);
  const entityType = clean(input.entityType);
  if (!eventId || !rootId || !entityId || !entityType) throw new Error("CONTROL_CENTER_EVENT_IDENTITY_REQUIRED");
  if ([eventId, rootId, entityId].some(value => value.includes("/") || value.length > 300)) throw new Error("CONTROL_CENTER_INVALID_ID");
  if (!EVENT_TYPES.has(input.eventType)) throw new Error("CONTROL_CENTER_EVENT_TYPE_INVALID");
  if (!(input.occurredAt instanceof Timestamp)) throw new Error("CONTROL_CENTER_EVENT_TIMESTAMP_REQUIRED");
  if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1) throw new Error("CONTROL_CENTER_SOURCE_VERSION_INVALID");
  if (input.money) {
    if (input.money.currency !== "MXN") throw new Error("CONTROL_CENTER_CURRENCY_UNSUPPORTED");
    if (input.money.grossMinor === undefined) throw new Error("CONTROL_CENTER_INVALID_GROSS_MINOR");
    assertMinor(input.money.grossMinor, "GROSS_MINOR");
    assertMinor(input.money.taxMinor, "TAX_MINOR");
    assertMinor(input.money.netMinor, "NET_MINOR");
    assertMinor(input.money.costMinor, "COST_MINOR");
    if (input.money.marginMinor !== undefined && !Number.isSafeInteger(input.money.marginMinor)) throw new Error("CONTROL_CENTER_INVALID_MARGIN_MINOR");
  }
  const periods = getCanonicalPeriodKeys(input.occurredAt.toDate());
  return { ...input, eventId, rootId, entityId, entityType, dimensions: input.dimensions || {}, businessDate: periods.day, periods, schemaVersion: CONTROL_CENTER_SCHEMA_VERSION };
}
