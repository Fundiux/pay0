import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { db, getMyUser, requireAuth } from "../sharedCallables/helpers";
import { assertPay0Issuer } from "./issuerGuard";
import { ensureAutomaticFacturamaDraftForSolicitud } from "./service";

const REVALIDATABLE = new Set(["COMPANY_SAT_KEY_NOT_AUTHORIZED", "PENDING_GLOBAL_SAT_CATALOG"]);
const PAGE_SIZE = 25;

function clean(value: unknown, max = 128): string {
  return String(value ?? "").trim().slice(0, max);
}

export const revalidateFacturamaFiscalDrafts = onCall(
  { region: "us-central1", timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const user = await getMyUser(uid);
    assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
    const rootId = clean(user?.rootId || uid);
    const companyId = clean(request.data?.companyId);
    const cursorId = clean(request.data?.cursorId);
    if (!companyId) throw new HttpsError("invalid-argument", "Selecciona la empresa emisora.");
    await assertPay0Issuer({ db, rootId, companyId, requireCsd: false });

    let query = db.collection("facturamaInvoices")
      .where("rootId", "==", rootId)
      .where("companyId", "==", companyId)
      .orderBy("createdAt", "desc")
      .limit(PAGE_SIZE);
    if (cursorId) {
      const cursor = await db.doc(`facturamaInvoices/${cursorId}`).get();
      if (!cursor.exists || cursor.get("rootId") !== rootId || cursor.get("companyId") !== companyId || !cursor.get("createdAt")) {
        throw new HttpsError("invalid-argument", "Continuación de revisión inválida.");
      }
      query = query.startAfter(cursor);
    }
    const page = await query.get();
    let reviewed = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    for (const doc of page.docs) {
      const invoice: any = doc.data() || {};
      if (invoice.status !== "AUTO_DRAFT_FISCAL_REVIEW" || !REVALIDATABLE.has(clean(invoice.fiscalValidation?.status, 80)) || !invoice.sourceSolicitudId) {
        skipped++;
        continue;
      }
      reviewed++;
      try {
        const result = await ensureAutomaticFacturamaDraftForSolicitud({
          auth: request.auth,
          solicitudId: clean(invoice.sourceSolicitudId),
          source: "SAT_CATALOG_REVALIDATION",
        });
        if (result.ok && !result.skipped && result.status === "AUTO_DRAFT_FISCAL_VALIDATED") updated++;
        else skipped++;
      } catch {
        failed++;
      }
    }
    return {
      ok: true, reviewed, updated, skipped, failed,
      nextCursorId: page.size === PAGE_SIZE ? page.docs[page.docs.length - 1].id : null,
    };
  },
);
