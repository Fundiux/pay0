import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { db } from "../sharedCallables/helpers";
import { reconcileAgent007Recommendations } from "./reconciliation";

function relevant(kind: "solicitud" | "pago", before: any, after: any) {
  if (!before?.rootId || !after?.rootId || before.rootId !== after.rootId) return false;
  const fields = kind === "solicitud" ? ["status", "facturamaStatus", "invoiceStatus", "facturaUuid", "uuidCfdi", "iqInvoiceUuid"] : ["status", "estatus"];
  return fields.some(field => before?.[field] !== after?.[field]);
}

export async function reconcileForPay0Change(kind: "solicitud" | "pago", before: any, after: any) {
  if (!relevant(kind, before, after)) return 0;
  return reconcileAgent007Recommendations(db, after.rootId);
}

const permanentCodes = new Map<string, string>([
  ["3", "invalid-argument"], ["5", "not-found"], ["6", "already-exists"], ["7", "permission-denied"],
  ["9", "failed-precondition"], ["12", "unimplemented"], ["16", "unauthenticated"],
]);
for (const code of [...permanentCodes.values()]) permanentCodes.set(code, code);

/** Delivery retries remain bounded and never revive historical/undated events. */
export async function reconcileForPay0Event(kind: "solicitud" | "pago", event: any) {
  const created = typeof event.time === "string" ? Date.parse(event.time) : NaN;
  const age = Date.now() - created;
  if (!Number.isFinite(created) || age < 0 || age > 20 * 60_000) return 0;
  try {
    return await reconcileForPay0Change(kind, event.data?.before.data(), event.data?.after.data());
  } catch (error) {
    const rawCode = String((error as { code?: unknown })?.code ?? "").toLowerCase().replace(/^firestore\//, "").replace(/_/g, "-");
    const code = permanentCodes.get(rawCode);
    if (!code) throw error;
    // Preserve a diagnostic without logging source documents, identifiers or error payloads.
    console.warn("HUGO_RECONCILIATION_PERMANENT_FAILURE", { code });
    return 0;
  }
}

export const reconcileHugoOnSolicitudChange = onDocumentWritten({ document: "solicitudes/{solicitudId}", region: "us-central1", retry: true, timeoutSeconds: 120, memory: "512MiB", maxInstances: 2 }, async event => {
  await reconcileForPay0Event("solicitud", event);
});
export const reconcileHugoOnPagoChange = onDocumentWritten({ document: "pagos/{pagoId}", region: "us-central1", retry: true, timeoutSeconds: 120, memory: "512MiB", maxInstances: 2 }, async event => {
  await reconcileForPay0Event("pago", event);
});
