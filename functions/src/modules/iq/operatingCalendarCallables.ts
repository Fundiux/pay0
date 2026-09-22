import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertIqAuthorized } from "./authorization";

import {
  evaluateIqOperatingWindow,
  normalizeIqOperatingCalendarConfig,
  type IqOperatingCalendarConfig,
  type IqOperatingPurpose,
} from "./operatingCalendar";
import { logActivity } from "../../utils/logActivity";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

type AuthContext = {
  uid: string;
  role: string;
  rootId: string;
  user: Record<string, unknown>;
};

async function getAuthContext(request: {
  auth?: { uid?: string; token?: Record<string, unknown> } | null;
}): Promise<AuthContext> {
  const uid = cleanText(request.auth?.uid);

  if (!uid) {
    throw new HttpsError("unauthenticated", "Sesion requerida.");
  }

  const userSnap = await db.collection("users").doc(uid).get();

  if (!userSnap.exists) {
    throw new HttpsError("permission-denied", "Usuario PAY0 no encontrado.");
  }

  const user = asRecord(userSnap.data());
  const token = asRecord(request.auth?.token);
  const role = cleanText(token.role ?? token.userRole ?? user.role).toLowerCase();
  const rootId = cleanText(token.rootId ?? token.root_id ?? user.rootId ?? uid);

  return {
    uid,
    role,
    rootId: rootId || uid,
    user,
  };
}

function assertSuperAdmin(auth: AuthContext): void {
  if (auth.role !== "superadmin") {
    throw new HttpsError(
      "permission-denied",
      "Solo Super Admin puede configurar el calendario IQ.",
    );
  }
}

function getActorName(auth: AuthContext): string {
  return cleanText(
    auth.user.username ??
      auth.user.displayName ??
      auth.user.name ??
      auth.user.email ??
      auth.uid,
  );
}

// H4_D82_A3_A6_A3C_AUTOMATION_CONTROL
function getDefaultConfig(): IqOperatingCalendarConfig {
  return normalizeIqOperatingCalendarConfig({
    enabled: false,
    timezone: "America/Mexico_City",
    weeklyWindows: {},
    holidays: [],
    dateOverrides: {},
    creationCutoffMinutes: 20,
    reconciliationCutoffMinutes: 5,
    invoiceCutoffMinutes: 10,
    queueDrainSeconds: 15,
    intervalMinutes: {
      discovery: 20,
      invoiceImport: 20,
      statusMonitor: 20,
      solicitudCreate: 1,
      solicitudReconciliation: 20,
      pagoCreate: 1,
      pagoReconciliation: 20,
      dispersionCreate: 5,
      paymentApplicationExecution: 5,
    },
    automation: {
      solicitudes: false,
      pagos: false,
      aplicacionPagos: false,
      dispersiones: false,
      crearCliente: false,
      cancelarSolicitud: false,
    },
  });
}

function serializeConfig(config: IqOperatingCalendarConfig): Record<string, unknown> {
  return {
    enabled: config.enabled,
    timezone: config.timezone,
    weeklyWindows: config.weeklyWindows,
    holidays: config.holidays,
    dateOverrides: config.dateOverrides,
    creationCutoffMinutes: config.creationCutoffMinutes,
    reconciliationCutoffMinutes: config.reconciliationCutoffMinutes,
    invoiceCutoffMinutes: config.invoiceCutoffMinutes,
    queueDrainSeconds: config.queueDrainSeconds,
    intervalMinutes: config.intervalMinutes,
    automation: config.automation,
  };
}

export const getIqOperatingCalendar = onCall(
  {
    cors: true,
    invoker: "public",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
    const auth = await getAuthContext(request);
    assertSuperAdmin(auth);

    const snap = await db.collection("iqIntegrationConfigs").doc(auth.rootId).get();
    const config = snap.exists
      ? normalizeIqOperatingCalendarConfig(snap.data())
      : getDefaultConfig();
    const now = new Date();
    const decisions = (["CREATION", "RECONCILIATION", "INVOICE"] as IqOperatingPurpose[])
      .reduce<Record<string, unknown>>((acc, purpose) => {
        const decision = evaluateIqOperatingWindow(config, now, purpose);
        acc[purpose] = {
          ...decision,
          nextEligibleAt: decision.nextEligibleAt?.getTime() ?? null,
        };
        return acc;
      }, {});

    return {
      ok: true,
      data: {
        ...serializeConfig(config),
        configured: snap.exists,
        decisions,
      },
      message: snap.exists
        ? "Calendario operativo IQ cargado."
        : "El calendario IQ aun no esta configurado. La automatizacion permanece detenida.",
    };
  },
);

