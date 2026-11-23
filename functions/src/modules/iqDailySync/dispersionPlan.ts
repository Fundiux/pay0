import { createHash } from "node:crypto";

import { IQ_CANONICAL_TIME_ZONE, parseIqDateTimeMs } from "../iq/iqDateTime";
import { resolveIqPay0Identity } from "../iq/iqPay0Identity";
import { P4_PLAN_GROUPS, type Pay0PlanRow } from "../iqHistoricalImport/planner";
import { mexicoDate } from "./domain";

/**
 * Pure rules to bring a dispersion made directly in IQ into PAY0 with its original date (owner decisions 2026-11-23).
 * Only a finished dispersion (TERMINADA) whose client, owner and destination are clear is created; everything else
 * stays in review. Nothing here reads or writes data.
 */

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const upper = (value: unknown) => text(value).toUpperCase();
const plain = (value: unknown) => upper(value).normalize("NFD").replace(/[̀-ͯ]/g, "");
const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export type OperationTypeKey = "TRANSFERENCIA" | "TDC" | "EFECTIVO";

export type ParsedIqDispersion = {
  iqId: string;
  groupId: string;
  createdAtIso: string;
  date: string;
  amount: number;
  currency: string;
  clientName: string;
  beneficiaryName: string;
  bankName: string;
  destination: { kind: "CLABE" | "TARJETA"; digits: string; bankCode: string | null };
  operationTypeKey: OperationTypeKey;
  /** Percentage of sale as IQ shows it (0 for transfers and card payments). */
  salePercentage: number;
  /** Client commission in cents-exact money: the percentage of the total requested. */
  clientChargeAmount: number;
};

export type DispersionParse = { ok: true; value: ParsedIqDispersion } | { ok: false; code: string; detail: string };

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** SAT/Banxico CLABE check digit over the first 17 digits (weights 3, 7, 1). */
export function isValidClabe(clabe: string): boolean {
  if (!/^\d{18}$/.test(clabe)) return false;
  const weights = [3, 7, 1];
  const sum = [...clabe.slice(0, 17)].reduce((total, digit, index) => total + ((Number(digit) * weights[index % 3]) % 10), 0);
  return (10 - (sum % 10)) % 10 === Number(clabe[17]);
}

function operationTypeOf(value: unknown): OperationTypeKey | null {
  const type = plain(value);
  if (!type) return null;
  if (type.includes("EFECTIVO")) return "EFECTIVO";
  if (type.includes("TDC") || type.includes("TARJETA") || type.includes("AMEX")) return "TDC";
  if (type.includes("TRANSFER")) return "TRANSFERENCIA";
  return null;
}

