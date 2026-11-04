import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { materializeCommissionDistribution } from "./service";
import { shouldSuppressIqHistoricalImport } from "../iq/historicalImportGuard";

export const onPaymentReadyForCommissionDistribution = onDocumentUpdated(
  { document: "pagos/{paymentId}", region: "us-central1", maxInstances: 2 },
  async (event) => {
    const before: any = event.data?.before.data() || {};
    const after: any = event.data?.after.data() || {};
    if (shouldSuppressIqHistoricalImport(before, after)) return;
    const becameReady = String(after.status || "").toUpperCase() === "CONCILIADO" && String(after.financialPostingStatus || "").toUpperCase() === "POSTED" && (String(before.status || "").toUpperCase() !== "CONCILIADO" || String(before.financialPostingStatus || "").toUpperCase() !== "POSTED");
    if (!becameReady) return;
    await materializeCommissionDistribution({ paymentId: event.params.paymentId, actorUid: "SYSTEM_COMMISSION_TRIGGER" });
  },
);

