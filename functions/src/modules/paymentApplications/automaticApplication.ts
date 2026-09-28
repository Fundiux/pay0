import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { db, getActivityAdminId, getRootId } from "../sharedCallables/helpers";
import { applyPaymentApplicationBatchAtomic, type PaymentApplicationActor } from "./service";
import { AUTOMATIC_CANDIDATE_LIMIT, automaticPaymentSourceDigest, decideAutomaticPayment, isAutomaticPaymentReady } from "./automaticDomain";

const clean = (value: unknown) => String(value ?? "").trim();
const permanent = new Set(["permission-denied", "unauthenticated", "not-found", "failed-precondition", "invalid-argument", "already-exists"]);

async function recordDecision(pagoId: string, sourceDigest: string, patch: Record<string, unknown>) {
  const ref = db.doc(`pagos/${pagoId}`);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref), data = snapshot.data();
    if (!data || automaticPaymentSourceDigest(data) !== sourceDigest) return;
    const current = data.automaticApplication || {};
    if (current.sourceDigest === sourceDigest && current.status === patch.status && current.reason === patch.reason) return;
    tx.update(ref, { automaticApplication: { ...patch, sourceDigest, updatedAt: FieldValue.serverTimestamp() } });
  });
}

/** Uses the financial application transaction; this service never calls IQ. */
export async function applyAutomaticPayment(pagoId: string, options: { retryReview?: boolean } = {}) {
  const ref = db.doc(`pagos/${pagoId}`), snapshot = await ref.get(), pago = snapshot.data();
  if (!pago || !isAutomaticPaymentReady(pago)) return { status: "WAITING" };
  const sourceDigest = automaticPaymentSourceDigest(pago);
  if (!options.retryReview && pago.automaticApplication?.sourceDigest === sourceDigest && pago.automaticApplication?.status === "REQUIRES_REVIEW") return { status: "REQUIRES_REVIEW" };
  try {
    const receipts = await db.collection("uploads").where("pagoId", "==", pagoId).where("documentType", "==", "COMPROBANTE_PAGO").where("active", "==", true).limit(10).get();
    if (!receipts.docs.some(doc => doc.get("rootId") === pago.rootId && doc.get("status") === "READY" && doc.get("storagePath"))) return { status: "WAITING", reason: "RECEIPT_NOT_READY" };
    const uid = clean(pago.createdBy), user = (await db.doc(`users/${uid}`).get()).data();
    if (!user) throw new HttpsError("permission-denied", "Usuario de origen no disponible.");
    const role = assertAuthorized({ uid }, user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "pagos", requiredAction: ["create", "conciliate"] }) as PaymentApplicationActor["role"];
    if (await getRootId(uid) !== pago.rootId) throw new HttpsError("permission-denied", "Usuario fuera del root del pago.");
    const actor: PaymentApplicationActor = { uid, rootId: pago.rootId, role,
      adminId: getActivityAdminId(user, uid, pago.rootId), displayName: clean(user.name || user.displayName), username: clean(user.username) };
    const candidates = await db.collection("solicitudes").where("rootId", "==", pago.rootId).where("clienteId", "==", pago.clienteId).limit(AUTOMATIC_CANDIDATE_LIMIT + 1).get();
    const decision = decideAutomaticPayment(pagoId, pago, candidates.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    if (!decision.batch) {
      await recordDecision(pagoId, sourceDigest, { status: decision.status, reason: decision.reason, matchedCount: decision.matchedCount });
      return { status: decision.status, reason: decision.reason };
    }
    const result = await applyPaymentApplicationBatchAtomic({ actor, batch: decision.batch, automaticSourceDigest: sourceDigest });
    // The canonical transaction records the result together with the balances.
    return { status: "APPLIED", reservationId: result.reservationId, reused: result.reused };
  } catch (error) {
    const code = String((error as { code?: unknown })?.code || "");
    if (!permanent.has(code)) throw error;
    await recordDecision(pagoId, sourceDigest, { status: "REQUIRES_REVIEW", reason: `APPLICATION_${code.toUpperCase().replace(/-/g, "_")}` });
    return { status: "REQUIRES_REVIEW" };
  }
}

export const applyPaymentAutomaticallyOnReconciliation = onDocumentWritten(
  { document: "pagos/{pagoId}", region: "us-central1", retry: true, timeoutSeconds: 120, memory: "256MiB", maxInstances: 2 },
  async event => {
    const before = event.data?.before.data() || {}, after = event.data?.after.data() || {};
    if (!event.data?.after.exists || !isAutomaticPaymentReady(after) || automaticPaymentSourceDigest(before) === automaticPaymentSourceDigest(after)) return;
    // Transient delivery failures recover for a bounded period; old events must
    // not create indefinite billing or replay historical financial operations.
    const created = Date.parse(event.time);
    if (!Number.isFinite(created) || Date.now() - created > 20 * 60_000) return;
    await applyAutomaticPayment(event.params.pagoId);
  },
);

export const applyPaymentAutomaticallyOnReceipt = onDocumentWritten(
  { document: "uploads/{uploadId}", region: "us-central1", retry: true, timeoutSeconds: 120, memory: "256MiB", maxInstances: 2 },
  async event => {
    const before = event.data?.before.data() || {}, after = event.data?.after.data() || {};
    if (!event.data?.after.exists || after.documentType !== "COMPROBANTE_PAGO" || after.status !== "READY" || after.active !== true || !clean(after.pagoId)) return;
    if (before.status === after.status && before.active === after.active && before.sha256 === after.sha256) return;
    const created = Date.parse(event.time);
    if (!Number.isFinite(created) || Date.now() - created > 20 * 60_000) return;
    const pago = (await db.doc(`pagos/${after.pagoId}`).get()).data();
    if (!pago || pago.rootId !== after.rootId) return;
    await applyAutomaticPayment(after.pagoId, { retryReview: true });
  },
);

export const applyPaymentsAutomaticallyOnInvoice = onDocumentWritten(
  { document: "solicitudes/{solicitudId}", region: "us-central1", retry: true, timeoutSeconds: 120, memory: "256MiB", maxInstances: 2 },
  async event => {
    const before = event.data?.before.data() || {}, after = event.data?.after.data() || {};
    if (!event.data?.after.exists || !clean(after.rootId) || !clean(after.clienteId) || !clean(after.facturaUuid || after.uuidCfdi)) return;
    if (!["facturaUuid", "uuidCfdi", "facturaSerie", "facturaFolio", "facturamaEnvironment", "facturamaAutoDraftStatus", "facturaMetadataSource", "facturaUuidSandbox"].some(key => before[key] !== after[key])) return;
    const created = Date.parse(event.time);
    if (!Number.isFinite(created) || Date.now() - created > 20 * 60_000) return;
    const payments = await db.collection("pagos").where("rootId", "==", after.rootId).where("clienteId", "==", after.clienteId).where("automaticApplicationEligible", "==", true).limit(101).get();
    if (payments.size > 100) return;
    for (const payment of payments.docs) if (isAutomaticPaymentReady(payment.data())) await applyAutomaticPayment(payment.id, { retryReview: true });
  },
);
