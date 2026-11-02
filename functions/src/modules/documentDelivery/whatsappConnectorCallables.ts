import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../sharedCallables/helpers";
import { WhatsAppConnectorAuthority } from "./whatsappConnectorAuthority";
const authority = new WhatsAppConnectorAuthority(db);
const options = { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" as const };
// Human endpoints retain Firebase authentication plus current canonical superadmin/root checks.
export const createWhatsAppConnectorEnrollment = onCall(options, request => authority.create(request));
export const revokeWhatsAppConnectorBinding = onCall(options, request => authority.revoke(request));
export const getWhatsAppConnectorBinding = onCall(options, request => authority.getOwned(request));
// Worker endpoints authenticate exclusively by the registered Ed25519 proof, never request root/default/heartbeat.
const worker = async (run: () => Promise<unknown>) => {
  try { return await run(); }
  catch (error) { if (error instanceof HttpsError) throw error; throw new HttpsError("permission-denied", "Prueba del conector inválida."); }
};
export const consumeWhatsAppConnectorEnrollment = onCall(options, request => worker(() => authority.consume(request.data)));
export const operateWhatsAppConnector = onCall(options, request => {
  if (!request.data || Object.keys(request.data).sort().join(",") !== "data,envelope") throw new HttpsError("invalid-argument", "Operación inválida.");
  return worker(() => authority.operate(request.data.envelope, request.data.data));
});
