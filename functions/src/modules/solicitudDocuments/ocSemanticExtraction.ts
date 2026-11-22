/**
 * Optional semantic OC extraction (layer 3).
 *
 * Runs only when the deterministic and tolerant layers could not accept an OC
 * and OC_SEMANTIC_EXTRACTION_ENABLED is "true" (off by default). It uses the
 * Vertex AI Gemini endpoint the project already uses for Hugo, authenticated
 * by the Functions service account, so no new secret is needed.
 *
 * The model output is never trusted blindly: every figure and the RFC must be
 * literally present in the source text, and the candidate passes the same
 * arithmetic/client/solicitud validation as the tolerant layer. By default the
 * result is always REVIEW_REQUIRED; auto-acceptance needs the separate owner
 * flag OC_SEMANTIC_AUTO_ACCEPT plus high confidence.
 */
import { getApp } from "firebase-admin/app";
import { OcCandidate, OcRecognitionResult, OcSourceFormat, OcValidationContext, parseFlexibleOcDate, parseLocaleAmount, roundCents, validateOcCandidate } from "./ocRecognition";

export const OC_SEMANTIC_AUTO_ACCEPT_MIN_CONFIDENCE = 0.95;
const MAX_SOURCE_CHARS = 20_000;

export const isOcSemanticExtractionEnabled = () => process.env.OC_SEMANTIC_EXTRACTION_ENABLED === "true";
const semanticAutoAcceptAllowed = () => process.env.OC_SEMANTIC_AUTO_ACCEPT === "true";
const semanticModel = () => String(process.env.OC_SEMANTIC_MODEL || "gemini-2.5-flash").replace(/[^a-z0-9.-]/gi, "") || "gemini-2.5-flash";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: { type: "ARRAY", items: { type: "OBJECT", properties: {
      quantity: { type: "NUMBER" }, unit: { type: "STRING" }, productCode: { type: "STRING" },
      description: { type: "STRING" }, unitPrice: { type: "NUMBER", nullable: true }, amount: { type: "NUMBER", nullable: true },
    }, required: ["quantity", "description"] } },
    subtotal: { type: "NUMBER", nullable: true }, iva: { type: "NUMBER", nullable: true },
    retention: { type: "NUMBER", nullable: true }, total: { type: "NUMBER", nullable: true },
    currency: { type: "STRING" }, clientName: { type: "STRING" }, clientRfc: { type: "STRING" },
    number: { type: "STRING" }, date: { type: "STRING" }, paymentMethod: { type: "STRING" },
    confidence: { type: "NUMBER" },
  },
  required: ["items", "total", "confidence"],
};

const SYSTEM_PROMPT = [
  "Extraes datos de una orden de compra mexicana. Responde solo JSON conforme al esquema.",
  "Copia los importes exactamente como aparecen en el documento, como numero decimal con punto.",
  "No calcules ni inventes valores: si un dato no aparece, usa null o cadena vacia.",
  "clientRfc es el RFC del comprador (cliente), no del proveedor. date en formato AAAA-MM-DD.",
  "confidence es tu certeza global entre 0 y 1.",
].join(" ");

