import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  createTelegramLinkTokenForUid,
  getLinkedTelegramUserByUid,
  getTelegramLinkStatusForUid,
  getTelegramNotificationPrefsForUid,
  unlinkTelegramAccountForUid,
  updateTelegramNotificationPrefsForUid,
  createClientTelegramLinkTokenForClient,
  getClientTelegramLinkStatusForClient,
  unlinkClientTelegramAccountForClient,
} from "./repository";
import { sendTelegramMessage } from "./service";
import { assertAuthorized } from "../../utils/authGuard";
import { getMyUser } from "../sharedCallables/helpers";

const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");

async function assertTelegramAccess(request: any, action: "view" | "link") {
  const uid = String(request.auth?.uid || "").trim();
  const profile = uid ? await getMyUser(uid) : null;
  assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "telegram", requiredAction: action });
}

export const createTelegramLinkToken = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    await assertTelegramAccess(request, "link");
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Sesion requerida.");
    }

    try {
      const result = await createTelegramLinkTokenForUid(uid);
      return {
        ok: true,
        ...result,
      };
    } catch (error: any) {
      throw new HttpsError(
        "failed-precondition",
        String(error?.message || error || "No se pudo generar enlace Telegram.")
      );
    }
  }
);

export const getMyTelegramLinkStatus = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    await assertTelegramAccess(request, "view");
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Sesion requerida.");
    }

    const result = await getTelegramLinkStatusForUid(uid);
    return {
      ok: true,
      ...result,
    };
  }
);

export const unlinkMyTelegramAccount = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    await assertTelegramAccess(request, "link");
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Sesion requerida.");
    }

    const result = await unlinkTelegramAccountForUid(uid);

    return {
      ok: true,
      ...result,
    };
  }
);

export const getMyTelegramNotificationPrefs = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    await assertTelegramAccess(request, "view");
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Sesion requerida.");
    }

    const prefs = await getTelegramNotificationPrefsForUid(uid);

    return {
      ok: true,
      prefs,
    };
  }
);

export const updateMyTelegramNotificationPrefs = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    await assertTelegramAccess(request, "link");
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Sesion requerida.");
    }

    const data = request.data || {};

    const prefs = await updateTelegramNotificationPrefsForUid(uid, {
      enabled: data.enabled,
      notifySaldo: data.notifySaldo,
      notifyPagos: data.notifyPagos,
      notifySolicitudes: data.notifySolicitudes,
      notifyDispersiones: data.notifyDispersiones,
    });

    return {
      ok: true,
      prefs,
    };
  }
);

export const sendMyTelegramTestNotification = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    secrets: [TELEGRAM_BOT_TOKEN],
  },
  async (request) => {
    await assertTelegramAccess(request, "link");
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Sesion requerida.");
    }

    const linked = await getLinkedTelegramUserByUid(uid);

    if (!linked?.uid || !linked.chatId) {
      throw new HttpsError(
        "failed-precondition",
        "Cuenta Telegram no vinculada."
      );
    }

    const prefs = await getTelegramNotificationPrefsForUid(uid);

    if (!prefs.enabled) {
      return {
        ok: true,
        sent: false,
        reason: "notifications_disabled",
      };
    }

    const now = new Date().toLocaleString("es-MX", {
      dateStyle: "short",
      timeStyle: "short",
    });

    await sendTelegramMessage(
      TELEGRAM_BOT_TOKEN.value(),
      String(linked.chatId),
      [
        "PAY0 notificacion de prueba",
        "",
        `Usuario: ${String(linked.username || linked.displayName || "N/D")}`,
        `Rol: ${String(linked.role || "N/D")}`,
        `Fecha: ${now}`,
        "",
        "Canal Telegram configurado correctamente.",
      ].join("\n")
    );

    return {
      ok: true,
      sent: true,
    };
  }
);
export const createClientTelegramLinkToken = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    await assertTelegramAccess(request, "link");
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Sesion requerida.");
    }

    const clientId = String(request.data?.clientId || "").trim();

    if (!clientId) {
      throw new HttpsError("invalid-argument", "clientId requerido.");
    }

    try {
      const result = await createClientTelegramLinkTokenForClient(uid, clientId);

      return {
        ok: true,
        ...result,
      };
    } catch (error: any) {
      throw new HttpsError(
        "failed-precondition",
        String(error?.message || error || "No se pudo generar enlace Telegram del cliente.")
      );
    }
  }
);

export const getClientTelegramLinkStatus = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    await assertTelegramAccess(request, "view");
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Sesion requerida.");
    }

    const clientId = String(request.data?.clientId || "").trim();

    if (!clientId) {
      throw new HttpsError("invalid-argument", "clientId requerido.");
    }

    try {
      const result = await getClientTelegramLinkStatusForClient(uid, clientId);

      return {
        ok: true,
        ...result,
      };
    } catch (error: any) {
      throw new HttpsError(
        "failed-precondition",
        String(error?.message || error || "No se pudo consultar Telegram del cliente.")
      );
    }
  }
);

export const unlinkClientTelegramAccount = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    await assertTelegramAccess(request, "link");
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Sesion requerida.");
    }

    const clientId = String(request.data?.clientId || "").trim();

    if (!clientId) {
      throw new HttpsError("invalid-argument", "clientId requerido.");
    }

    try {
      const result = await unlinkClientTelegramAccountForClient(uid, clientId);

      return {
        ok: true,
        ...result,
      };
    } catch (error: any) {
      throw new HttpsError(
        "failed-precondition",
        String(error?.message || error || "No se pudo desvincular Telegram del cliente.")
      );
    }
  }
);
