import * as admin from "firebase-admin";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import { isIqDailySyncImport } from "../iq/historicalImportGuard";
import { groupLabel } from "./reviewDisplay";
import { BACKFILL_DEFAULT_END_DATE, BACKFILL_DEFAULT_START_MONTH, configRef } from "./backfill";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const text = (value: unknown) => String(value ?? "").trim();
const OPTIONS = { cors: true, region: "us-central1", timeoutSeconds: 120, memory: "512MiB" } as const;
const MAX_SCAN = 5000;

async function superadminRoot(request: CallableRequest<any>) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"], requiredModule: "wallet", requiredAction: "saldos" });
  if (getUserRole(user) !== "superadmin") throw new HttpsError("permission-denied", "Solo el superadministrador.");
  return { uid, rootId: text(user?.rootId) || uid };
}

/** Where the historical backfill stands: the switch, the month it is on and one row per month. */
export const getIqBackfillStatus = onCall(OPTIONS, async (request) => {
  const { rootId } = await superadminRoot(request);
  const [cfg, months] = await Promise.all([configRef(rootId).get(), db.collection("iqBackfillMonths").where("rootId", "==", rootId).limit(60).get()]);
  const c = cfg.data() || {};
  return {
    ok: true,
    enabled: c.enabled === true,
    status: text(c.status) || "SIN_INICIAR",
    startMonth: text(c.startMonth) || BACKFILL_DEFAULT_START_MONTH,
    endDate: text(c.endDate) || BACKFILL_DEFAULT_END_DATE,
    cursorMonth: text(c.cursorMonth) || null,
    months: months.docs.map((doc) => { const d = doc.data(); return { month: text(d.month), status: text(d.status), openReviews: typeof d.openReviews === "number" ? d.openReviews : null, runs: Number(d.runs) || 0, lastRunAtMs: d.lastRunAt?.toMillis?.() ?? null, created: d.lastRunCreated || {} }; })
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
});

/** Turns the backfill on or off. Off keeps everything already imported. */
export const setIqBackfillEnabled = onCall(OPTIONS, async (request) => {
  const { uid, rootId } = await superadminRoot(request);
  const enabled = request.data?.enabled === true;
  await configRef(rootId).set({ rootId, enabled, ...(enabled ? { status: "RUNNING" } : { status: "PAUSED" }), startMonth: BACKFILL_DEFAULT_START_MONTH, endDate: BACKFILL_DEFAULT_END_DATE, updatedBy: uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, enabled };
});

const clientOf = (d: Record<string, any>) => text(d.clienteNombre || d.clientName || d.clientNombre) || null;
const dateOf = (d: Record<string, any>) => { const ms = d.createdAt?.toMillis?.(); return ms ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(ms)) : null; };

/**
 * The files IQ did not give back after the backfill tried: invoices (PDF and XML) of recovered solicitudes and receipts of recovered
 * dispersions that are still missing. It is the list to ask IQ for directly. No document ids; the number IQ shows for each one.
 */
export const getIqBackfillMissingDocuments = onCall(OPTIONS, async (request) => {
  const { rootId } = await superadminRoot(request);
  const rows: Array<Record<string, unknown>> = [];
  const sols = await db.collection("solicitudes").where("rootId", "==", rootId).where("source", "==", "IQ_IMPORT").limit(MAX_SCAN).get();
  for (const doc of sols.docs) {
    const d = doc.data();
    if (!isIqDailySyncImport(d) || text(d.invoiceStatus).toUpperCase() !== "INVOICED") continue;
    if (text(d.iqInvoiceImportStatus) === "IMPORTED" || (text(d.iqInvoicePdfUploadId) && text(d.iqInvoiceXmlUploadId)) || (text(d.facturaPdfUploadId) && text(d.facturaXmlUploadId))) continue;
    const queue = await db.doc(`iqInvoiceJobs/invoice_${doc.id}`).get().catch(() => null);
    rows.push({ kind: "Factura (PDF y XML)", iqNumber: text(d.iqId || d.originalIqEntityId), iqFolio: text(d.iqFolio) || null, clientName: clientOf(d), date: dateOf(d), amount: typeof d.monto === "number" ? d.monto : null, partner: groupLabel(text(d.canonicalIqGroupId)),
      attempts: Number(queue?.get("attemptCount")) || 0, reason: text(d.iqInvoiceImportLastError || queue?.get("lastError")) || "IQ no entregó la factura todavía." });
  }
  const disp = await db.collection("clientDispersions").where("rootId", "==", rootId).where("source", "==", "IQ_IMPORT").limit(MAX_SCAN).get();
  for (const doc of disp.docs) {
    const d = doc.data();
    if (!isIqDailySyncImport(d) || text(d.iqReceiptStatus) === "READY" || text(d.iqReceiptUploadId)) continue;
    rows.push({ kind: "Comprobante de dispersión", iqNumber: text(d.iqDispersionId || d.originalIqEntityId), iqFolio: null, clientName: clientOf(d), date: dateOf(d), amount: typeof d.amount === "number" ? d.amount : null, partner: groupLabel(text(d.canonicalIqGroupId)),
      attempts: Number(d.iqReceiptAutoAttempts) || 0, reason: text(d.iqReceiptAutoError) || "Todavía no se ha intentado traer el comprobante." });
  }
  rows.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.kind).localeCompare(String(b.kind), "es"));
  return { ok: true, truncated: sols.size >= MAX_SCAN || disp.size >= MAX_SCAN, total: rows.length, rows };
});
