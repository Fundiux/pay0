const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const admin = require("firebase-admin");
const config = require("./frozen-config.json");
const dataset = require("./benchmark-cases.json");

const root = path.resolve(__dirname, "../../..");
const resultPath = path.join(__dirname, "phase9-latest-results.json");
const blindPath = path.join(__dirname, "phase9-blind-review.json");
const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const splitArg = process.argv.find(value => value.startsWith("--split="))?.split("=")[1] || "DEVELOPMENT";

function readiness() {
  return {
    explicitExecution: execute,
    confirmation: process.env.HUGO_EVAL_CONFIRM === "DEVELOPMENT_VALIDATION_ONLY",
    openAiEnabled: process.env.HUGO_OPENAI_ENABLED === "true",
    openAiKey: Boolean(process.env.OPENAI_API_KEY),
    publicOpenAiKeyAbsent: !process.env.NEXT_PUBLIC_OPENAI_API_KEY,
    googleCredentials: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT),
    allowedSplit: config.splitsAllowed.includes(splitArg),
    holdoutAbsent: dataset.holdoutIncluded === false && dataset.cases.every(row => row.split !== "HOLDOUT"),
  };
}

function verifySecretNotPersisted() {
  const secret = process.env.OPENAI_API_KEY;
  if (!secret) return;
  const ignored = new Set([".git", ".next", "node_modules", "lib"]);
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && fs.statSync(target).size < 2_000_000) {
        const body = fs.readFileSync(target);
        if (body.includes(Buffer.from(secret))) throw new Error(`SECRET_EXPOSURE:${path.relative(root, target)}`);
      }
    }
  };
  visit(root);
}

const canonicalRequest = row => ({
  schemaVersion: "hugo-model-request-v1",
  task: { userInput: row.question, intent: row.category, name: "Evaluación ciega", profile: row.category === "PROGRAMMING" ? "PROGRAMMER" : "OPERATOR", scope: row.category === "CONVERSATION" || row.category === "PROGRAMMING" ? "GLOBAL" : "PAY0" },
  conversation: { history: [], activeEntity: null },
  intelligence: { contextSnapshot: { controlledEvidence: row.context, expectedToolBehavior: row.expected, evaluationOnly: true }, currentEvidence: row.context, historicalMemories: [], historicalObservations: [], learningExperiences: [], evidenceBoundaries: { synthetic: true, noExternalWrites: true }, conflicts: [], allowedActions: [] },
  generation: { promptVersion: config.promptVersion, capability: row.category === "PROGRAMMING" ? "STRONG_EXTERNAL" : "FAST_EXTERNAL" },
});

const percentile = (values, p) => values.length ? values.sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : null;
function cost(provider, usage) {
  const price = config.providers.find(row => row.id === provider).priceUsdPerMillion;
  const input = Number(usage?.input || 0), cached = Number(usage?.cachedInput || 0), output = Number(usage?.output || 0);
  return Number((((input - cached) * price.input + cached * (price.cachedInput ?? price.input) + output * price.output) / 1_000_000).toFixed(8));
}

