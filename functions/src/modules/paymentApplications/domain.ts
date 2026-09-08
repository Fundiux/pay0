import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { money2 } from "../shared/money";

export const PAYMENT_APPLICATION_VERSION = "H4_D66_A1_V1" as const;
export const PAYMENT_APPLICATION_IQ_PLAN_VERSION = "H4_D66_A2_V1" as const;
export const PAYMENT_APPLICATION_IQ_EXECUTION_VERSION = "H4_D66_A3_V1" as const;
export const MAX_PAYMENT_APPLICATIONS_PER_BATCH = 50;

export type PaymentApplicationInvoiceType = "PUE" | "PPD";

export function normalizePaymentApplicationInvoiceType(
  value: unknown,
): PaymentApplicationInvoiceType | null {
  const raw = String(value ?? "").trim().toUpperCase();

  if (raw === "PUE") return "PUE";
  if (raw === "PPD") return "PPD";

  return null;
}
export type PaymentApplicationPueSettlementStatus =
  | "NOT_APPLICABLE"
  | "LIQUIDATED"
  | "PARTIAL_PENDING_SAME_MONTH";

export type PaymentApplicationSettlementPolicy =
  | "PUE_NO_COMPLEMENT_SAME_MONTH"
  | "PPD_COMPLEMENT_REQUIRED";

export type PaymentApplicationNextStep =
  | "FINALIZE_APPLICATION"
  | "CONTINUE_PUE_PAYMENTS_WITHIN_MONTH"
  | "CREATE_PAYMENT_COMPLEMENT_AFTER_APPLICATION";

export type PaymentApplicationSettlementDecision = {
  requiresComplement: boolean;
  requiresSameMonthSettlement: boolean;
  pueSettlementStatus: PaymentApplicationPueSettlementStatus;
  settlementPolicy: PaymentApplicationSettlementPolicy;
  nextStep: PaymentApplicationNextStep;
};

export function buildPaymentApplicationSettlementPolicy(params: {
  invoiceType: PaymentApplicationInvoiceType;
  balanceAfter: number;
}): PaymentApplicationSettlementDecision {
  const balanceAfter = money2(params.balanceAfter);
  const isPpd = params.invoiceType === "PPD";
  const puePartial = params.invoiceType === "PUE" && balanceAfter > 0;

  return {
    requiresComplement: isPpd,
    requiresSameMonthSettlement: puePartial,
    pueSettlementStatus:
      params.invoiceType === "PUE"
        ? (puePartial ? "PARTIAL_PENDING_SAME_MONTH" : "LIQUIDATED")
        : "NOT_APPLICABLE",
    settlementPolicy: isPpd
      ? "PPD_COMPLEMENT_REQUIRED"
      : "PUE_NO_COMPLEMENT_SAME_MONTH",
    nextStep: isPpd
      ? "CREATE_PAYMENT_COMPLEMENT_AFTER_APPLICATION"
      : puePartial
        ? "CONTINUE_PUE_PAYMENTS_WITHIN_MONTH"
        : "FINALIZE_APPLICATION",
  };
}

export type PaymentApplicationInput = {
  solicitudId: string;
  montoAplicado: number;
};

export type NormalizedPaymentApplicationBatch = {
  pagoId: string;
  idempotencyKey: string;
  applications: PaymentApplicationInput[];
  totalAmount: number;
  requestHash: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cleanId(value: unknown, fieldName: string): string {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) {
    throw new HttpsError("invalid-argument", `${fieldName} requerido.`);
  }
  if (cleaned.length > 200) {
    throw new HttpsError("invalid-argument", `${fieldName} excede la longitud permitida.`);
  }
  return cleaned;
}

function parsePositiveMoney(value: unknown, fieldName: string): number {
  const cleaned = String(value ?? "").replace(/[$,\s]/g, "").trim();
  const parsed = Number(cleaned);
  const amount = money2(parsed);

  if (!Number.isFinite(parsed) || amount <= 0) {
    throw new HttpsError("invalid-argument", `${fieldName} invalido.`);
  }

  return amount;
}

