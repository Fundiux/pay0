"use client";

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type WhatsAppQrDestination = {
  safeDocId: string;
  chatId: string;
  chatName: string;
  chatType: "GROUP" | "CONTACT";
};

export type WhatsAppQrDelivery = {
  id: string;
  status: string;
  chatId: string;
  chatName: string;
  chatType: string;
  safeDocId: string;
  lastError?: string;
  releasedAt?: any;
  sendingAt?: any;
  sentAt?: any;
  omittedAt?: any;
  updatedAt?: any;
};

export type WhatsAppQrJob = {
  id: string;
  status: string;
  channel: string;
  sourceType: string;
  sourceId: string;
  clienteId: string;
  message: string;
  targetLabel: string;
  targetChatId?: string;
  targetChatName?: string;
  targetChatType?: string;
  targetChatSafeDocId?: string;
  targetConfiguredAt?: any;
  targetResolutionStatus?: string;
  targetRouteId?: string;
  targetRouteMatchType?: string;
  targetDestinations?: WhatsAppQrDestination[];
  targetDestinationsCount?: number;
  deliveryMode?: string;
  documentsCount: number;
  deliveries?: WhatsAppQrDelivery[];
  deliveryStatsUi?: {
    total: number;
    sent: number;
    error: number;
    pending: number;
    omitted: number;
    blocked?: number;
  };
  createdAt?: any;
  updatedAt?: any;
};

export type WhatsAppQrChat = {
  id: string;
  connectorId: string;
  chatId: string;
  safeDocId: string;
  name: string;
  isGroup: boolean;
  archived: boolean;
  pinned: boolean;
  timestamp?: any;
  lastSyncedAt?: any;
  updatedAt?: any;
};

export type WhatsAppDeliveryRoute = {
  id: string;
  active: boolean;
  clienteId: string;
  clientLabel: string;
  clientKey: string;
  sourceType: string;
  sourceTypeKey: string;
  destinationChats: WhatsAppQrDestination[];
  destinationsCount: number;
  updatedAt?: any;
  createdAt?: any;
};

export type WhatsAppQrDashboard = {
  ok: boolean;
  connector: {
    id: string;
    status:
      | "DISCONNECTED"
      | "QR_REQUIRED"
      | "CONNECTED"
      | "ERROR"
      | "RECOVERING"
      | "RESTARTING_QR"
      | "UNKNOWN";
    qrDataUrl?: string | null;
    qrText?: string | null;
    phoneLabel?: string | null;
    chatsCount?: number;
    lastChatsSyncedAt?: any;
    lastSeenAt?: any;
    updatedAt?: any;
    sendEnabled?: boolean;
    authClientId?: string;
    error?: string | null;
    lastCommandId?: string | null;
    lastCommandType?: string | null;
    lastCommandStatus?: string | null;
    lastCommandMessage?: string | null;
    lastCommandAt?: any;
    lastCommandFinishedAt?: any;
  };
  jobs: WhatsAppQrJob[];
  chats: WhatsAppQrChat[];
  routes: WhatsAppDeliveryRoute[];
};

export async function getWhatsAppQrDashboard(): Promise<WhatsAppQrDashboard> {
  const fn = httpsCallable(functions, "getWhatsAppQrDashboard");
  const res: any = await fn({});
  return res.data as WhatsAppQrDashboard;
}

export async function saveWhatsAppDeliveryRoute(input: {
  clienteId: string;
  sourceType: string;
  chatDocIds: string[];
}): Promise<{
  ok: boolean;
  routeId: string;
  clienteId: string;
  clientLabel: string;
  sourceType: string;
  destinationsCount: number;
  appliedCount: number;
  message: string;
}> {
  const fn = httpsCallable(functions, "saveWhatsAppDeliveryRoute");
  const res: any = await fn(input);
  return res.data;
}

/** Resolve a send whose WhatsApp result is unknown: confirm it arrived, or authorize one new send. */
export async function resolveWhatsAppUncertainDelivery(input: {
  jobId: string;
  decision: "CONFIRM_SENT" | "ALLOW_RESEND";
}): Promise<{ ok: boolean; jobId: string; status: string; resolvedCount: number; message: string }> {
  const fn = httpsCallable(functions, "resolveWhatsAppUncertainDelivery");
  const res: any = await fn(input);
  return res.data;
}


export type WhatsAppReplyMode = "GREETINGS_ONLY" | "STANDARD";
export type WhatsAppAgentReplyConfig = { ok: boolean; agentId: string; enabled: boolean; mode: WhatsAppReplyMode };

export async function getWhatsAppAgentReplyConfig() {
  return (await httpsCallable<Record<string, never>, WhatsAppAgentReplyConfig>(functions, "getWhatsAppAgentReplyConfig")({})).data;
}

export async function setWhatsAppAgentReplyConfig(input: { enabled: boolean; mode: WhatsAppReplyMode }) {
  return (await httpsCallable<typeof input, { ok: boolean; enabled: boolean; mode: WhatsAppReplyMode }>(functions, "setWhatsAppAgentReplyConfig")(input)).data;
}

export type WhatsAppAgentObserver = { agentId: string; phone: string };
export type WhatsAppAgentMode = "OBSERVER" | "ACTING";
export type WhatsAppAgentObserversConfig = { groupChatId: string; groupName: string; active: boolean; ownerUserUid: string; observers: WhatsAppAgentObserver[]; agentModes?: Record<string, WhatsAppAgentMode> };
export type WhatsAppAgentObserversState = {
  ok: boolean;
  agents: Array<{ id: string; name: string }>;
  groups: Array<{ chatId: string; name: string }>;
  users: Array<{ uid: string; name: string }>;
  configs: WhatsAppAgentObserversConfig[];
};

