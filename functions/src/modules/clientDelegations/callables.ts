import { onCall } from "firebase-functions/v2/https";
import {
  getUserClientAccessConfigService,
  setUserClientAccessService,
} from "./service";

export const getUserClientAccessConfig = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    return getUserClientAccessConfigService(request);
  }
);

export const setUserClientAccess = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    return setUserClientAccessService(request);
  }
);