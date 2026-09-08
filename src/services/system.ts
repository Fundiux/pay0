import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export async function setMaintenanceMode(enabled: boolean, reason?: string) {
  const callable = httpsCallable(functions, "setMaintenanceMode");
  const result = await callable({ enabled, reason: reason || "" });
  return result.data as { ok: boolean; enabled: boolean; reason?: string };
}