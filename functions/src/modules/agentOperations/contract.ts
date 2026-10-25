export type AgentRunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED_RETRYABLE" | "BLOCKED" | "ESCALATED";
export type ProviderState = "CONNECTED" | "NOT_CONFIGURED" | "DEGRADED" | "ERROR";
export type RiskLevel = 1 | 2 | 3;
export type AgentDefinition = { id: string; name: string; specialty: string; kind: "ORCHESTRATOR" | "WORKER" | "DEFENSE" | "SANDBOX"; owner: string; enabled: boolean; provider: string | null; model: string | null; permissions: string[]; limits: { maxAttempts: number; maxPerRun: number } };
export type ToolDefinition = { id: string; inputSchema: string; outputSchema: string; permission: string; risk: RiskLevel; idempotent: boolean; reversible: boolean; maxRetries: number; evidence: string[]; approvalRequired: boolean };
export type AgentProposal = { problem: string; evidence: string[]; impact: string; risk: string; scope: string; effort: string; rollback: string; status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED"; executeAutomatically: false };
export type OperationalMemory = { incidentId: string; rootCause: string; action: string; validatedOutcome: string; confidence: number; learnedRule: string; grantsPermissions: false };
export type SentinelDecision = "NORMAL" | "SUSPICIOUS" | "RESTRICTED" | "QUARANTINE" | "BLOCKED";

export const AGENTS: AgentDefinition[] = [
  { id: "hugo", name: "Hugo", specialty: "Orquestación", kind: "ORCHESTRATOR", owner: "PAY0", enabled: true, provider: "GOOGLE_VERTEX", model: "gemini-2.5-flash", permissions: ["diagnose", "propose"], limits: { maxAttempts: 1, maxPerRun: 100 } },
  { id: "maria", name: "María", specialty: "Conversación global", kind: "WORKER", owner: "PAY0", enabled: true, provider: "GOOGLE_VERTEX", model: "gemini-2.5-flash", permissions: ["diagnose"], limits: { maxAttempts: 1, maxPerRun: 100 } },
  { id: "sofia", name: "Sofía", specialty: "Análisis", kind: "WORKER", owner: "PAY0", enabled: false, provider: null, model: null, permissions: [], limits: { maxAttempts: 0, maxPerRun: 0 } },
  { id: "sentinel", name: "Sentinel", specialty: "Defensa y evidencia", kind: "DEFENSE", owner: "PAY0", enabled: false, provider: null, model: null, permissions: ["observe"], limits: { maxAttempts: 0, maxPerRun: 100 } },
  ...["iq", "expediente", "pagos", "conciliacion", "documentos", "soporte"].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), specialty: id, kind: "WORKER" as const, owner: "PAY0", enabled: id === "expediente", provider: null, model: null, permissions: id === "expediente" ? ["diagnose", "recoverQuotation"] : [], limits: { maxAttempts: 2, maxPerRun: 100 } })),
  { id: "agent-creator", name: "Creador de agentes", specialty: "Prototipos en sandbox", kind: "SANDBOX", owner: "PAY0", enabled: false, provider: null, model: null, permissions: ["propose"], limits: { maxAttempts: 0, maxPerRun: 0 } },
];

export const TOOLS: ToolDefinition[] = [
  { id: "quotation-recovery", inputSchema: "{solicitudId:string,iqFolio:string,ocUploadId:string}", outputSchema: "{uploadId:string,active:boolean}", permission: "operateSolicitudes", risk: 1, idempotent: true, reversible: true, maxRetries: 1, evidence: ["solicitud", "IQ", "OC", "upload"], approvalRequired: false },
  { id: "agent-proposal", inputSchema: "AgentProposal", outputSchema: "{proposalId:string}", permission: "superadmin", risk: 3, idempotent: true, reversible: true, maxRetries: 0, evidence: ["incident"], approvalRequired: true },
];

export function canExecuteTool(tool: ToolDefinition, approved: boolean, attempt: number, killed: boolean): boolean {
  return !killed && attempt <= tool.maxRetries + 1 && (tool.risk === 1 || approved) && (!tool.approvalRequired || approved);
}
