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

    // The authorized finalization transaction persists the notification intent.
    // Delivery is owned exclusively by the queue consumer; never repeat the core.
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