function number(value: unknown): number | null {
  const raw = text(value).replace(/[$,%\s]/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** IQ shows the destination as "CLABE: 6616…" or "No. de tarjeta: 4189…". The digits decide; the label breaks ties. */
function destinationOf(raw: unknown): ParsedIqDispersion["destination"] | null {
  const label = plain(raw);
  const digits = label.replace(/\D/g, "");
  if (digits.length === 18 && isValidClabe(digits)) return { kind: "CLABE", digits, bankCode: digits.slice(0, 3) };
  if ((digits.length === 16 || digits.length === 15) && !label.includes("CLABE")) return { kind: "TARJETA", digits, bankCode: null };
  return null;
}

export function parseIqDispersion(raw: Record<string, unknown>, groupId: string): DispersionParse {
  const iqId = text(raw.id ?? raw.iq_id ?? raw.folio);
  if (!/^\d{1,15}$/.test(iqId)) return { ok: false, code: "DISPERSION_ID_INVALID", detail: "IQ no entregó un número de dispersión válido." };
  const status = plain(raw.operation_status ?? raw.status);
  if (status !== "TERMINADA" && status !== "TERMINADO") return { ok: false, code: "DISPERSION_NOT_FINISHED", detail: "La dispersión todavía no está terminada en IQ." };

  // IQ sends its dates without a time zone: they are Mexico City time, exactly as the historical import reads them.
  const createdMs = parseIqDateTimeMs(text(raw.created_at ?? raw.createdAt ?? raw.date), IQ_CANONICAL_TIME_ZONE);
  if (createdMs === null) return { ok: false, code: "DISPERSION_DATE_INVALID", detail: "IQ no entregó una fecha legible." };

  const amount = number(raw.total_to_disperse ?? raw.amount ?? raw.sum);
  if (amount === null || amount <= 0) return { ok: false, code: "DISPERSION_AMOUNT_INVALID", detail: "IQ no entregó un monto legible." };

  const currency = upper(raw.currency) || "MXN";
  const operationTypeKey = operationTypeOf(raw.dispersion_type ?? raw.type);
  if (!operationTypeKey) return { ok: false, code: "DISPERSION_TYPE_UNKNOWN", detail: "El tipo de dispersión de IQ no se reconoce." };

  const destination = destinationOf(raw.account ?? raw.destination);
  if (operationTypeKey !== "EFECTIVO" && !destination) return { ok: false, code: "DISPERSION_ACCOUNT_UNREADABLE", detail: "La cuenta de destino no viene completa o no es válida." };
  if (operationTypeKey === "EFECTIVO") return { ok: false, code: "DISPERSION_CASH_NOT_SUPPORTED", detail: "Las dispersiones en efectivo todavía se revisan a mano." };

  const clientName = text(raw.client ?? raw.client_name);
  const beneficiaryName = upper(raw.beneficiary_name ?? raw.beneficiary);
  if (!clientName) return { ok: false, code: "DISPERSION_CLIENT_MISSING", detail: "IQ no entregó el cliente." };
  if (!beneficiaryName) return { ok: false, code: "DISPERSION_BENEFICIARY_MISSING", detail: "IQ no entregó el beneficiario." };

  // The percentage of sale applies to the total requested. Absent means IQ did not say: only 0% is assumed when
  // the field is present; transfers and card payments are 0% by the owner's rule.
  const percentageRaw = raw.sale_percentage ?? raw.sale_percent ?? raw.porcentaje_venta;
  const percentage = percentageRaw === undefined || percentageRaw === null || text(percentageRaw) === "" ? 0 : number(percentageRaw);
  if (percentage === null || percentage < 0 || percentage > 100) return { ok: false, code: "DISPERSION_PERCENTAGE_INVALID", detail: "El porcentaje de venta de IQ no es legible." };

  return {
    ok: true,
    value: {
      iqId, groupId, createdAtIso: new Date(createdMs).toISOString(), date: mexicoDate(new Date(createdMs)), amount: money(amount), currency, clientName, beneficiaryName,
      bankName: upper(raw.bank_name ?? raw.bank), destination: destination!, operationTypeKey, salePercentage: percentage, clientChargeAmount: money((amount * percentage) / 100),
    },
  };
}

/** Folio of a recovered dispersion: it never consumes PAY0's numbering. DIQR... is RR (BETELL), DIQP... is PAY0 (ELIUT). */
export function historicalDispersionFolio(groupId: string, iqId: string): string {
  return `DIQ${groupId === "iq-group-rr" ? "R" : "P"}${iqId}`;
}

/** Same IQ dispersion, same document, whatever the run. */
export function historicalDispersionId(rootId: string, groupId: string, iqId: string): string {
  return `iqd_${createHash("sha1").update(`${rootId}|${groupId}|${iqId}`).digest("hex").slice(0, 28)}`;
}

/** The way PAY0 keys a destination account for one client (the same key the beneficiary screen uses). */
export function methodDedupeKey(destination: ParsedIqDispersion["destination"]): string {
  return `${destination.kind === "CLABE" ? "CLABE" : "CARD"}|${destination.digits}`;
}
export function methodDocId(clientId: string, destination: ParsedIqDispersion["destination"]): string {
  return `cbm_${createHash("sha1").update(`${clientId}|${methodDedupeKey(destination)}`).digest("hex")}`;
}

export type ClientResolution = { ok: true; clientId: string } | { ok: false; code: string; detail: string };

/**
 * The PAY0 client of an IQ dispersion: linked to an IQ client of this group, same name, belonging to the owner the
 * IQ group maps to (RR to BETELL, ELIUT to EBASOR). Zero or several matches is never guessed.
 */
export function resolveDispersionClient(input: { groupId: string; clientName: string; pay0Rows: Pay0PlanRow[] }): ClientResolution {
  const group = P4_PLAN_GROUPS[input.groupId];
  const identity = group ? resolveIqPay0Identity({ canonicalIqGroupId: input.groupId, canonicalIqProfileId: group.canonicalIqProfileId }) : null;
  if (!group || !identity) return { ok: false, code: "DISPERSION_GROUP_UNKNOWN", detail: "El grupo de IQ no tiene un dueño configurado." };
  const wanted = plain(input.clientName);
  const matches = input.pay0Rows.filter((row) => {
    if (row.collection !== "clients" || row.data.isDeleted === true || row.data.active === false) return false;
    if (text(row.data.adminId) !== identity.pay0UserId) return false;
    const profiles = [text(object(row.data.iqLink).profileId), text(object(row.data.originClientIqLink).profileId), ...Object.keys(object(row.data.iqLinksByProfile))].filter(Boolean);
    if (!profiles.some((profileId) => group.memberProfileIds.includes(profileId))) return false;
    return [row.data.iqClientName, object(row.data.iqLink).clientName, row.data.name, row.data.razonSocial].some((name) => plain(name) === wanted);
  });
  if (matches.length === 1) return { ok: true, clientId: matches[0].id };
  if (matches.length > 1) return { ok: false, code: "DISPERSION_CLIENT_AMBIGUOUS", detail: "Hay varios clientes de PAY0 con ese nombre enlazados a IQ." };
  return { ok: false, code: "DISPERSION_CLIENT_NOT_IDENTIFIED", detail: "No se encontró un cliente de PAY0 enlazado a IQ con ese nombre y de ese dueño." };
}

