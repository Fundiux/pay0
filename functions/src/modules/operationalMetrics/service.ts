import * as admin from "firebase-admin";

export type OperationalMetricStage =
  | "RECEIVED"
  | "ASSIGNED"
  | "FIRST_RESPONSE"
  | "ACTION_STARTED"
  | "RESOLVED"
  | "DOCUMENTS_SENT";

export async function recordOperationalMetric(input: {
  rootId: string;
  stage: OperationalMetricStage;
  channel: "PAY0" | "WHATSAPP" | "TELEGRAM";
  caseType: string;
  correlationId: string;
  adminId?: string | null;
  clientId?: string | null;
  actorUid?: string | null;
  source?: "HUMAN" | "AUTOMATION" | "HUGO_OBSERVATION";
  outcome?: string | null;
}): Promise<void> {
  const rootId = String(input.rootId || "").trim();
  const correlationId = String(input.correlationId || "").trim();
  if (!rootId || !correlationId) return;

  await admin.firestore().collection("operationalMetrics").add({
    rootId,
    stage: input.stage,
    channel: input.channel,
    caseType: String(input.caseType || "UNKNOWN").trim().slice(0, 80),
    correlationId,
    adminId: String(input.adminId || "").trim() || null,
    clientId: String(input.clientId || "").trim() || null,
    actorUid: String(input.actorUid || "").trim() || null,
    source: input.source || "HUMAN",
    outcome: String(input.outcome || "").trim() || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}
