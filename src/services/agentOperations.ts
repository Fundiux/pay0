import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type AgentOperations = {
  agents: Array<{ id: string; name: string; specialty: string; enabled: boolean; provider: string | null; model: string | null }>;
  tools: Array<{ id: string; risk: number; approvalRequired: boolean }>;
  killSwitch: boolean;
  runs: Array<{ id: string; status: string; agentId: string; entityId: string; reason?: string }>;
  incidents: Array<{ id: string; status: string; cause: string; entityId: string }>;
  proposals: Array<{ id: string; status: string; problem: string }>;
  report: { reviewed: number; detected: number; corrected: number; escalated: number };
  reportScope: string;
};

export async function getAgentOperations() {
  return (await httpsCallable<Record<string, never>, AgentOperations>(functions, "getAgentOperations")({})).data;
}
export async function setAgentKillSwitch(enabled: boolean) {
  return (await httpsCallable<{ enabled: boolean }, { ok: boolean; enabled: boolean }>(functions, "setAgentKillSwitch")({ enabled })).data;
}