export function normalizePaymentApplicationBatchInput(input: any): NormalizedPaymentApplicationBatch {
  const pagoId = cleanId(input?.pagoId, "pagoId");
  const idempotencyKey = cleanId(input?.idempotencyKey, "idempotencyKey");

  if (idempotencyKey.length < 8) {
    throw new HttpsError("invalid-argument", "idempotencyKey debe tener al menos 8 caracteres.");
  }

  const rawApplications = Array.isArray(input?.aplicaciones)
    ? input.aplicaciones
    : Array.isArray(input?.applications)
      ? input.applications
      : [];

  if (rawApplications.length === 0) {
    throw new HttpsError("invalid-argument", "Captura al menos una aplicacion.");
  }

  if (rawApplications.length > MAX_PAYMENT_APPLICATIONS_PER_BATCH) {
    throw new HttpsError(
      "invalid-argument",
      `No se pueden aplicar mas de ${MAX_PAYMENT_APPLICATIONS_PER_BATCH} solicitudes por lote.`,
    );
  }

  const seen = new Set<string>();
  const applications: PaymentApplicationInput[] = rawApplications.map((item: any, index: number) => {
    const solicitudId = cleanId(item?.solicitudId, `aplicaciones[${index}].solicitudId`);
    if (seen.has(solicitudId)) {
      throw new HttpsError(
        "invalid-argument",
        `La solicitud ${solicitudId} esta repetida en el mismo lote.`,
      );
    }
    seen.add(solicitudId);

    return {
      solicitudId,
      montoAplicado: parsePositiveMoney(
        item?.montoAplicado,
        `aplicaciones[${index}].montoAplicado`,
      ),
    };
  });

  applications.sort((a, b) => a.solicitudId.localeCompare(b.solicitudId));

  const totalAmount = money2(
    applications.reduce((sum, item) => sum + item.montoAplicado, 0),
  );

  const requestHash = sha256(JSON.stringify({
    version: PAYMENT_APPLICATION_VERSION,
    pagoId,
    applications,
    totalAmount,
  }));

  return {
    pagoId,
    idempotencyKey,
    applications,
    totalAmount,
    requestHash,
  };
}

export function buildPaymentApplicationReservationId(params: {
  rootId: string;
  pagoId: string;
  idempotencyKey: string;
}): string {
  const rootId = cleanId(params.rootId, "rootId");
  const pagoId = cleanId(params.pagoId, "pagoId");
  const idempotencyKey = cleanId(params.idempotencyKey, "idempotencyKey");
  return `par_${sha256(`${PAYMENT_APPLICATION_VERSION}|${rootId}|${pagoId}|${idempotencyKey}`).slice(0, 56)}`;
}

export function buildPaymentApplicationDocumentId(
  reservationId: string,
  solicitudId: string,
): string {
  return `pap_${sha256(`${reservationId}|${solicitudId}`).slice(0, 52)}`;
}

export function buildPaymentApplicationLedgerId(applicationId: string): string {
  return `pal_${sha256(`${PAYMENT_APPLICATION_VERSION}|${applicationId}|ledger`).slice(0, 52)}`;
}

export function buildPaymentApplicationNoteId(
  reservationId: string,
  entityId: string,
): string {
  return `pan_${sha256(`${reservationId}|${entityId}|note`).slice(0, 52)}`;
}


export function buildPaymentApplicationIqPlanId(reservationId: string): string {
  return `paiqp_${sha256(`${PAYMENT_APPLICATION_IQ_PLAN_VERSION}|${cleanId(reservationId, "reservationId")}`).slice(0, 52)}`;
}

export function buildPaymentApplicationIqPlanItemId(
  planId: string,
  applicationId: string,
): string {
  return `paiqi_${sha256(`${cleanId(planId, "planId")}|${cleanId(applicationId, "applicationId")}`).slice(0, 52)}`;
}

export function buildPaymentApplicationIqAttemptId(planItemId: string): string {
  return `paiqa_${sha256(`${PAYMENT_APPLICATION_IQ_PLAN_VERSION}|${cleanId(planItemId, "planItemId")}|PREVALIDATION`).slice(0, 52)}`;
}


export function buildPaymentApplicationIqExecutionAttemptId(
  planId: string,
  attemptNumber: number,
): string {
  const normalizedAttempt = Math.max(1, Math.floor(Number(attemptNumber) || 1));
  return `paixe_${sha256(`${PAYMENT_APPLICATION_IQ_EXECUTION_VERSION}|${cleanId(planId, "planId")}|${normalizedAttempt}`).slice(0, 52)}`;
}

export function buildPaymentApplicationIqLockId(rootId: string, solicitudId: string): string {
  return `paiql_${sha256(`${PAYMENT_APPLICATION_IQ_PLAN_VERSION}|${cleanId(rootId, "rootId")}|${cleanId(solicitudId, "solicitudId")}`).slice(0, 52)}`;
}

export function buildPaymentApplicationIqPlanHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

export function buildPaymentApplicationActivityId(
  applicationId: string,
  event: "APPLIED" | "COMPLETED",
): string {
  return `paa_${sha256(`${applicationId}|${event}`).slice(0, 52)}`;
}