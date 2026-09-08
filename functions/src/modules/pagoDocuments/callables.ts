import { defineSecret } from "firebase-functions/params";
import { onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import {
  deactivatePagoDocumentCore,
  finalizePagoDocumentUploadCore,
  initPagoDocumentUploadCore,
  updateRejectedPagoAmountForRetryCore,
} from "./service";

const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");

export const initPagoDocumentUpload = onCall(
  { region: "us-central1" },
  async (request) => {
    const caller = await getMyUser(requireAuth(request));
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "pagos", requiredAction: "create" });
    return await initPagoDocumentUploadCore(request);
  }
);

export const finalizePagoDocumentUpload = onCall(
  {
    region: "us-central1",
    secrets: [TELEGRAM_BOT_TOKEN],
  },
  async (request) => {
    const caller = await getMyUser(requireAuth(request));
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "pagos", requiredAction: "create" });
    return await finalizePagoDocumentUploadCore(request, {
      telegramBotToken: TELEGRAM_BOT_TOKEN.value(),
    });
  }
);

export const updateRejectedPagoAmountForRetry = onCall(
  {
    region: "us-central1",
    secrets: [TELEGRAM_BOT_TOKEN],
  },
  async (request) => {
    const caller = await getMyUser(requireAuth(request));
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin"], requiredModule: "pagos", requiredAction: "conciliate" });
    return await updateRejectedPagoAmountForRetryCore(request, {
      telegramBotToken: TELEGRAM_BOT_TOKEN.value(),
    });
  }
);

export const deactivatePagoDocument = onCall(
  { region: "us-central1" },
  async (request) => {
    const caller = await getMyUser(requireAuth(request));
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "pagos", requiredAction: "create" });
    return await deactivatePagoDocumentCore(request);
  }
);
