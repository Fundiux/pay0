import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type AgentAutonomyReport = {
  openIncidents: number; resolvedByAgent: number; resolvedByPerson: number; agentResolutionRate: number | null;
  runsSucceeded: number; runsFinished: number; avgRunMs: number | null; avgTimeToResolveMs: number | null; humanInterventionsToday: number;
  resolvedBySystem?: number; resolvedByHugo?: number;
};

export type AgentOperations = {
  systems: Array<{ id: string; name: string; status: string; contextNamespace: string; agentIds: string[]; connections: Array<{ sourceSystemId: string; contractId: string; approved: boolean }> }>;
  agents: Array<{ id: string; name: string; specialty: string; enabled: boolean; provider: string | null; model: string | null }>;
  tools: Array<{ id: string; risk: number; approvalRequired: boolean }>;
  providers: Record<string, { status: string; model: string | null }>;
  killSwitch: boolean;
  runs: Array<{ id: string; status: string; agentId: string; entityId: string; reason?: string }>;
  incidents: Array<{ id: string; status: string; cause: string; entityType?: string; entityId: string }>;
  incidentGroups?: Array<{ id: string; status: string; entityType?: string; entityId: string; causes: string[]; count: number; ids: string[];
    resolverTier: "SYSTEM" | "HUGO" | "PERSON" | null; autoResolved: boolean | null; resolutionText: string | null; resolvedAtMs: number | null;
    subject: { kind: "SOLICITUD" | "PAGO" | "DISPERSION"; entityId: string; folio: string | null; clientName: string | null; amount: number | null; currency: string | null; providerName: string | null } | null }>;
  proposals: Array<{ id: string; status: string; problem: string; evidence?: string[]; impact?: string; risk?: string; scope?: string; rollback?: string }>;
  report: { day: string; reviewed: number; detected: number; incidents: number; generated: number; corrected: number; verified: number; escalated: number; retryable: number; causes: Array<{ cause: string; count: number }>; autonomy?: AgentAutonomyReport; tokens?: Array<{ provider: string; requests: number; input: number; output: number; reasoning: number }> };
  automation?: {
    killSwitch: boolean; undoneRate: number | null; verifiedActions: number; undoneActions: number;
    rules: Array<{ id: string; causeLabel: string; toolLabel: string; status: "PROPUESTA" | "SIMULACION" | "ACTIVA" | "RECHAZADA" | "REVOCADA"; statusLabel: string; paused: boolean; dailyCap: number; evidenceCount: number; simulationEndsAtMs: number | null; simulatedToday: number; executedToday: number }>;
  } | null;
  reportScope: string;
};
export type AutomationAction = "APPROVE" | "REJECT" | "REVOKE" | "PAUSE" | "RESUME" | "KILL_ON" | "KILL_OFF";

export async function getAgentOperations() {
  return (await httpsCallable<Record<string, never>, AgentOperations>(functions, "getAgentOperations")({})).data;
}
export async function setAgentKillSwitch(enabled: boolean) {
  return (await httpsCallable<{ enabled: boolean }, { ok: boolean; enabled: boolean }>(functions, "setAgentKillSwitch")({ enabled })).data;
}
export async function reviewAgentProposal(proposalId: string, status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED") {
  return (await httpsCallable<{ proposalId: string; status: string }, { ok: boolean; status: string; executeAutomatically: false }>(functions, "reviewAgentProposal")({ proposalId, status })).data;
}
export async function resolveAgentIncident(incidentId: string, reason: string) {
  return (await httpsCallable<{ incidentId: string; reason: string }, { ok: boolean }>(functions, "resolveAgentIncident")({ incidentId, reason })).data;
}
export async function reviewAgentAutomationRule(action: AutomationAction, ruleId?: string) {
  return (await httpsCallable<{ action: AutomationAction; ruleId?: string }, { ok: boolean; status?: string; killSwitch?: boolean }>(functions, "reviewAgentAutomationRule")({ action, ruleId })).data;
}
