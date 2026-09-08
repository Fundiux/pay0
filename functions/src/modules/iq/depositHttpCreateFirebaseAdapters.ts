import { randomUUID } from "node:crypto";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type {
  AttemptJournal,
  AttemptLockAdapter,
  AttemptLockLease,
  IqDepositAttemptState,
  IqDepositRow,
  VoucherInput,
} from "./depositHttpCreateCore";

const LOCK_LEASE_MS = 120_000;
const TERMINAL_CREATION_STATES = new Set([
  "CREATED",
  "CREATED_RECOVERED",
  "IQ_ID_LINKED",
  "TERMINAL_REJECTED",
  "TERMINAL_CANCELLED",
]);

const RETRY_BLOCKING_STATES = new Set([
  "OUTCOME_UNKNOWN",
  "AMBIGUOUS",
  "AMBIGUOUS_CANDIDATES_REVIEW_REQUIRED",
  "TERMINAL_REJECTED",
  "TERMINAL_CANCELLED",
]);

export interface FirebasePagoAdapterContext {
  pagoId: string;
  actorUid: string;
  source: string;
  fingerprint: string;
}

export interface PagoReceiptDescriptor {
  storagePath: string;
  originalName: string;
  mimeType: string;
}

function db(): FirebaseFirestore.Firestore {
  return admin.firestore();
}

