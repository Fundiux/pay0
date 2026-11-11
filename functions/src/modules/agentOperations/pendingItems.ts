import * as admin from "firebase-admin";
import { onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { cashReceiptStatusOf, CASH_RECEIPT_STATUS } from "../dispersionCashReceipt/domain";
import { getMyUser, getRootId, requireAuth } from "../sharedCallables/helpers";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** A requested complement that IQ has not delivered after this many days is reported as late. */
export const COMPLEMENT_LATE_DAYS = 5;
const HELD_COMPLEMENT_STATUSES = ["PAUSED", "BLOCKED", "UNKNOWN", "REQUEST_STATE_UNKNOWN"];

export type PendingItems = {
  /** Complement jobs held (paused, blocked or in an unknown state). */
  complementsHeld?: number;
  /** Complements requested more than COMPLEMENT_LATE_DAYS ago that have not arrived. */
  complementsLate?: number;
  /** Cash dispersions registered whose signed receipt is still missing. */
  cashUnsigned?: number;
  /** Solicitudes whose IQ cancellation was confirmed and awaits review. */
  cancellationReview?: number;
};

/** Cash dispersions read per root; the receipt rules (users paid in cash are exempt) cannot be expressed in a count query. */
const CASH_READ_LIMIT = 500;
async function countUnsignedCash(rootId: string): Promise<number> {
  const snapshot = await db.collection("clientDispersions").where("rootId", "==", rootId).where("cashReceiptStatus", "==", CASH_RECEIPT_STATUS.PENDING)
    .where("status", "==", "REGISTRADA").limit(CASH_READ_LIMIT).get();
  if (snapshot.size >= CASH_READ_LIMIT) console.error("PENDING_CASH_READ_LIMIT_REACHED", CASH_READ_LIMIT);
  return snapshot.docs.filter(doc => cashReceiptStatusOf(doc.data()) === CASH_RECEIPT_STATUS.PENDING).length;
}

const countOf = async (query: FirebaseFirestore.Query) => (await query.count().get()).data().count;

/**
 * Root-scoped counts for the daily summary and the dashboard. Each count is read on its own so one
 * failing query leaves only its own figure out instead of dropping the whole report.
 */
export async function loadPendingItems(rootId: string, now = Date.now()): Promise<PendingItems> {
  const late = admin.firestore.Timestamp.fromMillis(now - COMPLEMENT_LATE_DAYS * 24 * 3600_000);
  const readers: Array<[keyof PendingItems, () => Promise<number>]> = [
    ["complementsHeld", () => countOf(db.collection("paymentComplementJobs").where("rootId", "==", rootId).where("status", "in", HELD_COMPLEMENT_STATUSES))],
    ["complementsLate", () => countOf(db.collection("paymentComplementJobs").where("rootId", "==", rootId).where("status", "==", "REQUESTED").where("requestedAt", "<", late))],
    ["cashUnsigned", () => countUnsignedCash(rootId)],
    ["cancellationReview", () => countOf(db.collection("solicitudes").where("rootId", "==", rootId).where("iqCancellationStatus", "==", "CONFIRMED_REVIEW_REQUIRED"))],
  ];
  const result: PendingItems = {};
  await Promise.all(readers.map(async ([key, read]) => {
    try { result[key] = await read(); }
    catch (error) { console.error("PENDING_ITEM_COUNT_FAILED", key, String((error as Error)?.message || error).slice(0, 200)); }
  }));
  return result;
}

/** Same authorization as the agent operations report: the superadmin of the root. */
export const getPendingOperationsSummary = onCall({ cors: true, region: "us-central1", timeoutSeconds: 60, memory: "256MiB" }, async request => {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"], requiredModule: "solicitudes", requiredAction: "view" });
  return { ok: true, items: await loadPendingItems(await getRootId(uid)) };
});
