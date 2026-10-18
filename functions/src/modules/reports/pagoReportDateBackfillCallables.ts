import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { db, getMyUser, requireAuth, requireRole } from "../sharedCallables/helpers";

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function asTimestamp(value: unknown): admin.firestore.Timestamp | null {
  if (!value) return null;
  if (value instanceof admin.firestore.Timestamp) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return admin.firestore.Timestamp.fromDate(value);
  }
  if (typeof (value as any)?.toDate === "function") {
    const date = (value as any).toDate();
    if (date instanceof Date && Number.isFinite(date.getTime())) {
      return admin.firestore.Timestamp.fromDate(date);
    }
  }
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? admin.firestore.Timestamp.fromDate(date) : null;
}

function resolveReportDate(data: Record<string, unknown>): {
  value: admin.firestore.Timestamp | null;
  source: string | null;
} {
  for (const source of ["fechaPago", "createdAt", "fecha", "updatedAt"]) {
    const value = asTimestamp(data[source]);
    if (value) return { value, source };
  }
  return { value: null, source: null };
}

/**
 * Backfill explícito y reversible por batches para pagos históricos.
 * Por seguridad, dryRun es el valor predeterminado y apply requiere true.
 */
export const backfillPagoReportDates = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const user = await getMyUser(uid);
    if (!user) throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
    requireRole(user, ["superadmin"]);
    assertAuthorized(request.auth, user, {
      allowedRoles: ["superadmin"],
      requiredModule: "reportes",
      requiredAction: "view",
    });

    const rootId = asText(user.rootId || uid) || uid;
    const rawLimit = Number(request.data?.limit ?? 100);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 100, 1), 250);
    const cursor = asText(request.data?.afterPagoId);
    const apply = request.data?.apply === true;

    let query = db
      .collection("pagos")
      .where("rootId", "==", rootId)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(limit);

    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    const candidates = snap.docs
      .map((doc) => {
        const data = (doc.data() || {}) as Record<string, unknown>;
        const resolved = resolveReportDate(data);
        return { doc, hasReportDate: Boolean(data.reportDateAt), ...resolved };
      })
      .filter((item) => !item.hasReportDate && item.value && item.source);

    if (apply && candidates.length) {
      const batch = db.batch();
      candidates.forEach(({ doc, value, source }) => {
        batch.update(doc.ref, {
          reportDateAt: value,
          reportDateSource: source,
          reportDateBackfilledAt: admin.firestore.FieldValue.serverTimestamp(),
          reportDateBackfilledByUid: uid,
        });
      });
      await batch.commit();
    }

    return {
      ok: true,
      dryRun: !apply,
      rootId,
      scanned: snap.size,
      candidates: candidates.length,
      updated: apply ? candidates.length : 0,
      skippedWithoutDate: snap.docs.filter((doc) => {
        const data = (doc.data() || {}) as Record<string, unknown>;
        return !data.reportDateAt && !resolveReportDate(data).value;
      }).length,
      nextAfterPagoId: snap.size === limit ? snap.docs[snap.docs.length - 1].id : null,
    };
  }
);