// H4_D87_A58_A60_MASTER_KILL_SWITCH_CALLABLE
export const setIqAutomationMasterEnabled = onCall(
  {
    cors: true,
    invoker: "public",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
    const auth = await getAuthContext(request);
    assertSuperAdmin(auth);

    const requestedEnabled = request.data?.enabled;

    if (typeof requestedEnabled !== "boolean") {
      throw new HttpsError(
        "invalid-argument",
        "enabled debe ser booleano.",
      );
    }

    const configRef = db
      .collection("iqIntegrationConfigs")
      .doc(auth.rootId);

    const snap = await configRef.get();
    const config = snap.exists
      ? normalizeIqOperatingCalendarConfig(snap.data())
      : getDefaultConfig();

    await configRef.set(
      {
        enabled: requestedEnabled,
        rootId: auth.rootId,
        masterUpdatedBy: auth.uid,
        masterUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await logActivity({
      event: requestedEnabled
        ? "IQ_AUTOMATION_MASTER_ENABLED"
        : "IQ_AUTOMATION_MASTER_DISABLED",
      rootId: auth.rootId,
      adminId: auth.rootId,
      actorUid: auth.uid,
      actorName: getActorName(auth),
      actorUsername: getActorName(auth),
      actorRole: auth.role,
      referenceId: auth.rootId,
      referenceType: "iq_config",
      entityId: auth.rootId,
      entityType: "iq_config",
      description: requestedEnabled
        ? "Master de automatizacion IQ activado."
        : "Master de automatizacion IQ desactivado.",
      extra: {
        enabled: requestedEnabled,
      },
    }).catch(() => undefined);

    return {
      ok: true,
      data: {
        enabled: requestedEnabled,
      },
      message: requestedEnabled
        ? "Master IQ activado."
        : "Master IQ desactivado.",
    };
  },
);

export const updateIqOperatingCalendar = onCall(
  {
    cors: true,
    invoker: "public",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
    const auth = await getAuthContext(request);
    assertSuperAdmin(auth);

    // H4_D87_A58_A55_PRESERVE_LIVE_MASTER_ENABLED
    const requestedConfig =
      normalizeIqOperatingCalendarConfig(request.data);

    const liveConfigRef = db
      .collection("iqIntegrationConfigs")
      .doc(auth.rootId);
    const liveSnap = await liveConfigRef.get();
    const liveConfig = liveSnap.exists
      ? normalizeIqOperatingCalendarConfig(liveSnap.data())
      : getDefaultConfig();

    const config: IqOperatingCalendarConfig = {
      ...requestedConfig,
      enabled: liveConfig.enabled,
    };

    try {
      new Intl.DateTimeFormat("es-MX", { timeZone: config.timezone }).format();
    } catch {
      throw new HttpsError("invalid-argument", "Zona horaria IQ invalida.");
    }

    const configRef = db.collection("iqIntegrationConfigs").doc(auth.rootId);

    await configRef.set(
      {
        ...serializeConfig(config),
        rootId: auth.rootId,
        updatedBy: auth.uid,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await logActivity({
      event: "IQ_CALENDARIO_ACTUALIZADO",
      rootId: auth.rootId,
      adminId: auth.rootId,
      actorUid: auth.uid,
      actorName: getActorName(auth),
      actorUsername: getActorName(auth),
      actorRole: auth.role,
      referenceId: auth.rootId,
      referenceType: "iq_config",
      entityId: auth.rootId,
      entityType: "iq_config",
      description: config.enabled
        ? "Calendario operativo IQ actualizado y activado."
        : "Calendario operativo IQ actualizado y desactivado.",
      extra: {
        timezone: config.timezone,
        weeklyWindows: config.weeklyWindows,
        holidaysCount: config.holidays.length,
        dateOverridesCount: Object.keys(config.dateOverrides).length,
        automation: config.automation,
      },
    }).catch(() => undefined);

    return {
      ok: true,
      data: serializeConfig(config),
      message: config.enabled
        ? "Calendario IQ actualizado."
        : "Calendario IQ guardado; la automatizacion permanece desactivada.",
    };
  },
);
