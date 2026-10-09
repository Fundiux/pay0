const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const functionsRoot = path.resolve(__dirname, "../../functions");
const { classifyHugoProfile } = require(path.join(functionsRoot, "lib/modules/agent007/hugoCore/runtimeContract.js"));
const { HugoModelRouter } = require(path.join(functionsRoot, "lib/modules/agent007/hugoModelRouter.js"));
const { geminiMaxOutputTokens } = require(path.join(functionsRoot, "lib/modules/agent007/vertexGeminiAdapter.js"));

const response = (provider, error) => ({ text: error ? null : "ok", answer: error ? null : "ok", model: provider, modelVersion: "test", provider, promptVersion: "test", tokenUsage: null, claims: [], entityReferences: [], uncertainties: [], proposedActions: [], ...(error ? { error } : {}) });
const request = (profile = "OPERATOR") => ({ task: { profile } });

test("classifies technical work independently from the model provider", () => {
  assert.equal(classifyHugoProfile("revisa este error de TypeScript"), "PROGRAMMER");
  assert.equal(classifyHugoProfile("cuántas solicitudes siguen pendientes"), "OPERATOR");
});

test("uses one provider when the primary succeeds", async () => {
  let geminiCalls = 0, openAiCalls = 0;
  const gemini = { generate: async () => response("GOOGLE_VERTEX"), generateCanonical: async () => { geminiCalls++; return response("GOOGLE_VERTEX"); } };
  const openai = { isConfigured: () => true, generate: async () => response("OPENAI"), generateCanonical: async () => { openAiCalls++; return response("OPENAI"); } };
  const result = await new HugoModelRouter(gemini, openai).generateCanonical(request());
  assert.equal(result.provider, "GOOGLE_VERTEX");
  assert.equal(geminiCalls, 1);
  assert.equal(openAiCalls, 0);
});

test("falls back once only for a real provider failure", async () => {
  let geminiCalls = 0, openAiCalls = 0;
  const gemini = { generate: async () => response("GOOGLE_VERTEX"), generateCanonical: async () => { geminiCalls++; return response("GOOGLE_VERTEX"); } };
  const openai = { isConfigured: () => true, generate: async () => response("OPENAI"), generateCanonical: async () => { openAiCalls++; return response("OPENAI", "RATE_LIMIT"); } };
  const result = await new HugoModelRouter(gemini, openai).generateCanonical(request("PROGRAMMER"));
  assert.equal(result.provider, "GOOGLE_VERTEX");
  assert.equal(openAiCalls, 1);
  assert.equal(geminiCalls, 1);
  assert.equal(result.routing.fallbackReason, "RATE_LIMIT");
});

test("Gemini output limit is bounded and configurable", () => {
  const before = process.env.HUGO_GEMINI_MAX_OUTPUT_TOKENS;
  process.env.HUGO_GEMINI_MAX_OUTPUT_TOKENS = "5000";
  assert.equal(geminiMaxOutputTokens(), 5000);
  process.env.HUGO_GEMINI_MAX_OUTPUT_TOKENS = "99999";
  assert.equal(geminiMaxOutputTokens(), 8192);
  if (before === undefined) delete process.env.HUGO_GEMINI_MAX_OUTPUT_TOKENS; else process.env.HUGO_GEMINI_MAX_OUTPUT_TOKENS = before;
});

test("conversation bubble stays quiet and preserves reading position", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/components/HugoFloatingBubble.tsx"), "utf8");
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.match(source, /Ir al mensaje más reciente/);
  assert.match(source, /if \(nearBottom\)/);
});
