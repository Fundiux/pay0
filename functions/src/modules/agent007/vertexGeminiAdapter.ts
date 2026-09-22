import { getApp } from "firebase-admin/app";
import { legacyPrompt, HUGO_PROMPT_VERSION } from "./hugoCore/legacyPrompt";
import { HugoModelAdapter, ModelOutput, HugoModelRequest, HugoModelResponse } from "./hugoCore/modelContract";
import { hugoV2Prompt, HUGO_V2_PROMPT_VERSION } from "./hugoCore/hugoV2Prompt";

const clean = (value: unknown, max = 1000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
export class VertexGeminiAdapter implements HugoModelAdapter {
  async generateCanonical(request: HugoModelRequest): Promise<HugoModelResponse> {
    const context = request.intelligence.contextSnapshot;
    const response = await this.generate({ message: request.task.userInput, name: request.task.name, context, history: request.conversation.history, promptVersion: request.generation.promptVersion });
    return { ...response, answer: response.text, claims: [], entityReferences: [], uncertainties: [], proposedActions: [] };
  }
  async generate(input: { message: string; name: string; context: any; history: any[]; promptVersion?: string }): Promise<ModelOutput> {
    const version = input.promptVersion === HUGO_V2_PROMPT_VERSION ? HUGO_V2_PROMPT_VERSION : HUGO_PROMPT_VERSION;
    const base = { model: "gemini-2.5-flash", modelVersion: "publisher-model", provider: "GOOGLE_VERTEX", promptVersion: version, tokenUsage: null };
    try {
      if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) return { ...base, text: null, error: "EMULATOR_DISABLED" };
      const credential: any = getApp().options.credential;
      if (!credential?.getAccessToken) return { ...base, text: null, error: "CREDENTIAL_UNAVAILABLE" };
      const token = await credential.getAccessToken();
      const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "pay-0-system";
      const endpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;
      const { system, prompt } = version === HUGO_V2_PROMPT_VERSION ? hugoV2Prompt(input.message, input.name, input.context, input.history) : legacyPrompt(input.message, input.name, input.context, input.history);
      const generate = async (requestPrompt: string, maxOutputTokens: number) => {
        const response = await fetch(endpoint, {
          method: "POST", headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: requestPrompt }] }], generationConfig: { temperature: 0.35, maxOutputTokens } }),
          signal: AbortSignal.timeout(35_000),
        });
        if (!response.ok) { console.warn("[Hugo] Vertex response", response.status); return { text: null, finishReason: `HTTP_${response.status}`, usage: null }; }
        const payload: any = await response.json();
        const candidate = payload?.candidates?.[0];
        return { text: clean(candidate?.content?.parts?.map((part: any) => part?.text || "").join(" "), 6000) || null,
          finishReason: clean(candidate?.finishReason, 40).toUpperCase(), usage: payload?.usageMetadata || null };
      };
      const first = await generate(prompt, 1200);
      if (first.text && first.finishReason === "STOP") return { ...base, text: first.text, tokenUsage: first.usage ? { input: first.usage.promptTokenCount, output: first.usage.candidatesTokenCount } : null };
      if (first.finishReason === "MAX_TOKENS") {
        console.warn("[Hugo] Vertex output reached token limit; retrying compact response");
        const compactPrompt = `${prompt}\n\nINSTRUCCIÓN DE FORMATO OBLIGATORIA: Responde de nuevo de forma completa y compacta. Resume por estado, incluye como máximo 8 folios representativos, indica cuántos adicionales hay y termina todas las frases.`;
        const retry = await generate(compactPrompt, 1200);
        if (retry.text && retry.finishReason === "STOP") return { ...base, text: retry.text, tokenUsage: retry.usage ? { input: retry.usage.promptTokenCount, output: retry.usage.candidatesTokenCount } : null };
        console.warn("[Hugo] Discarded incomplete retry", retry.finishReason || "UNKNOWN");
      } else if (first.text) console.warn("[Hugo] Discarded non-final Vertex output", first.finishReason || "UNKNOWN");
      return { ...base, text: null, error: first.finishReason || "NO_FINAL_RESPONSE" };
    } catch { console.warn("[Hugo] Vertex unavailable"); return { ...base, text: null, error: "VERTEX_UNAVAILABLE" }; }
  }
}
