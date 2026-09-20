import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "crypto";

import { db } from "../sharedCallables/helpers";
import { AnalyticsEventInput, normalizeAnalyticsEvent } from "./contract";

export type PublishAnalyticsEventResult = { created: boolean; eventId: string };
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]));
  return value;
}
export function analyticsEventRecord(input: AnalyticsEventInput) {
  const event = normalizeAnalyticsEvent(input);
  return { ...event, fingerprint: createHash("sha256").update(JSON.stringify(stable(event))).digest("hex"), createdAt: FieldValue.serverTimestamp() };
}

export async function publishAnalyticsEvent(input: AnalyticsEventInput): Promise<PublishAnalyticsEventResult> {
  const record = analyticsEventRecord(input);
  const { fingerprint, createdAt, ...event } = record;
  const ref = db.collection("analyticsEvents").doc(event.eventId);
  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      const current = existing.data() || {};
      if (current.rootId !== event.rootId || current.eventType !== event.eventType || current.entityId !== event.entityId || current.fingerprint !== fingerprint) {
        throw new Error("CONTROL_CENTER_EVENT_ID_CONFLICT");
      }
      return { created: false, eventId: event.eventId };
    }
    tx.create(ref, record);
    return { created: true, eventId: event.eventId };
  });
}
