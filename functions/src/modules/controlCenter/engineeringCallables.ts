import { onCall } from "firebase-functions/v2/https";
import { context } from "./callables";
import { engineeringCatalog } from "./engineeringCatalog";

export const getControlCenterEngineering = onCall(
  { region: "us-central1", cors: true, timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    await context(request, true);
    return { ok: true, ...engineeringCatalog() };
  },
);
