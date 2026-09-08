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

// WA_REMOTE_CONTROL_A1
export type WhatsAppConnectorCommandResponse = {
  ok: boolean;
  commandId: string;
  type: "SYNC_CHATS" | "NEW_QR";
  status: string;
  message: string;
};

export async function requestWhatsAppChatsSync():
  Promise<WhatsAppConnectorCommandResponse> {
  const fn = httpsCallable(
    functions,
    "requestWhatsAppChatsSync"
  );
  const res: any = await fn({});
  return res.data as WhatsAppConnectorCommandResponse;
}

export async function requestWhatsAppNewQr():
  Promise<WhatsAppConnectorCommandResponse> {
  const fn = httpsCallable(
    functions,
    "requestWhatsAppNewQr"
  );
  const res: any = await fn({});
  return res.data as WhatsAppConnectorCommandResponse;
}
// WA_REMOTE_CONTROL_A1_END

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

export async function resolveWhatsAppJobDestinations(input: {
  jobId: string;
}): Promise<{
  ok: boolean;
  jobId: string;
  status: string;
  routeId?: string;
  matchType?: string;
  destinationsCount: number;
}> {
  const fn = httpsCallable(functions, "resolveWhatsAppJobDestinations");
  const res: any = await fn(input);
  return res.data;
}

export async function releaseWhatsAppJobDeliveries(input: {
  jobId: string;
}): Promise<{
  ok: boolean;
  jobId: string;
  status: string;
  releasedCount: number;
  alreadySentCount: number;
  message: string;
}> {
  const fn = httpsCallable(functions, "releaseWhatsAppJobDeliveries");
  const res: any = await fn(input);
  return res.data;
}

export async function retryWhatsAppJobErrors(input: {
  jobId: string;
}): Promise<{
  ok: boolean;
  jobId: string;
  retryCount: number;
  message: string;
}> {
  const fn = httpsCallable(functions, "retryWhatsAppJobErrors");
  const res: any = await fn(input);
  return res.data;
}

export async function omitWhatsAppJob(input: {
  jobId: string;
  reason?: string;
}): Promise<{
  ok: boolean;
  jobId: string;
  omittedDeliveries: number;
  message: string;
}> {
  const fn = httpsCallable(functions, "omitWhatsAppJob");
  const res: any = await fn(input);
  return res.data;
}