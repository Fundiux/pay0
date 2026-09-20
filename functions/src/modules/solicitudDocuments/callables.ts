import { logger } from "firebase-functions";
import { onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import {
  deactivateSolicitudDocumentCore,
  finalizeSolicitudDocumentUploadCore,
  initSolicitudDocumentUploadCore,
  reprocessActiveSolicitudOcCore,
} from "./service";
import {
  notifyClientFacturaDisponibleFromUploadId,
  TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS,
} from "../telegram/clientNotifications";

export const initSolicitudDocumentUpload = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const caller = await getMyUser(requireAuth(request));
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "uploadDocs" });
    return await initSolicitudDocumentUploadCore(request);
  }
);

export const finalizeSolicitudDocumentUpload = onCall(
  {
    cors: true,
    timeoutSeconds: 120,
    // La carga de una OC puede regenerar la cotizacion canonica HTML/CSS.
    // Chromium requiere mas margen que un upload ordinario.
    memory: "1GiB",
    secrets: [TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS],
  },
  async (request) => {
    const caller = await getMyUser(requireAuth(request));
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "uploadDocs" });
    const result = await finalizeSolicitudDocumentUploadCore(request);

    try {
      const uploadId = String(
        request?.data?.uploadId ||
        (result as any)?.uploadId ||
        ""
      ).trim();

      const notifyResult = await notifyClientFacturaDisponibleFromUploadId(uploadId);

      logger.info("Factura cliente Telegram automatico", {
        uploadId,
        notified: notifyResult.notified,
        reason: notifyResult.reason,
        sentCount: notifyResult.sentCount || 0,
      });
    } catch (error: any) {
      logger.error("Factura cliente Telegram automatico error", {
        message: String(error?.message || error || "unknown"),
        stack: String(error?.stack || ""),
      });
    }

    return result;
  }
);

export const deactivateSolicitudDocument = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const caller = await getMyUser(requireAuth(request));
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "uploadDocs" });
    return await deactivateSolicitudDocumentCore(request);
  }
);

export const reprocessActiveSolicitudOc = onCall(
  { cors: true, timeoutSeconds: 120, memory: "1GiB" },
  async (request) => {
    const caller = await getMyUser(requireAuth(request));
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "uploadDocs" });
    return reprocessActiveSolicitudOcCore(request);
  },
);