/** Every number the source text states, as cents, to reject invented figures. */
function statedAmounts(text: string): Set<number> {
  const found = new Set<number>();
  for (const token of text.match(/\(?-?\$?\d[\d.,']*\d\)?|\d/g) || []) {
    const value = parseLocaleAmount(token.trim());
    if (value !== null) found.add(Math.round(roundCents(Math.abs(value)) * 100));
  }
  return found;
}

export type SemanticModelCall = (input: { system: string; prompt: string; schema: unknown; model: string }) => Promise<string | null>;

async function callVertexGemini(input: { system: string; prompt: string; schema: unknown; model: string }): Promise<string | null> {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) return null;
  const credential: any = getApp().options.credential;
  if (!credential?.getAccessToken) return null;
  const token = await credential.getAccessToken();
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "pay-0-system";
  const endpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models/${input.model}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST", headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: "user", parts: [{ text: input.prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: "application/json", responseSchema: input.schema },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return null;
  const payload: any = await response.json();
  const candidate = payload?.candidates?.[0];
  if (String(candidate?.finishReason || "").toUpperCase() !== "STOP") return null;
  return String(candidate?.content?.parts?.map((part: any) => part?.text || "").join("") || "") || null;
}

const text = (value: unknown, max = 1000) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const num = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Semantic extraction of an OC's text. Returns null when disabled or when the
 * model is unavailable; otherwise a validated result (REVIEW_REQUIRED unless
 * the owner enabled semantic auto-acceptance and every check passes).
 */
export async function extractOcSemantically(sourceText: string, format: OcSourceFormat, context: OcValidationContext, call: SemanticModelCall = callVertexGemini, enabled = isOcSemanticExtractionEnabled()): Promise<OcRecognitionResult | null> {
  if (!enabled) return null;
  const source = String(sourceText || "").slice(0, MAX_SOURCE_CHARS);
  if (source.replace(/\s/g, "").length < 20) return null;
  let raw: string | null = null;
  try { raw = await call({ system: SYSTEM_PROMPT, prompt: `Documento:\n${source}`, schema: RESPONSE_SCHEMA, model: semanticModel() }); }
  catch { raw = null; }
  if (!raw) return null;
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const stated = statedAmounts(source);
  const upperSource = source.toUpperCase();
  const issues: string[] = [];
  const checkStated = (value: number | null) => {
    if (value !== null && !stated.has(Math.round(roundCents(Math.abs(value)) * 100))) issues.push("SEMANTIC_VALUE_NOT_IN_SOURCE");
    return value;
  };
  const items = (Array.isArray(parsed?.items) ? parsed.items : []).slice(0, 200).map((item: any) => ({
    quantity: num(item?.quantity) ?? 0,
    unit: text(item?.unit, 20).toUpperCase(),
    productCode: /^\d{8}$/.test(text(item?.productCode, 16)) ? text(item?.productCode, 16) : "",
    description: text(item?.description),
    unitPrice: checkStated(num(item?.unitPrice)),
    amount: checkStated(num(item?.amount)),
  }));
  const rfc = text(parsed?.clientRfc, 20).toUpperCase().replace(/[^A-Z0-9Ñ&]/g, "");
  // An RFC the document does not contain is a hallucination, not a value.
  const clientRfc = rfc && upperSource.replace(/[^A-Z0-9Ñ&]/g, "").includes(rfc) ? rfc : "";
  if (rfc && !clientRfc) issues.push("SEMANTIC_VALUE_NOT_IN_SOURCE");
  const currency = text(parsed?.currency, 10).toUpperCase();
  const candidate: OcCandidate = {
    items,
    subtotal: checkStated(num(parsed?.subtotal)), iva: checkStated(num(parsed?.iva)),
    retention: checkStated(num(parsed?.retention)), total: checkStated(num(parsed?.total)),
    currency: !currency || currency === "MXN" || currency === "MXP" ? "MXN" : currency,
    clientName: text(parsed?.clientName, 200), clientRfc, rfcs: clientRfc ? [clientRfc] : [],
    number: /^[A-Z0-9-]{1,30}$/i.test(text(parsed?.number, 40)) && /\d/.test(text(parsed?.number, 40)) ? text(parsed?.number, 40) : "",
    date: parseFlexibleOcDate(parsed?.date), paymentMethod: /^(PUE|PPD)$/.test(text(parsed?.paymentMethod, 3).toUpperCase()) ? text(parsed?.paymentMethod, 3).toUpperCase() : "",
  };
  if (candidate.currency !== "MXN") issues.push("FOREIGN_CURRENCY");
  if (!currency) issues.push("CURRENCY_ASSUMED_MXN");
  const modelConfidence = Math.min(1, Math.max(0, num(parsed?.confidence) ?? 0));
  const mayAutoAccept = semanticAutoAcceptAllowed() && modelConfidence >= OC_SEMANTIC_AUTO_ACCEPT_MIN_CONFIDENCE;
  if (!mayAutoAccept) issues.push("SEMANTIC_REQUIRES_REVIEW");
  if (issues.includes("SEMANTIC_VALUE_NOT_IN_SOURCE")) issues.push("SEMANTIC_REQUIRES_REVIEW");
  const validated = validateOcCandidate(candidate, context, issues, OC_SEMANTIC_AUTO_ACCEPT_MIN_CONFIDENCE);
  return {
    status: validated.status, layer: "SEMANTIC", format,
    confidence: Math.min(validated.confidence, modelConfidence), issues: validated.issues, candidate: validated.candidate,
  };
}
