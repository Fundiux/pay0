import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { IQ_CANCELLATION_CREDENTIALS_KEY } from "../iq/solicitudCancellationService";
import { db } from "../sharedCallables/helpers";
import { evaluateCreateGate, GATE_REASONS, mexicoDay, retryDelayMs } from "./iqLinkDomain";
import { productionIqLinkPorts } from "./iqLinkPorts";
import { linkOrCreateMethod, type IqLinkPorts } from "./iqLinkService";
import type { SafetyRuntime } from "../automationSafety/runtime";

const text = (value: unknown) => String(value ?? "").trim();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const PER_RUN = 25;
export const REDRIVEN_CATALOGS = ["iq-group-rr", "iq-group-pay0"];

// Re-drives methods stored as PENDING_RETRY, a bounded page at a time with a cursor, so a bulk import cannot be
// lost behind a temporary stop (circuit, master switch, create switch, daily limit) and cannot flood IQ either.
export async function redriveCatalog(input: { catalog: string; ports: IqLinkPorts; nowMs?: number; limit?: number; spacingMs?: number; safety?: SafetyRuntime }) {
  const nowMs = input.nowMs ?? Date.now(), limit = input.limit ?? PER_RUN;
  const stateRef = db.doc(`iqBeneficiaryLinkRedriveState/${input.catalog}`);
  const cursor = text((await stateRef.get()).data()?.cursor);
  const statusPath = new FieldPath("iqLinksByCatalog", input.catalog, "status");
  let query = db.collection("clientBeneficiaryMethods").where(statusPath, "==", "PENDING_RETRY").orderBy(FieldPath.documentId()).limit(limit);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  const result = { scanned: page.size, driven: 0, waiting: 0 };
  const gates = new Map<string, { masterEnabled: boolean; allowed: boolean }>();
  const gateOf = async (rootId: string) => {
    if (!gates.has(rootId)) {
      const [master, config, counter] = await Promise.all([db.doc(`iqIntegrationConfigs/${rootId}`).get(), db.doc(`iqBeneficiaryCreateConfig/${rootId}`).get(), db.doc(`iqBeneficiaryCreateCounters/${rootId}_${mexicoDay(nowMs)}`).get()]);
      const masterEnabled = master.data()?.enabled === true;
      gates.set(rootId, { masterEnabled, allowed: evaluateCreateGate({ masterEnabled, config: config.data(), createdToday: Number(counter.data()?.count || 0) }).allowed });
    }
    return gates.get(rootId)!;
  };
  for (const doc of page.docs) {
    const entry = doc.get(new FieldPath("iqLinksByCatalog", input.catalog)) || {};
    const reason = text(entry.reason);
    if ((entry.retryAfter?.toMillis?.() ?? 0) > nowMs) { result.waiting++; continue; }
    // A switch that is still off cannot have changed the answer: wait without touching IQ or spending an attempt.
    if (GATE_REASONS.has(reason)) {
      const gate = await gateOf(text(doc.get("rootId")));
      const stillClosed = reason === "IQ_MASTER_OFF" ? !gate.masterEnabled : !gate.allowed;
      if (stillClosed) {
        await doc.ref.update(new FieldPath("iqLinksByCatalog", input.catalog, "retryAfter"), Timestamp.fromMillis(nowMs + (retryDelayMs(reason) ?? 3_600_000)));
        result.waiting++;
        continue;
      }
    }
    try { await linkOrCreateMethod({ methodId: doc.id, ports: input.ports, nowMs, safety: input.safety }); result.driven++; }
    catch (error) { console.error("IQ_BENEFICIARY_REDRIVE_FAILED", doc.id, text(error instanceof Error ? error.message : error).slice(0, 200)); }
    await sleep(input.spacingMs ?? 400);
  }
  await stateRef.set({ cursor: page.size === limit ? page.docs.at(-1)?.id ?? null : null, lastRunAt: Timestamp.fromMillis(nowMs), lastResult: result }, { merge: true });
  return result;
}

export const redriveIqBeneficiaryLinks = onSchedule({ schedule: "*/30 * * * *", timeZone: "America/Mexico_City", region: "us-central1", timeoutSeconds: 300, memory: "512MiB", secrets: [IQ_CANCELLATION_CREDENTIALS_KEY], retryCount: 0 }, async () => {
  for (const catalog of REDRIVEN_CATALOGS) {
    try { await redriveCatalog({ catalog, ports: productionIqLinkPorts }); }
    catch (error) { console.error("IQ_BENEFICIARY_REDRIVE_CATALOG_FAILED", catalog, text(error instanceof Error ? error.message : error).slice(0, 200)); }
  }
});