export async function getWhatsAppAgentObservers() {
  return (await httpsCallable<Record<string, never>, WhatsAppAgentObserversState>(functions, "getWhatsAppAgentObservers")({})).data;
}

export async function setWhatsAppGroupAgentMode(input: { groupChatId: string; agentId: string; mode: WhatsAppAgentMode; reason?: string }) {
  return (await httpsCallable<typeof input, { ok: boolean; agentModes: Record<string, WhatsAppAgentMode>; changed: string[] }>(functions, "setWhatsAppGroupAgentMode")(input)).data;
}

export type WhatsAppReplyMetricsBucket = {
  agentId: string; chatId: string | null; groupName: string | null; replies: number; byKind: Record<string, number>; humanCorrections: number; escalations: number;
  avgResponseMs: number | null; aiTokens: number; returnsToObserver: number; returnReasons: string[]; actingChanges: number;
};

export type WhatsAppPlaybookEntry = {
  id: string; chatId: string; groupName: string; type: string; kind: string; subject: string | null; category: string | null; status: "PROPOSED" | "APPROVED" | "REJECTED";
  evidenceCount: number; examples: string[]; suggestedGuidance: string; guidance: string; simulationEndsAtMs: number | null;
};

export async function getWhatsAppAgentPlaybook() {
  return (await httpsCallable<Record<string, never>, { ok: boolean; entries: WhatsAppPlaybookEntry[] }>(functions, "getWhatsAppAgentPlaybook")({})).data;
}

export async function decideWhatsAppPlaybookEntry(input: { id: string; decision: "APPROVE" | "REJECT"; guidance?: string }) {
  return (await httpsCallable<typeof input, { ok: boolean; status: string; simulationEndsAtMs: number | null }>(functions, "decideWhatsAppPlaybookEntry")(input)).data;
}

export type WhatsAppAgentReply = { id: string; agentId: string; groupName: string; kind: string; subject: string | null; atMs: number; text: string; humanCorrection: boolean };
export type WhatsAppCorrectionCategory = "WRONG_FACT" | "TONE" | "NOT_NEEDED" | "TOO_LATE" | "OTHER";

export async function listWhatsAppAgentReplies(month?: string) {
  return (await httpsCallable<{ month?: string }, { ok: boolean; month: string; replies: WhatsAppAgentReply[] }>(functions, "listWhatsAppAgentReplies")({ month })).data;
}

export async function markWhatsAppReplyCorrection(input: { jobId: string; corrected: boolean; reason?: string; category?: WhatsAppCorrectionCategory }) {
  return (await httpsCallable<typeof input, { ok: boolean; humanCorrection: boolean }>(functions, "markWhatsAppReplyCorrection")(input)).data;
}

export async function getWhatsAppAgentReplyMetrics(month?: string) {
  return (await httpsCallable<{ month?: string }, { ok: boolean; month: string; truncated: boolean; buckets: WhatsAppReplyMetricsBucket[] }>(functions, "getWhatsAppAgentReplyMetrics")({ month })).data;
}

export async function saveWhatsAppAgentObservers(input: { groupChatId: string; active: boolean; ownerUserUid: string; observers: WhatsAppAgentObserver[] }) {
  return (await httpsCallable<typeof input, { ok: boolean; observers: number }>(functions, "saveWhatsAppAgentObservers")(input)).data;
}

export type WhatsAppAgentConnector = {
  bindingId: string; agentId: string; state: "ACTIVE" | "REVOKED"; generation: number;
  status: string | null; lastSeenAtMs: number | null; qrDataUrl: string | null; error: string | null;
};
export type WhatsAppAgentActivityRow = {
  agentId: string; chatId: string; sent: number; received: number; answered: number; unanswered: number;
  avgResponseMs: number | null; medianResponseMs: number | null;
};

export type WhatsAppAgentChats = {
  groups: { chatId: string; name: string; archived: boolean; pinned: boolean; lastSyncedAtMs: number | null }[];
  privateChats: number; truncated: boolean;
};

export async function listWhatsAppAgentChats(bindingId: string) {
  return (await httpsCallable<{ bindingId: string }, { ok: boolean } & WhatsAppAgentChats>(functions, "listWhatsAppAgentChats")({ bindingId })).data;
}

export async function listWhatsAppAgentConnectors() {
  return (await httpsCallable<Record<string, never>, { ok: boolean; connectors: WhatsAppAgentConnector[] }>(functions, "listWhatsAppAgentConnectors")({})).data;
}

export async function createWhatsAppAgentEnrollment(agentId: string, publicKeyPem: string) {
  return (await httpsCallable<{ agentId: string; publicKeyPem: string }, { ok: boolean; enrollment: Record<string, unknown> }>(functions, "createWhatsAppConnectorEnrollment")({ agentId, publicKeyPem })).data;
}

export async function revokeWhatsAppAgentConnector(bindingId: string) {
  return (await httpsCallable<{ bindingId: string }, { ok: boolean }>(functions, "revokeWhatsAppConnectorBinding")({ bindingId })).data;
}

export async function getWhatsAppAgentActivity(days = 7) {
  return (await httpsCallable<{ days: number }, { ok: boolean; days: number; truncated: boolean; totalMessages: number; rows: WhatsAppAgentActivityRow[] }>(functions, "getWhatsAppAgentActivity", { timeout: 120000 })({ days })).data;
}