async function main() {
  const state = readiness();
  if (!execute) { console.log(JSON.stringify({ status: "READY_FOR_CONTROLLED_EXECUTION", readiness: state }, null, 2)); return; }
  if (Object.values(state).some(value => value !== true)) throw new Error(`EVALUATION_BLOCKED:${JSON.stringify(state)}`);
  const datasetDigest = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "benchmark-cases.json"))).digest("hex");
  if (datasetDigest !== config.datasetSha256) throw new Error("EVALUATION_BLOCKED:DATASET_DIGEST_MISMATCH");
  verifySecretNotPersisted();
  const evaluatedCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()) throw new Error("EVALUATION_BLOCKED:DIRTY_WORKTREE");
  const geminiConfig = config.providers.find(row => row.id === "GOOGLE_VERTEX"), openAiConfig = config.providers.find(row => row.id === "OPENAI");
  process.env.HUGO_GEMINI_MAX_OUTPUT_TOKENS = String(geminiConfig.maxOutputTokens);
  process.env.HUGO_OPENAI_MODEL = openAiConfig.model;
  process.env.HUGO_OPENAI_REASONING_EFFORT = openAiConfig.reasoningEffort;
  process.env.HUGO_OPENAI_MAX_OUTPUT_TOKENS = String(openAiConfig.maxOutputTokens);
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "pay-0-system" });
  await admin.app().options.credential.getAccessToken();
  const { VertexGeminiAdapter } = require(path.join(root, "functions/lib/modules/agent007/vertexGeminiAdapter.js"));
  const { OpenAiResponsesAdapter } = require(path.join(root, "functions/lib/modules/agent007/openAiResponsesAdapter.js"));
  const adapters = [{ id: "GOOGLE_VERTEX", adapter: new VertexGeminiAdapter() }, { id: "OPENAI", adapter: new OpenAiResponsesAdapter() }];
  const selected = dataset.cases.filter(row => row.split === splitArg), cases = [], startedAt = new Date().toISOString();
  for (const row of selected) {
    const arms = [];
    for (const provider of adapters) {
      const started = performance.now();
      const response = await provider.adapter.generateCanonical(canonicalRequest(row));
      const latencyMs = Math.round(performance.now() - started), estimatedCostUsd = cost(provider.id, response.tokenUsage);
      arms.push({ provider: provider.id, model: response.model, response: response.answer, inputTokens: response.tokenUsage?.input ?? null, outputTokens: response.tokenUsage?.output ?? null,
        reasoningTokens: response.tokenUsage?.reasoning ?? null, totalTokens: response.tokenUsage ? Number(response.tokenUsage.input || 0) + Number(response.tokenUsage.output || 0) : null,
        latencyMs, estimatedCostUsd, error: response.error || null, retries: 0, fallback: null, toolsRequested: [], toolsExecuted: [], resultStatus: response.error ? "ERROR" : "COMPLETE" });
    }
    cases.push({ caseId: row.id, split: row.split, category: row.category, question: row.question, expected: row.expected, arms });
    fs.writeFileSync(resultPath, JSON.stringify({ schemaVersion: "hugo-model-eval-results-v1", evalRunId: config.evalRunId, evaluatedCommit, status: "RUNNING", executedAt: startedAt, realCalls: cases.length * 2, cases }, null, 2) + "\n");
  }
  const providers = {};
  for (const provider of adapters) {
    const arms = cases.flatMap(row => row.arms).filter(row => row.provider === provider.id), latencies = arms.map(row => row.latencyMs);
    providers[provider.id] = { model: arms[0]?.model, calls: arms.length, completed: arms.filter(row => !row.error).length, errors: arms.filter(row => row.error).length,
      inputTokens: arms.reduce((sum, row) => sum + Number(row.inputTokens || 0), 0), outputTokens: arms.reduce((sum, row) => sum + Number(row.outputTokens || 0), 0),
      reasoningTokens: arms.reduce((sum, row) => sum + Number(row.reasoningTokens || 0), 0), costUsd: Number(arms.reduce((sum, row) => sum + row.estimatedCostUsd, 0).toFixed(8)),
      latencyP50Ms: percentile([...latencies], 0.5), latencyP95Ms: percentile([...latencies], 0.95), humanUsefulResponses: null, costPerUsefulResponseUsd: null };
  }
  const final = { schemaVersion: "hugo-model-eval-results-v1", evalRunId: config.evalRunId, evaluatedCommit, status: "AWAITING_HUMAN_REVIEW", executedAt: startedAt, split: splitArg,
    realCalls: cases.length * 2, estimatedCostUsd: Number(Object.values(providers).reduce((sum, row) => sum + row.costUsd, 0).toFixed(8)), providers, cases };
  fs.writeFileSync(resultPath, JSON.stringify(final, null, 2) + "\n");
  const blinded = cases.map(row => { const swap = parseInt(crypto.createHash("sha256").update(`${config.evalRunId}:${row.caseId}`).digest("hex").slice(0, 2), 16) % 2 === 1;
    const ordered = swap ? [row.arms[1], row.arms[0]] : row.arms; return { caseId: row.caseId, category: row.category, question: row.question, expected: row.expected,
      responseA: ordered[0].response, responseB: ordered[1].response, reveal: { A: ordered[0].provider, B: ordered[1].provider } }; });
  fs.writeFileSync(blindPath, JSON.stringify({ schemaVersion: "hugo-blind-model-review-v1", evalRunId: config.evalRunId, blinded: true, cases: blinded }, null, 2) + "\n");
  console.log(JSON.stringify({ status: final.status, realCalls: final.realCalls, estimatedCostUsd: final.estimatedCostUsd, providers }, null, 2));
}

main().catch(error => { console.error(String(error?.message || error)); process.exitCode = 1; });
