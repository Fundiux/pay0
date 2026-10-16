import { HugoModelAdapter, HugoModelRequest, HugoModelResponse, ModelOutput } from "./hugoCore/modelContract";
import { hugoV2Prompt } from "./hugoCore/hugoV2Prompt";

const clean = (value: unknown, max = 6000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const configured = () => process.env.HUGO_OPENAI_ENABLED === "true" && Boolean(process.env.OPENAI_API_KEY);

export class OpenAiResponsesAdapter implements HugoModelAdapter {
  readonly provider = "OPENAI";
  isConfigured() { return configured(); }
  async generate(input: { message: string; name: string; context: any; history: any[]; promptVersion?: string }): Promise<ModelOutput> {
    return this.generateCanonical!({ schemaVersion: "hugo-model-request-v1", task: { userInput: input.message, intent: "GENERAL", name: input.name },
      conversation: { history: input.history, activeEntity: input.context?.activeEntity || null }, intelligence: { contextSnapshot: input.context, currentEvidence: input.context,
        historicalMemories: [], historicalObservations: [], learningExperiences: [], evidenceBoundaries: {}, conflicts: [], allowedActions: [] },
      generation: { promptVersion: input.promptVersion || "hugo-v2", capability: "STRONG_EXTERNAL" } });
  }
  async generateCanonical(request: HugoModelRequest): Promise<HugoModelResponse> {
    const model = process.env.HUGO_OPENAI_MODEL || "gpt-6-sol";
    const outputLimit = Math.min(Math.max(Number(process.env.HUGO_OPENAI_MAX_OUTPUT_TOKENS) || 8000, 1000), 32000);
    const base = { text: null, answer: null, claims: [], entityReferences: [], uncertainties: [], proposedActions: [], model, modelVersion: model,
      provider: "OPENAI", promptVersion: request.generation.promptVersion, tokenUsage: null };
    if (!configured()) return { ...base, error: "PROVIDER_NOT_CONFIGURED" };
    const started = Date.now();
    try {
      const { system, prompt } = hugoV2Prompt(request.task.userInput, request.task.name, request.intelligence.contextSnapshot, request.conversation.history);
      const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model, reasoning: { effort: process.env.HUGO_OPENAI_REASONING_EFFORT || "low" }, max_output_tokens: outputLimit,
          input: [{ role: "developer", content: system }, { role: "user", content: prompt }] }), signal: AbortSignal.timeout(45_000) });
      if (!response.ok) return { ...base, error: response.status === 429 ? "RATE_LIMIT" : response.status >= 500 ? "SERVICE_UNAVAILABLE" : `HTTP_${response.status}`, attempts: [{ finishReason: `HTTP_${response.status}`, latencyMs: Date.now() - started, promptChars: 0, outputLimit, inputTokens: null, outputTokens: null, cachedInputTokens: null, reasoningTokens: null }] };
      const payload: any = await response.json();
      const text = clean(payload.output_text || payload.output?.flatMap((item: any) => item.content || []).map((item: any) => item.text || "").join(" ")) || null;
      const usage = payload.usage || {};
      const incomplete = payload.status === "incomplete" ? clean(payload.incomplete_details?.reason, 80) || "INCOMPLETE" : null;
      return { ...base, text, answer: text, tokenUsage: { input: usage.input_tokens, output: usage.output_tokens, cachedInput: usage.input_tokens_details?.cached_tokens, reasoning: usage.output_tokens_details?.reasoning_tokens },
        attempts: [{ finishReason: incomplete || "STOP", latencyMs: Date.now() - started, promptChars: 0, outputLimit,
          inputTokens: usage.input_tokens ?? null, outputTokens: usage.output_tokens ?? null, cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? null, reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? null }],
        ...(incomplete ? { text: null, answer: null, error: incomplete === "max_output_tokens" ? "MAX_TOKENS" : incomplete.toUpperCase() } : {}) };
    } catch (error) { return { ...base, error: error instanceof Error && /timeout|abort/i.test(error.name + error.message) ? "MODEL_TIMEOUT" : "PROVIDER_UNAVAILABLE" }; }
  }
}
