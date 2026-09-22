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

export const reconcileHugoOnSolicitudChange = onDocumentWritten({ document: "solicitudes/{solicitudId}", region: "us-central1", retry: true }, async event => {
  await reconcileForPay0Change("solicitud", event.data?.before.data(), event.data?.after.data());
});
export const reconcileHugoOnPagoChange = onDocumentWritten({ document: "pagos/{pagoId}", region: "us-central1", retry: true }, async event => {
  await reconcileForPay0Change("pago", event.data?.before.data(), event.data?.after.data());
});
