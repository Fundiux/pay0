import { onSchedule } from "firebase-functions/v2/scheduler";
import { TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS } from "./clientNotifications";
import { consumeTelegramInvoiceNotificationQueue } from "./invoiceNotificationConsumer";

export const processTelegramInvoiceNotificationQueue = onSchedule({
  schedule: "every 1 minutes", region: "us-central1", timeZone: "UTC",
  timeoutSeconds: 120, memory: "1GiB", maxInstances: 1, concurrency: 1,
  retryCount: 0, secrets: [TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS],
}, async () => { await consumeTelegramInvoiceNotificationQueue(); });
