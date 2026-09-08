import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const WHATSAPP_HEARTBEAT_STALE_MS = 90 * 1000;

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeConnectorStatus(value: unknown): string {
  return cleanText(value).toUpperCase() || "UNKNOWN";
}

function timestampIso(value: unknown): string | null {
  if (!value) return null;

  const candidate = value as {
    toDate?: () => Date;
    toMillis?: () => number;
  };

  try {
    if (typeof candidate.toDate === "function") {
      return candidate.toDate().toISOString();
    }

    if (typeof candidate.toMillis === "function") {
      return new Date(candidate.toMillis()).toISOString();
    }

    if (value instanceof Date) {
      return value.toISOString();
    }
  } catch {
    return null;
  }

  return null;
}

export type WhatsAppConnectorRuntimeState = {
  id: "default";
  exists: boolean;
  status: string;
  rawStatus: string;
  connected: boolean;
  heartbeatFresh: boolean;
  heartbeatAgeMs: number | null;
  heartbeatAgeSeconds: number | null;
  lastHeartbeatAt: string | null;
  sendEnabled: boolean;
  phoneLabel: string | null;
  authClientId: string | null;
  chatsCount: number;
  lastChatsSyncedAt: string | null;
  lastSeenAt: string | null;
  error: string | null;
};

export async function readWhatsAppConnectorRuntimeState(): Promise<WhatsAppConnectorRuntimeState> {
  const connectorSnap = await db
    .collection("whatsappQrConnectors")
    .doc("default")
    .get();

  const connector = connectorSnap.exists
    ? (connectorSnap.data() || {})
    : {};

  const rawStatus = normalizeConnectorStatus(
    (connector as any).status
  );

  const heartbeatValue = (connector as any).lastHeartbeatAt as
    | { toMillis?: () => number }
    | undefined;

  const lastHeartbeatAtMs =
    typeof heartbeatValue?.toMillis === "function"
      ? heartbeatValue.toMillis()
      : 0;

  const heartbeatAgeMs =
    lastHeartbeatAtMs > 0
      ? Math.max(0, Date.now() - lastHeartbeatAtMs)
      : null;

  const heartbeatFresh =
    heartbeatAgeMs !== null &&
    heartbeatAgeMs <= WHATSAPP_HEARTBEAT_STALE_MS;

  const connected =
    rawStatus === "CONNECTED" &&
    heartbeatFresh;

  const status =
    rawStatus === "CONNECTED" && !heartbeatFresh
      ? "STALE"
      : rawStatus;

  return {
    id: "default",
    exists: connectorSnap.exists,
    status,
    rawStatus,
    connected,
    heartbeatFresh,
    heartbeatAgeMs,
    heartbeatAgeSeconds:
      heartbeatAgeMs === null
        ? null
        : Math.floor(heartbeatAgeMs / 1000),
    lastHeartbeatAt:
      timestampIso((connector as any).lastHeartbeatAt),
    sendEnabled:
      (connector as any).sendEnabled === true,
    phoneLabel:
      cleanText(
        (connector as any).phoneLabel ??
        (connector as any).sessionLabel
      ) || null,
    authClientId:
      cleanText((connector as any).authClientId) || null,
    chatsCount:
      Number((connector as any).chatsCount ?? 0) || 0,
    lastChatsSyncedAt:
      timestampIso((connector as any).lastChatsSyncedAt),
    lastSeenAt:
      timestampIso((connector as any).lastSeenAt),
    error:
      cleanText(
        (connector as any).error ??
        (connector as any).lastError
      ) || null,
  };
}

export async function requireWhatsAppManualSendReady(): Promise<WhatsAppConnectorRuntimeState> {
  const state = await readWhatsAppConnectorRuntimeState();

  if (!state.connected) {
    throw new HttpsError(
      "failed-precondition",
      state.status === "STALE"
        ? "El conector WhatsApp no tiene heartbeat reciente."
        : "El conector WhatsApp no esta conectado."
    );
  }

  if (!state.sendEnabled) {
    throw new HttpsError(
      "failed-precondition",
      "El envio WhatsApp esta bloqueado por PAY0_SEND_ENABLED."
    );
  }

  return state;
}