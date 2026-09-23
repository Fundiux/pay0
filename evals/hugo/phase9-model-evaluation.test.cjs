const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const config = require("./phase9/frozen-config.json");
const dataset = require("./phase9/benchmark-cases.json");
const { classifyHugoRoutingSignals } = require("../../functions/lib/modules/agent007/hugoCore/runtimeContract.js");

test("frozen comparison records both exact providers and immutable conditions", () => {
  assert.equal(config.baselineCommit, "152de04");
  assert.deepEqual(config.providers.map(row => [row.id, row.model]), [["GOOGLE_VERTEX", "gemini-2.5-flash"], ["OPENAI", "gpt-6-sol"]]);
  assert.equal(config.retryPolicy, "no retry inside an A/B arm");
  assert.equal(config.fallbackPolicy, "disabled during A/B evaluation");
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "phase9/benchmark-cases.json"))).digest("hex"), config.datasetSha256);
});

test("benchmark covers six capabilities with DEVELOPMENT and VALIDATION only", () => {
  assert.equal(dataset.holdoutIncluded, false);
  assert.equal(dataset.cases.length, 18);
  assert.deepEqual(new Set(dataset.cases.map(row => row.category)), new Set(["CONVERSATION", "PAY0_OPERATION", "REASONING", "PROGRAMMING", "TOOLS", "SECURITY"]));
  assert(dataset.cases.every(row => ["DEVELOPMENT", "VALIDATION"].includes(row.split)));
  assert.equal(new Set(dataset.cases.map(row => row.id)).size, dataset.cases.length);
});

test("live runner requires explicit execution, confirmation and secret checks", () => {
  const source = fs.readFileSync(path.join(__dirname, "phase9/run-comparison.cjs"), "utf8");
  assert.match(source, /--execute/);
  assert.match(source, /HUGO_EVAL_CONFIRM/);
  assert.match(source, /NEXT_PUBLIC_OPENAI_API_KEY/);
  assert.match(source, /SECRET_EXPOSURE/);
  assert.doesNotMatch(source, /HOLDOUT[^\n]*execute/i);
});

test("OpenAI adapter uses the same Hugo v2 prompt builder and never exposes its key", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../functions/src/modules/agent007/openAiResponsesAdapter.ts"), "utf8");
  assert.match(source, /hugoV2Prompt/);
  assert.match(source, /process\.env\.OPENAI_API_KEY/);
  assert.doesNotMatch(source, /console\.(log|warn|error)[^\n]*OPENAI_API_KEY/);
});

test("brain routing signals keep cognitive capability separate from authorization", () => {
  const programming = classifyHugoRoutingSignals("diagnostica la arquitectura TypeScript");
  assert.equal(programming.profile, "PROGRAMMER");
  assert.equal(programming.complexity, "HIGH");
  assert.equal(programming.risk, "READ");
  const financial = classifyHugoRoutingSignals("reintenta la dispersión del pago");
  assert.equal(financial.risk, "EXTERNAL_SIDE_EFFECT");
});
