import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { WARM_CAPACITY_CONFIG, desiredMinInstances, planScalingChanges, type ServiceState } from "./domain";
import { getRunToken, patchMinInstances, readMinInstances } from "./service";

if (!admin.apps.length) admin.initializeApp();

/**
 * Keeps the hot service set warm from 08:45 to 21:00 (Mexico City) and at zero outside it.
 * Idempotent: it reads first and patches only drift, so a deploy that resets the value is corrected within 15 minutes.
 */
export const applyWarmCapacityWindow = onSchedule(
  { schedule: "every 15 minutes", timeZone: WARM_CAPACITY_CONFIG.timeZone, timeoutSeconds: 120, memory: "256MiB", maxInstances: 1 },
  async () => {
    const config = WARM_CAPACITY_CONFIG;
    const desired = desiredMinInstances(new Date(), config);
    const token = await getRunToken();
    const states: ServiceState[] = [];
    for (const service of config.services) {
      try { states.push({ service, current: await readMinInstances(config, service, token) }); }
      catch (error) { states.push({ service, current: null, error: error instanceof Error ? error.message : "READ_FAILED" }); }
    }
    const plan = planScalingChanges(states, desired);
    const failed: Array<{ name: string; error: string }> = [];
    const changed: Array<{ name: string; from: number | null; to: number }> = [];
    for (const state of plan.patch) {
      try { await patchMinInstances(config, state.service, desired, token); changed.push({ name: state.service.name, from: state.current, to: desired }); }
      catch (error) { failed.push({ name: state.service.name, error: error instanceof Error ? error.message : "PATCH_FAILED" }); }
    }
    for (const state of plan.unreadable) failed.push({ name: state.service.name, error: state.error || "UNREADABLE" });

    const summary = { desired, services: config.services.length, unchanged: plan.unchanged.length, changed, failed };
    console.info("WARM_CAPACITY_APPLIED", JSON.stringify(summary));
    if (changed.length || failed.length) {
      await admin.firestore().collection("warmCapacityRuns").add({ ...summary, createdAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => undefined);
    }
  },
);
