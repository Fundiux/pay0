import type { HugoModelAdapter, HugoModelRequest, HugoModelResponse, ModelOutput } from "./hugoCore/modelContract";
import { hugoV2Prompt } from "./hugoCore/hugoV2Prompt";

const model = () => process.env.HUGO_OLLAMA_MODEL || "llama3.2:3b";
function baseUrl() {
  if (process.env.HUGO_OLLAMA_ENABLED !== "true") return null;
  try {
    const url = new URL(process.env.HUGO_OLLAMA_BASE_URL || "http://127.0.0.1:11434");
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export class OllamaLocalAdapter implements HugoModelAdapter {
  isConfigured() { return baseUrl() !== null; }
  async probe() {
    const base = baseUrl();
    if (!base) return { status: "NOT_CONFIGURED", model: model(), connected: false, dataAuthorized: false, lastSuccessfulTest: null, recentError: null };
    try {
      const [health, tags] = await Promise.all([
        fetch(`${base}/api/version`, { signal: AbortSignal.timeout(2500) }),
        fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) }),
      ]);
      if (!health.ok || !tags.ok) throw Error("HEALTH_HTTP_FAILURE");
      const payload: any = await tags.json();
      const found = Array.isArray(payload.models) && payload.models.some((row: any) => row.name === model());
      return { status: found ? "CONNECTED" : "MODEL_UNAVAILABLE", model: model(), connected: found, dataAuthorized: found && process.env.HUGO_OLLAMA_ALLOW_PAY0_DATA === "true", lastSuccessfulTest: found ? new Date().toISOString() : null, recentError: found ? null : "MODEL_NOT_INSTALLED" };
    } catch { return { status: "DISCONNECTED", model: model(), connected: false, dataAuthorized: false, lastSuccessfulTest: null, recentError: "LOCAL_HEALTH_FAILED" }; }
  }
  async generate(input: { message: string; name: string; context: any; history: any[]; promptVersion?: string }): Promise<ModelOutput> {
    return this.generateCanonical!({ schemaVersion: "hugo-model-request-v1", task: { userInput: input.message, intent: "GENERAL", name: input.name },
      conversation: { history: input.history, activeEntity: input.context?.activeEntity || null }, intelligence: { contextSnapshot: input.context, currentEvidence: input.context,
        historicalMemories: [], historicalObservations: [], learningExperiences: [], evidenceBoundaries: {}, conflicts: [], allowedActions: [] },
      generation: { promptVersion: input.promptVersion || "hugo-v2", capability: "LOCAL" } });
  }
  async generateCanonical(request: HugoModelRequest): Promise<HugoModelResponse> {
    const base = { text: null, answer: null, claims: [], entityReferences: [], uncertainties: [], proposedActions: [], model: model(), modelVersion: model(), provider: "OLLAMA_LOCAL", promptVersion: request.generation.promptVersion, tokenUsage: null };
    const endpoint = baseUrl();
    if (!endpoint) return { ...base, error: "PROVIDER_NOT_CONFIGURED" };
    if (process.env.HUGO_OLLAMA_ALLOW_PAY0_DATA !== "true") return { ...base, error: "PAY0_DATA_NOT_AUTHORIZED_FOR_LOCAL_MODEL" };
    const started = Date.now();
    try {
      const { system, prompt } = hugoV2Prompt(request.task.userInput, request.task.name, request.intelligence.contextSnapshot, request.conversation.history);
      const response = await fetch(`${endpoint}/api/generate`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: model(), system, prompt, stream: false, options: { temperature: 0.2, num_predict: 1200 } }), signal: AbortSignal.timeout(35_000) });
      if (!response.ok) return { ...base, error: response.status === 404 ? "MODEL_UNAVAILABLE" : "PROVIDER_UNAVAILABLE" };
      const payload: any = await response.json();
      const text = String(payload.response || "").trim().slice(0, 6000) || null;
      return { ...base, text, answer: text, tokenUsage: { input: Number(payload.prompt_eval_count || 0), output: Number(payload.eval_count || 0) },
        attempts: [{ finishReason: payload.done === true ? "STOP" : "INCOMPLETE", latencyMs: Date.now() - started, promptChars: system.length + prompt.length,
          outputLimit: 1200, inputTokens: Number(payload.prompt_eval_count || 0), outputTokens: Number(payload.eval_count || 0), cachedInputTokens: null, reasoningTokens: null }],
        ...(payload.done !== true || !text ? { text: null, answer: null, error: "INCOMPLETE" } : {}) };
    } catch (error) { return { ...base, error: error instanceof Error && /abort|timeout/i.test(error.name + error.message) ? "MODEL_TIMEOUT" : "PROVIDER_UNAVAILABLE" }; }
  }
}
