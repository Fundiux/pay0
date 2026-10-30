import { P4EngineError } from "./domain";

export const HISTORICAL_FOLIO_VERSION = 1 as const;
export const HISTORICAL_IQ_ID_PATTERN = /^\d{1,15}$/;
export const HISTORICAL_SOLICITUD_FOLIO_PATTERN = /^SIQ([RP])(\d{1,15})$/;
export const HISTORICAL_PAYMENT_FOLIO_PATTERN = /^PIQ([RP])(\d{1,15})$/;

export type HistoricalFolioEntity = "SOLICITUD" | "PAYMENT";
export type HistoricalFolioGroup = "iq-group-rr" | "iq-group-pay0";
export type HistoricalFolioClassification =
  | { kind: "PAY0_NATIVE"; value: string }
  | { kind: "IQ_HISTORICAL_SOLICITUD" | "IQ_HISTORICAL_PAYMENT"; value: string; canonicalGroupId: HistoricalFolioGroup; iqId: string; historicalFolioVersion: 1 }
  | { kind: "UNKNOWN"; value: string };

const groupCodes: Record<HistoricalFolioGroup, "R" | "P"> = { "iq-group-rr": "R", "iq-group-pay0": "P" };
const groupsByCode: Record<"R" | "P", HistoricalFolioGroup> = { R: "iq-group-rr", P: "iq-group-pay0" };
const text = (value: unknown) => String(value ?? "").trim();

function exactGroup(value: string): HistoricalFolioGroup {
  if (value === "iq-group-rr" || value === "iq-group-pay0") return value;
  throw new P4EngineError("HISTORICAL_FOLIO_GROUP_REVIEW_REQUIRED", "El grupo IQ canónico no tiene código de folio histórico asignado.");
}

function exactIqId(value: string): string {
  const iqId = text(value);
  if (!HISTORICAL_IQ_ID_PATTERN.test(iqId)) throw new P4EngineError("HISTORICAL_FOLIO_ID_REVIEW_REQUIRED", "El IQ ID no cumple el contrato numérico de 1 a 15 dígitos demostrado para P4.");
  return iqId;
}

export function buildHistoricalFolio(entityType: HistoricalFolioEntity, canonicalGroupId: string, iqIdInput: string): string {
  const group = exactGroup(canonicalGroupId), iqId = exactIqId(iqIdInput);
  return `${entityType === "SOLICITUD" ? "SIQ" : "PIQ"}${groupCodes[group]}${iqId}`;
}

export const buildHistoricalSolicitudFolio = (input: { canonicalGroupId: string; iqSolicitudId: string }) => buildHistoricalFolio("SOLICITUD", input.canonicalGroupId, input.iqSolicitudId);
export const buildHistoricalPaymentFolio = (input: { canonicalGroupId: string; iqPaymentId: string }) => buildHistoricalFolio("PAYMENT", input.canonicalGroupId, input.iqPaymentId);

export function classifyPay0Folio(input: unknown): HistoricalFolioClassification {
  const value = text(input), solicitud = HISTORICAL_SOLICITUD_FOLIO_PATTERN.exec(value);
  if (solicitud) return { kind: "IQ_HISTORICAL_SOLICITUD", value, canonicalGroupId: groupsByCode[solicitud[1] as "R" | "P"], iqId: solicitud[2], historicalFolioVersion: HISTORICAL_FOLIO_VERSION };
  const payment = HISTORICAL_PAYMENT_FOLIO_PATTERN.exec(value);
  if (payment) return { kind: "IQ_HISTORICAL_PAYMENT", value, canonicalGroupId: groupsByCode[payment[1] as "R" | "P"], iqId: payment[2], historicalFolioVersion: HISTORICAL_FOLIO_VERSION };
  if (/^S\d+C\d+U\d+E\d+$/.test(value) || /^P\d+C\d+U\d+E\d+$/.test(value)) return { kind: "PAY0_NATIVE", value };
  return { kind: "UNKNOWN", value };
}

export function historicalFolioEvidence(entityType: HistoricalFolioEntity, canonicalGroupId: string, iqId: string) {
  return { kind: "IQ_HISTORICAL" as const, value: buildHistoricalFolio(entityType, canonicalGroupId, iqId), canonicalGroupId: exactGroup(canonicalGroupId), iqId: exactIqId(iqId), historicalFolioVersion: HISTORICAL_FOLIO_VERSION };
}

export function assertHistoricalFolioProvenance(input: { entityType: HistoricalFolioEntity; folio: unknown; canonicalGroupId: string; iqId: string; source: unknown; importManifestId: unknown; importRunId: unknown; p4ActionId: unknown }): void {
  if (text(input.source) !== "IQ_IMPORT" || !text(input.importManifestId) || !text(input.importRunId) || !text(input.p4ActionId)) throw new P4EngineError("P4_HISTORICAL_FOLIO_PROVENANCE_REQUIRED", "SIQ/PIQ requiere procedencia IQ_IMPORT completa.");
  if (text(input.folio) !== buildHistoricalFolio(input.entityType, input.canonicalGroupId, input.iqId)) throw new P4EngineError("P4_HISTORICAL_FOLIO_MISMATCH", "El folio histórico no coincide con tipo, grupo e IQ ID server-side.");
}
