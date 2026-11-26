import { FieldPath } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { IQ_CANCELLATION_CREDENTIALS_KEY } from "../iq/solicitudCancellationService";
import { db } from "../sharedCallables/helpers";
import { UNKNOWN_OUTCOME_REASON } from "./iqLinkDomain";
import { productionIqLinkPorts } from "./iqLinkPorts";
import { linkOrCreateMethod, recheckConciliation, type IqLinkPorts } from "./iqLinkService";
import type { SafetyRuntime } from "../automationSafety/runtime";

const text = (value: unknown) => String(value ?? "").trim();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const PER_RUN = 25;
export const WATCHED_CATALOGS = ["iq-group-rr", "iq-group-pay0"];

// Every 5 minutes: accounts created in IQ that wait for its conciliation are read again. With none waiting it is one cheap Firestore
// read per catalog and IQ is not touched.
export async function watchConciliation(input: { ports: IqLinkPorts; nowMs?: number; limit?: number; spacingMs?: number; safety?: SafetyRuntime }) {
  const result = { waiting: 0, linked: 0, stillPending: 0 };
  for (const catalog of WATCHED_CATALOGS) {
    const page = await db.collection("clientBeneficiaryMethods").where(new FieldPath("iqLinksByCatalog", catalog, "status"), "==", "NOT_CONCILIATED").limit(input.limit ?? PER_RUN).get();
    result.waiting += page.size;
    // "ya existe" or a lost answer: IQ may not list the account yet. It is only read again (never created again), every 5 minutes.
    const unknown = await db.collection("clientBeneficiaryMethods").where(new FieldPath("iqLinksByCatalog", catalog, "reason"), "==", UNKNOWN_OUTCOME_REASON).limit(input.limit ?? PER_RUN).get();
    result.waiting += unknown.size;
    for (const doc of unknown.docs) {
      if (doc.get(new FieldPath("iqLinksByCatalog", catalog, "status")) !== "PENDING_RETRY") continue;
      try { const outcomes = await linkOrCreateMethod({ methodId: doc.id, ports: input.ports, nowMs: input.nowMs, safety: input.safety }); if (outcomes.some(o => o.catalog === catalog && o.status === "LINKED")) result.linked++; else result.stillPending++; }
      catch (error) { console.error("IQ_CONCILIATION_WATCH_FAILED", doc.id, text(error instanceof Error ? error.message : error).slice(0, 200)); }
      await sleep(input.spacingMs ?? 400);
    }
    for (const doc of page.docs) {
      try {
        const outcome = await recheckConciliation({ methodId: doc.id, catalog, ports: input.ports, nowMs: input.nowMs, safety: input.safety });
        if (outcome?.status === "LINKED") result.linked++; else result.stillPending++;
      } catch (error) { console.error("IQ_CONCILIATION_WATCH_FAILED", doc.id, text(error instanceof Error ? error.message : error).slice(0, 200)); }
      await sleep(input.spacingMs ?? 400);
    }
  }
  return result;
}

export const watchIqBeneficiaryConciliation = onSchedule({ schedule: "*/5 * * * *", timeZone: "America/Mexico_City", region: "us-central1", timeoutSeconds: 240, memory: "512MiB", secrets: [IQ_CANCELLATION_CREDENTIALS_KEY], retryCount: 0, maxInstances: 1 }, async () => {
  await watchConciliation({ ports: productionIqLinkPorts });
});
