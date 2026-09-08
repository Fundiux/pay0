import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logActivity } from "../../utils/logActivity";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const HEARTBEAT_STALE_MS = 90 * 1000;

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
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

type AuthContext = {
  uid: string;
  role: string;
  rootId: string;
  user: Record<string, any>;
};

async function getAuthContext(request: any): Promise<AuthContext> {
  const uid = cleanText(request.auth?.uid);

  if (!uid) {
    throw new HttpsError("unauthenticated", "Sesion requerida.");
  }

  const userSnap = await db.collection("users").doc(uid).get();

  if (!userSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "Usuario PAY0 no encontrado.",
    );
  }

  const user = asRecord(userSnap.data());
  const token = asRecord(request.auth?.token);

  const role = cleanText(
    token.role ??
      token.userRole ??
      user.role ??
      user.supervisorRole,
  ).toLowerCase();

  const rootId =
    cleanText(
      token.rootId ??
        token.root_id ??
        user.rootId ??
        uid,
    ) || uid;

  return {
    uid,
    role,
    rootId,
    user,
  };
}

function assertSuperAdmin(auth: AuthContext): void {
  if (auth.role !== "superadmin") {
    throw new HttpsError(
      "permission-denied",
      "Solo Super Admin puede configurar la automatizacion WhatsApp.",
    );
  }
}

function actorName(auth: AuthContext): string {
  return (
    cleanText(
      auth.user.username ??
        auth.user.displayName ??
        auth.user.name ??
        auth.user.email,
    ) || auth.uid
  );
}

function normalizeConnectorStatus(value: unknown): string {
  return cleanText(value).toUpperCase() || "UNKNOWN";
}

export async function readWhatsAppAutomationState(rootId: string) {
  const [configSnap, connectorSnap] = await Promise.all([
    db.collection("whatsappAutomationConfigs").doc(rootId).get(),
    db.collection("whatsappQrConnectors").doc("default").get(),
  ]);

  const config = configSnap.exists
    ? asRecord(configSnap.data())
    : {};

  const connector = connectorSnap.exists
    ? asRecord(connectorSnap.data())
    : {};

  const enabled = config.enabled === true;
  const rawConnectorStatus = normalizeConnectorStatus(
    connector.status,
  );

  const heartbeatValue = connector.lastHeartbeatAt as
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
    heartbeatAgeMs <= HEARTBEAT_STALE_MS;

  const connectorConnected =
    rawConnectorStatus === "CONNECTED" &&
    heartbeatFresh;

  const connectorStatus =
    rawConnectorStatus === "CONNECTED" &&
    !heartbeatFresh
      ? "STALE"
      : rawConnectorStatus;

  return {
    enabled,
    configured: configSnap.exists,

    effectiveReady:
      enabled &&
      connectorConnected &&
      connector.sendEnabled === true,

    connector: {
      id: "default",
      status: connectorStatus,
      rawStatus: rawConnectorStatus,
      connected: connectorConnected,
      heartbeatFresh,
      heartbeatAgeSeconds:
        heartbeatAgeMs === null
          ? null
          : Math.floor(heartbeatAgeMs / 1000),

      lastHeartbeatAt:
        timestampIso(connector.lastHeartbeatAt),

      phoneLabel:
        cleanText(
          connector.phoneLabel ??
            connector.sessionLabel,
        ) || null,

      authClientId:
        cleanText(connector.authClientId) || null,

      chatsCount:
        Number(connector.chatsCount ?? 0) || 0,

      sendEnabled:
        connector.sendEnabled === true,

      lastChatsSyncedAt:
        timestampIso(connector.lastChatsSyncedAt),

      lastSeenAt:
        timestampIso(connector.lastSeenAt),

      error:
        cleanText(
          connector.error ??
            connector.lastError,
        ) || null,
    },

    updatedAt:
      timestampIso(config.updatedAt),

    updatedBy:
      cleanText(config.updatedBy) || null,
  };
}

export const getWhatsAppAutomationConfig = onCall(
  {
    cors: true,
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    const auth = await getAuthContext(request);
    assertSuperAdmin(auth);

    const data =
      await readWhatsAppAutomationState(auth.rootId);

    return {
      ok: true,
      data,
      message: "Configuracion de automatizacion WhatsApp cargada.",
    };
  },
);

export const setWhatsAppAutomationEnabled = onCall(
  {
    cors: true,
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    const auth = await getAuthContext(request);
    assertSuperAdmin(auth);

    const enabled = request.data?.enabled;

    if (typeof enabled !== "boolean") {
      throw new HttpsError(
        "invalid-argument",
        "enabled debe ser booleano.",
      );
    }

    const configRef = db
      .collection("whatsappAutomationConfigs")
      .doc(auth.rootId);

    await configRef.set(
      {
        rootId: auth.rootId,
        enabled,
        updatedBy: auth.uid,
        updatedByName: actorName(auth),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await logActivity({
      event: enabled
        ? "WHATSAPP_AUTOMATION_ENABLED"
        : "WHATSAPP_AUTOMATION_DISABLED",

      rootId: auth.rootId,
      adminId: auth.rootId,
      actorUid: auth.uid,
      actorName: actorName(auth),
      actorUsername: actorName(auth),
      actorRole: auth.role,

      referenceId: auth.rootId,
      referenceType: "whatsapp_automation",

      entityId: auth.rootId,
      entityType: "whatsapp_automation",

      description: enabled
        ? "Automatizacion de documentos por WhatsApp activada."
        : "Automatizacion de documentos por WhatsApp desactivada.",

      extra: {
        enabled,
      },
    }).catch(() => undefined);

    const data =
      await readWhatsAppAutomationState(auth.rootId);

    return {
      ok: true,
      data,
      message: enabled
        ? "Automatizacion WhatsApp activada."
        : "Automatizacion WhatsApp desactivada.",
    };
  },
);
