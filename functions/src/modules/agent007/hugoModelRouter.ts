import { HugoModelAdapter, HugoModelRequest, HugoModelResponse, ModelOutput } from "./hugoCore/modelContract";
import { VertexGeminiAdapter, geminiMaxOutputTokens } from "./vertexGeminiAdapter";
import { OpenAiResponsesAdapter } from "./openAiResponsesAdapter";

const fallbackErrors = new Set(["RATE_LIMIT", "MAX_TOKENS", "MODEL_TIMEOUT", "PROVIDER_UNAVAILABLE", "VERTEX_UNAVAILABLE", "SERVICE_UNAVAILABLE"]);
export class HugoModelRouter implements HugoModelAdapter {
  constructor(private readonly gemini = new VertexGeminiAdapter(), private readonly openai = new OpenAiResponsesAdapter()) {}
  status() { return { gemini: { status: "CONFIGURED", model: "gemini-2.5-flash", maxOutputTokens: geminiMaxOutputTokens() }, openai: { status: this.openai.isConfigured() ? "CONFIGURED" : "NOT_CONFIGURED", model: process.env.HUGO_OPENAI_MODEL || "gpt-6-sol", maxOutputTokens: Number(process.env.HUGO_OPENAI_MAX_OUTPUT_TOKENS || 8000) }, local: { status: "NOT_IMPLEMENTED", model: null, maxOutputTokens: null } }; }
  async generate(input: { message: string; name: string; context: any; history: any[]; promptVersion?: string }): Promise<ModelOutput> { return this.gemini.generate(input); }
  async generateCanonical(request: HugoModelRequest): Promise<HugoModelResponse> {
    const programmer = request.task.profile === "PROGRAMMER";
    const primary = programmer && this.openai.isConfigured() ? this.openai : this.gemini;
    const secondary = primary === this.openai ? this.gemini : this.openai;
    const first = await primary.generateCanonical!(request);
    if (!first.error || !fallbackErrors.has(first.error) || secondary === this.openai && !this.openai.isConfigured()) return first;
    const second = await secondary.generateCanonical!(request);
    return { ...second, routing: { primaryProvider: first.provider || "UNKNOWN", fallbackProvider: second.provider || "UNKNOWN", fallbackReason: first.error } } as HugoModelResponse;
  }
}
