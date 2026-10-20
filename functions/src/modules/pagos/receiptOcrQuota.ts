import { createHash } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";

// Fixed-size server-only records; no cleanup job is required for enforcement.
// A reservation covers one parse and at most five PDF pages sent to Vision.
export const RECEIPT_PROCESSING_LIMITS = Object.freeze({
  windowMs: 60 * 60 * 1000,
  actor: 60,
  root: 600,
  pdfPages: 5,
});

function quotaId(scope: string, value: string): string {
  return `${scope}_${createHash("sha256").update(value).digest("hex")}`;
}

export async function reserveReceiptProcessing(
  db: Firestore,
  auth: { uid: string } | undefined,
  nowMs = Date.now(),
): Promise<void> {
  const uid = auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sesion requerida.");
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new HttpsError("internal", "No se pudo verificar el limite de lectura.");
  }
  await db.runTransaction(async (tx) => {
    // Reading the profile in the reservation transaction also retries on a
    // concurrent permission/root change before accepting the reservation.
    const profile = await tx.get(db.doc(`users/${uid}`));
    const user = profile.exists ? profile.data() : undefined;
    assertAuthorized(auth, user, {
      allowedRoles: ["superadmin", "admin", "operador"],
      requiredModule: "pagos",
      requiredAction: "create",
    });
    // Same server-owned legacy root fallback as createPago; never request.data.
    const rootId = String(user?.rootId || uid).trim();
    if (!rootId) throw new HttpsError("permission-denied", "Perfil no autorizado.");
    const scopes = [
      { id: quotaId("actor", uid), limit: RECEIPT_PROCESSING_LIMITS.actor },
      { id: quotaId("root", rootId), limit: RECEIPT_PROCESSING_LIMITS.root },
    ];
    const refs = scopes.map(({ id }) => db.doc(`receiptProcessingQuotas/${id}`));
    const snapshots = await tx.getAll(...refs);
    const next = snapshots.map((snapshot, i) => {
      const state = snapshot.exists ? snapshot.data() : undefined;
      let windowStartedAtMs = nowMs;
      let used = 0;
      if (state) {
        if (!Number.isSafeInteger(state.windowStartedAtMs) || state.windowStartedAtMs < 0 ||
            !Number.isSafeInteger(state.used) || state.used < 0 || state.windowStartedAtMs > nowMs) {
          throw new HttpsError("resource-exhausted", "Limite de lectura no disponible. Contacta a soporte.");
        }
        if (nowMs - state.windowStartedAtMs < RECEIPT_PROCESSING_LIMITS.windowMs) {
          windowStartedAtMs = state.windowStartedAtMs;
          used = state.used;
        }
      }
      if (used >= scopes[i].limit) {
        throw new HttpsError("resource-exhausted", "Se alcanzo el limite de lectura de comprobantes. Intenta mas tarde.");
      }
      return { version: 1, windowStartedAtMs, used: used + 1 };
    });
    next.forEach((state, i) => tx.set(refs[i], state));
  });
}
