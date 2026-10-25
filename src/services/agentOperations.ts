import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type AgentOperations = {
  systems: Array<{ id: string; name: string; status: string; contextNamespace: string; agentIds: string[]; connections: Array<{ sourceSystemId: string; contractId: string; approved: boolean }> }>;
  agents: Array<{ id: string; name: string; specialty: string; enabled: boolean; provider: string | null; model: string | null }>;
  tools: Array<{ id: string; risk: number; approvalRequired: boolean }>;
  providers: Record<string, { status: string; model: string | null }>;
  killSwitch: boolean;
  runs: Array<{ id: string; status: string; agentId: string; entityId: string; reason?: string }>;
  incidents: Array<{ id: string; status: string; cause: string; entityType?: string; entityId: string }>;
  proposals: Array<{ id: string; status: string; problem: string; evidence?: string[]; impact?: string; risk?: string; scope?: string; rollback?: string }>;
  report: { day: string; reviewed: number; detected: number; incidents: number; generated: number; corrected: number; verified: number; escalated: number; retryable: number; causes: Array<{ cause: string; count: number }> };
  reportScope: string;
};

export async function getAgentOperations() {
  return (await httpsCallable<Record<string, never>, AgentOperations>(functions, "getAgentOperations")({})).data;
}
export async function setAgentKillSwitch(enabled: boolean) {
  return (await httpsCallable<{ enabled: boolean }, { ok: boolean; enabled: boolean }>(functions, "setAgentKillSwitch")({ enabled })).data;
}
export async function reviewAgentProposal(proposalId: string, status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED") {
  return (await httpsCallable<{ proposalId: string; status: string }, { ok: boolean; status: string; executeAutomatically: false }>(functions, "reviewAgentProposal")({ proposalId, status })).data;
}
