import { onCall } from "firebase-functions/v2/https";
import { prepareDocumentDeliveryJobCore } from "./service";

export const prepareDocumentDeliveryJob = onCall(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (request) => {
    return await prepareDocumentDeliveryJobCore(request);
  }
);