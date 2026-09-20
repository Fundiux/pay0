import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { db } from "../sharedCallables/helpers";
import { buildControlCenterSnapshot } from "./callables";
import { ANALYTIC_SOURCES, AnalyticSource, projectSource } from "./projections";

type ChangeLike = { before?: { exists?: boolean; data?: () => any }; after?: { exists?: boolean; data?: () => any } };

const clean = (value: unknown) => String(value ?? "").trim();

export async function markControlCenterDirty(change: ChangeLike, module: string, documentId: string) {
  const after = change.after?.exists ? change.after.data?.() || {} : {};
  const before = change.before?.exists ? change.before.data?.() || {} : {};
  const rootId = clean(after.rootId || before.rootId);
  if (!rootId) return;

  await db.collection("controlCenterDirtyRoots").doc(rootId).set({
    rootId,
    modules: FieldValue.arrayUnion(module),
    lastDocumentId: documentId,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

function dirtyTrigger(path: string, module: string) {
  return onDocumentWritten({ document: path, region: "us-central1", memory: "512MiB", retry: true }, async (event) => {
    if (!event.data) return;
    const source = path.split("/")[0] as AnalyticSource;
    if ((ANALYTIC_SOURCES as readonly string[]).includes(source)) await projectSource(source, event.params.documentId);
    await markControlCenterDirty(event.data, module, clean(event.params.documentId));
  });
}

export const queueControlCenterSolicitud = dirtyTrigger("solicitudes/{documentId}", "solicitudes");
export const queueControlCenterPago = dirtyTrigger("pagos/{documentId}", "pagos");
export const queueControlCenterFacturama = dirtyTrigger("facturamaInvoices/{documentId}", "facturama");
export const queueControlCenterMateriality = dirtyTrigger("materialityOperations/{documentId}", "materialidad");
export const queueControlCenterDispersion = dirtyTrigger("clientDispersions/{documentId}", "wallet");
export const queueControlCenterHugo = dirtyTrigger("agent007Recommendations/{documentId}", "hugo");
export const queueControlCenterApplications = dirtyTrigger("pagoAplicaciones/{documentId}", "pagos");
export const queueControlCenterBalances = dirtyTrigger("balanceAccounts/{documentId}", "wallet");
export const queueControlCenterMovements = dirtyTrigger("balanceMovements/{documentId}", "wallet");
export const queueControlCenterAdvances = dirtyTrigger("clientAdvances/{documentId}", "wallet");
export const queueControlCenterLearning = dirtyTrigger("agent007LearnedRules/{documentId}", "hugo");
export const queueControlCenterRecovery = dirtyTrigger("operationRecoveryJobs/{documentId}", "recuperacion");
export const queueControlCenterExpenses = dirtyTrigger("recognizedExpenses/{documentId}", "gastos");
export const queueControlCenterIqInvoice = dirtyTrigger("iqInvoiceJobs/{documentId}", "iq");
export const queueControlCenterIqCreate = dirtyTrigger("iqCreateJobs/{documentId}", "iq");
export const queueControlCenterIqStatus = dirtyTrigger("iqStatusJobs/{documentId}", "iq");
export const queueControlCenterIqReceipt = dirtyTrigger("iqPagoReceiptJobs/{documentId}", "iq");
export const queueControlCenterIqDeposit = dirtyTrigger("iqPagoDepositStatusJobs/{documentId}", "iq");
export const queueControlCenterWhatsapp = dirtyTrigger("documentDeliveryJobs/{documentId}", "whatsapp");
export const queueControlCenterTelegram = dirtyTrigger("telegramClientNotificationEvents/{documentId}", "telegram");

export async function reconcileDirtyControlCenterRoots() {
  const dirtySnap = await db.collection("controlCenterDirtyRoots").orderBy("updatedAt", "asc").limit(25).get();

  for (const dirtyDoc of dirtySnap.docs) {
    const dirty = dirtyDoc.data() || {};
    const rootId = clean(dirty.rootId || dirtyDoc.id);
    if (!rootId) continue;
    const claimedAt = dirty.updatedAt instanceof Timestamp ? dirty.updatedAt.toMillis() : 0;

    try {
      await buildControlCenterSnapshot(rootId, "SYSTEM_CONTROL_CENTER_RECONCILIATION");
      await db.runTransaction(async (tx) => {
        const current = await tx.get(dirtyDoc.ref);
        if (!current.exists) return;
        const currentAt = current.data()?.updatedAt;
        const currentMillis = currentAt instanceof Timestamp ? currentAt.toMillis() : 0;
        if (currentMillis <= claimedAt) tx.delete(dirtyDoc.ref);
      });
    } catch (error) {
      console.error("[ControlCenter] reconciliation failed", { rootId, error });
      await dirtyDoc.ref.set({ attempts: FieldValue.increment(1), lastErrorAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }
}

export const reconcileDirtyControlCenters = onSchedule({
  schedule: "every 15 minutes",
  timeZone: "America/Mexico_City",
  region: "us-central1",
  timeoutSeconds: 540,
  memory: "1GiB",
}, reconcileDirtyControlCenterRoots);
