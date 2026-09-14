import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";
export type Agent007Observation = { id: string; caseType: string; caseId: string; intent: string; humanDecision: string; outcome: string; source?: string; sourceEvent?: string; createdAt?: any };
export async function recordAgent007Observation(input: Omit<Agent007Observation, "id" | "createdAt">) { return (await httpsCallable<typeof input, { ok: boolean; observationId: string }>(functions, "recordAgent007Observation")(input)).data; }
export async function listAgent007Observations() { return (await httpsCallable<Record<string, never>, { ok: boolean; observations: Agent007Observation[] }>(functions, "listAgent007Observations")({})).data; }