function pagoRef(pagoId: string): FirebaseFirestore.DocumentReference {
  return db().collection("pagos").doc(pagoId);
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function asMillis(value: unknown): number | null {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return Number(
      (value as { toMillis: () => number }).toMillis(),
    );
  }

  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalIqId(data: Record<string, unknown>): string {
  return cleanText(
    data.iqDepositId ||
      data.iqDepositFolio ||
      data.iqPagoDepositId ||
      data.iqPagoDepositFolio,
  );
}

function statePatch(
  state: IqDepositAttemptState,
): Record<string, unknown> {
  switch (state) {
    case "PREVALIDATED":
      return {
        iqDepositCreationStatus: "PREVALIDATED_HTTP",
        iqDepositCreationRetryBlocked: false,
      };

    case "POST_IN_PROGRESS":
      return {
        iqDepositCreationStatus: "PROCESSING_HTTP",
        iqDepositCreationRetryBlocked: true,
      };

    case "POST_ACKNOWLEDGED_PENDING_IQ_ID":
      return {
        iqDepositCreationStatus:
          "POST_ACKNOWLEDGED_PENDING_IQ_ID",
        iqDepositCreationRetryBlocked: true,
      };

    case "OUTCOME_UNKNOWN":
      return {
        iqDepositCreationStatus: "OUTCOME_UNKNOWN",
        iqDepositCreationRetryBlocked: true,
        iqDepositFollowupStatus: "REVIEW_REQUIRED",
      };

    case "POST_REJECTED":
      return {
        iqDepositCreationStatus: "POST_REJECTED",
        iqDepositCreationRetryBlocked: false,
        iqDepositFollowupStatus: "ERROR_RETRYABLE",
      };

    case "AMBIGUOUS_CANDIDATES_REVIEW_REQUIRED":
      return {
        iqDepositCreationStatus: "AMBIGUOUS",
        iqDepositCreationRetryBlocked: true,
        iqDepositFollowupStatus: "AMBIGUOUS",
      };

    case "CLOCK_CONTRADICTION_REVIEW_REQUIRED":
      return {
        iqDepositCreationStatus:
          "CLOCK_CONTRADICTION_REVIEW_REQUIRED",
        iqDepositCreationRetryBlocked: true,
        iqDepositFollowupStatus: "REVIEW_REQUIRED",
      };

    case "FAILED_BEFORE_POST":
      return {
        iqDepositCreationStatus: "ERROR_RETRYABLE",
        iqDepositCreationRetryBlocked: false,
        iqDepositFollowupStatus: "ERROR_RETRYABLE",
      };

    case "IQ_ID_LINKED":
      return {
        iqDepositCreationStatus: "CREATED_RECOVERED",
        iqDepositCreationRetryBlocked: false,
        iqDepositFollowupStatus: "LINKED",
      };

    default:
      return {};
  }
}

export function createPagoAttemptLockAdapter(
  context: FirebasePagoAdapterContext,
): AttemptLockAdapter {
  return {
    async acquire(input): Promise<AttemptLockLease> {
      const lockKey =
        `${input.pay0PagoId}:${input.iqAttemptId}`;
      const executionToken = randomUUID();
      const nowMs = Date.now();
      const leaseMs = Math.max(
        10_000,
        Number(input.leaseMs || LOCK_LEASE_MS),
      );
      const leaseExpiresAtMs = nowMs + leaseMs;
      const ref = pagoRef(context.pagoId);

      await db().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);

        if (!snapshot.exists) {
          throw new Error(
            `PAGO_NOT_FOUND: ${context.pagoId}`,
          );
        }

        const data = snapshot.data() as Record<string, unknown>;
        const existingIqId = canonicalIqId(data);
        const currentStatus = cleanText(
          data.iqDepositCreationStatus,
        ).toUpperCase();
        const retryBlocked =
          data.iqDepositCreationRetryBlocked === true;
        const existingFingerprint = cleanText(
          data.iqDepositCreationFingerprint,
        );
        const existingToken = cleanText(
          data.iqDepositCreationExecutionToken,
        );
        const existingExpiryMs = asMillis(
          data.iqDepositCreationLeaseExpiresAt,
        );
        const existingLockActive =
          Boolean(existingToken) &&
          existingExpiryMs !== null &&
          existingExpiryMs > nowMs;

        if (existingIqId) {
          throw new Error(
            `IQ_DEPOSIT_ALREADY_LINKED: ${existingIqId}`,
          );
        }

        if (TERMINAL_CREATION_STATES.has(currentStatus)) {
          throw new Error(
            `IQ_DEPOSIT_TERMINAL_STATE: ${currentStatus}`,
          );
        }

        if (
          retryBlocked ||
          RETRY_BLOCKING_STATES.has(currentStatus)
        ) {
          throw new Error(
            `IQ_DEPOSIT_RETRY_BLOCKED: ${currentStatus || "UNKNOWN"}`,
          );
        }

        if (existingLockActive) {
          throw new Error(
            `IQ_DEPOSIT_CREATION_LOCKED: ${existingToken}`,
          );
        }

        if (
          existingFingerprint &&
          existingFingerprint !== context.fingerprint &&
          currentStatus === "PROCESSING"
        ) {
          throw new Error(
            "IQ_DEPOSIT_FINGERPRINT_CONFLICT",
          );
        }

        transaction.set(
          ref,
          {
            iqDepositCreationStatus: "PROCESSING_HTTP",
            iqDepositCreationExecutionToken: executionToken,
            iqDepositCreationFingerprint:
              context.fingerprint,
            iqDepositCreationStartedAt:
              FieldValue.serverTimestamp(),
            iqDepositCreationStartedBy:
              context.actorUid,
            iqDepositCreationSource: context.source,
            iqDepositCreationLeaseExpiresAt:
              Timestamp.fromMillis(leaseExpiresAtMs),
            iqDepositCreationRetryBlocked: true,
            iqDepositUpdatedAt:
              FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });

      return {
        lockKey,
        lockedAtIso: new Date(nowMs).toISOString(),
        leaseExpiresAtIso:
          new Date(leaseExpiresAtMs).toISOString(),
      };
    },

    async release(lease): Promise<void> {
      const ref = pagoRef(context.pagoId);

      await db().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) {
          return;
        }

        const data = snapshot.data() as Record<string, unknown>;
        const currentStatus = cleanText(
          data.iqDepositCreationStatus,
        ).toUpperCase();

        const preserveBlock =
          currentStatus === "OUTCOME_UNKNOWN" ||
          currentStatus === "AMBIGUOUS" ||
          currentStatus ===
            "AMBIGUOUS_CANDIDATES_REVIEW_REQUIRED" ||
          currentStatus ===
            "CLOCK_CONTRADICTION_REVIEW_REQUIRED" ||
          currentStatus === "TERMINAL_REJECTED" ||
          currentStatus === "TERMINAL_CANCELLED";

        transaction.set(
          ref,
          {
            iqDepositCreationLeaseExpiresAt:
              FieldValue.delete(),
            iqDepositCreationLockReleasedAt:
              FieldValue.serverTimestamp(),
            iqDepositCreationLockKey: lease.lockKey,
            iqDepositCreationRetryBlocked:
              preserveBlock,
            iqDepositUpdatedAt:
              FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });
    },
  };
}

