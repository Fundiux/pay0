import { logger } from "firebase-functions";
import { onCall } from "firebase-functions/v2/https";
import {
  deactivateDispersionDocumentCore,
  finalizeDispersionDocumentUploadCore,
  initDispersionDocumentUploadCore,
  notifyClientDispersionComprobanteFromUploadId,
} from "./service";
import { TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS } from "../telegram/clientNotifications";

export const initDispersionDocumentUpload = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    return await initDispersionDocumentUploadCore(request);
  }
);

export const finalizeDispersionDocumentUpload = onCall(
  {
    cors: true,
    timeoutSeconds: 60,
    memory: "256MiB",
    secrets: [TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS],
  },
  async (request) => {
    const result = await finalizeDispersionDocumentUploadCore(request);

    try {
      const uploadId = String(
        request?.data?.uploadId ||
        (result as any)?.uploadId ||
        ""
      ).trim();

      const notifyResult = await notifyClientDispersionComprobanteFromUploadId(
        uploadId,
        TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS.value()
      );

      logger.info("Comprobante dispersion cliente Telegram automatico", {
        uploadId,
        notified: notifyResult.notified,
        reason: notifyResult.reason,
        sentCount: notifyResult.sentCount || 0,
      });
    } catch (error: any) {
      logger.error("Comprobante dispersion cliente Telegram automatico error", {
        message: String(error?.message || error || "unknown"),
        stack: String(error?.stack || ""),
      });
    }

    return result;
  }
);

export const deactivateDispersionDocument = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    return await deactivateDispersionDocumentCore(request);
  }
);