export const HUGO_MODEL_REQUEST_VERSION = "hugo-model-request-v1";
export type HugoModelRequest = { schemaVersion: typeof HUGO_MODEL_REQUEST_VERSION; task: { userInput: string; intent: string; name: string; profile?: "OPERATOR" | "PROGRAMMER"; scope?: "GLOBAL" | "PAY0" }; conversation: { history: any[]; activeEntity: { type: string; folio: string } | null };
  intelligence: { contextSnapshot: any; currentEvidence: any; historicalMemories: any[]; historicalObservations: any[]; learningExperiences: any[]; evidenceBoundaries: any; conflicts: any[]; allowedActions: string[] };
  generation: { promptVersion: string; capability: "FAST_EXTERNAL" | "STRONG_EXTERNAL" | "LOCAL" } };
export type ModelAttempt = { finishReason: string; latencyMs: number; promptChars: number; outputLimit: number; inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; reasoningTokens: number | null };
export type ModelOutput = { text: string | null; model: string; modelVersion: string; provider?: string; promptVersion: string;
  tokenUsage: { input?: number; output?: number; cachedInput?: number; reasoning?: number } | null; attempts?: ModelAttempt[]; error?: string };
export type HugoModelResponse = ModelOutput & { answer: string | null; claims: Array<{ text: string; evidenceIds: string[] }>; entityReferences: string[]; uncertainties: string[]; proposedActions: string[]; routing?: { primaryProvider: string; fallbackProvider?: string; fallbackReason?: string } };
export interface HugoModelAdapter {
  generate(input: { message: string; name: string; context: any; history: any[]; promptVersion?: string }): Promise<ModelOutput>;
  generateCanonical?(request: HugoModelRequest): Promise<HugoModelResponse>;
}
export function canonicalModelRequest(input: { message: string; name: string; context: any; history: any[]; promptVersion: string; capability?: HugoModelRequest["generation"]["capability"]; profile?: "OPERATOR" | "PROGRAMMER"; scope?: "GLOBAL" | "PAY0" }): HugoModelRequest {
  const context = input.context || {};
  return { schemaVersion: HUGO_MODEL_REQUEST_VERSION, task: { userInput: input.message, intent: String(context.questionIntent || "GENERAL"), name: input.name, profile: input.profile, scope: input.scope },
    conversation: { history: input.history, activeEntity: context.activeEntity || null },
    intelligence: { contextSnapshot: context, currentEvidence: { solicitudes: context.solicitudes || [], pagos: context.pagos || [], complementosPendientes: context.complementosPendientes || [], capacidadesIq: context.capacidadesIq || {} },
      historicalMemories: context.memoriasHistoricas || [], historicalObservations: context.observacionesHistoricasNoVerificadas || [], learningExperiences: context.learningExperiences || [],
      evidenceBoundaries: context.evidenceBoundaries || {}, conflicts: context.memoryConflicts || [], allowedActions: [] },
    generation: { promptVersion: input.promptVersion, capability: input.capability || "FAST_EXTERNAL" } };
}