export function createPagoAttemptJournal(
  context: FirebasePagoAdapterContext,
): AttemptJournal {
  return {
    async transition(input): Promise<void> {
      const ref = pagoRef(context.pagoId);
      const patch = input.patch ?? {};

      await ref.set(
        {
          ...statePatch(input.state),
          ...patch,
          iqDepositCreationAttemptId:
            input.iqAttemptId,
          iqDepositCreationPay0PagoId:
            input.pay0PagoId,
          iqDepositCreationSource:
            context.source,
          iqDepositUpdatedAt:
            FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    },

    async linkIqIdWriteOnce(input): Promise<void> {
      const ref = pagoRef(context.pagoId);

      await db().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);

        if (!snapshot.exists) {
          throw new Error(
            `PAGO_NOT_FOUND: ${context.pagoId}`,
          );
        }

        const data = snapshot.data() as Record<string, unknown>;
        const existingIqId = canonicalIqId(data);
        const incomingIqId = String(input.iqId);

        if (
          existingIqId &&
          existingIqId !== incomingIqId
        ) {
          throw new Error(
            `IQ_ID_WRITE_ONCE_CONFLICT: existing=${existingIqId} incoming=${incomingIqId}`,
          );
        }

        const verifiedPayload =
          input.verifiedPayload as IqDepositRow;

        transaction.set(
          ref,
          {
            iqDepositCreationStatus:
              "CREATED_RECOVERED",
            iqDepositCreationRetryBlocked: false,
            iqDepositCreationRecoveredAt:
              FieldValue.serverTimestamp(),
            iqDepositCreationRecoveredBy:
              context.actorUid,
            iqDepositCreationRecoveredSource:
              context.source,
            iqDepositCreationLastError: null,
            iqDepositFollowupStatus: "LINKED",

            iqDepositId: incomingIqId,
            iqDepositFolio: incomingIqId,
            iqPagoDepositId: incomingIqId,
            iqPagoDepositFolio: incomingIqId,

            iqDepositOperationStatus:
              verifiedPayload.operation_status,
            iqDepositConciliationStatus:
              verifiedPayload.conciliation_status,
            iqDepositVerifiedPayload:
              verifiedPayload,
            iqDepositUpdatedAt:
              FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });
    },
  };
}

export async function downloadPagoVoucherFromStorage(
  descriptor: PagoReceiptDescriptor,
): Promise<VoucherInput> {
  const storagePath = cleanText(descriptor.storagePath);
  const originalName = cleanText(descriptor.originalName);
  const mimeType = cleanText(descriptor.mimeType);

  if (!storagePath) {
    throw new Error("PAGO_VOUCHER_STORAGE_PATH_REQUIRED");
  }

  if (!originalName) {
    throw new Error("PAGO_VOUCHER_ORIGINAL_NAME_REQUIRED");
  }

  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new Error(
      `PAGO_VOUCHER_NOT_FOUND: ${storagePath}`,
    );
  }

  const [metadata] = await file.getMetadata();
  const [buffer] = await file.download();

  if (!buffer || buffer.byteLength < 1) {
    throw new Error(
      `PAGO_VOUCHER_EMPTY: ${storagePath}`,
    );
  }

  return {
    bytes: new Uint8Array(buffer),
    originalName,
    mimeType:
      mimeType ||
      cleanText(metadata.contentType) ||
      "application/octet-stream",
  };
}

export function buildPagoDepositFingerprint(input: {
  partnerId: number;
  clientId: number;
  companyId: number;
  operationTypeId: number;
  saleType: string;
  sum: number;
  currency: string;
  voucherSha256: string;
}): string {
  const canonical = [
    input.partnerId,
    input.clientId,
    input.companyId,
    input.operationTypeId,
    cleanText(input.saleType).toLowerCase(),
    Number(input.sum).toFixed(2),
    cleanText(input.currency).toLowerCase(),
    cleanText(input.voucherSha256).toLowerCase(),
  ].join("|");

  return admin
    .app()
    .options.projectId
    ? require("node:crypto")
        .createHash("sha256")
        .update(canonical)
        .digest("hex")
    : canonical;
}