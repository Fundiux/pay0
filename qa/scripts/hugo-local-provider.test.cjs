const assert = require("node:assert/strict");
const { OllamaLocalAdapter } = require("../../functions/lib/modules/agent007/ollamaLocalAdapter.js");
const keys = ["HUGO_OLLAMA_ENABLED", "HUGO_OLLAMA_BASE_URL", "HUGO_OLLAMA_ALLOW_PAY0_DATA"];
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const oldFetch = global.fetch;
const request = { schemaVersion: "hugo-model-request-v1", task: { userInput: "Prueba sintética", intent: "HEALTH", name: "Prueba" },
  conversation: { history: [], activeEntity: null }, intelligence: { contextSnapshot: {}, currentEvidence: {}, historicalMemories: [], historicalObservations: [], learningExperiences: [], evidenceBoundaries: {}, conflicts: [], allowedActions: [] },
  generation: { promptVersion: "hugo-v2", capability: "LOCAL" } };
(async () => {
  delete process.env.HUGO_OLLAMA_ENABLED;
  delete process.env.HUGO_OLLAMA_ALLOW_PAY0_DATA;
  let calls = 0;
  global.fetch = async url => { calls++; if (String(url).endsWith("/api/version")) return { ok: true, json: async () => ({ version: "test" }) };
    if (String(url).endsWith("/api/tags")) return { ok: true, json: async () => ({ models: [{ name: "llama3.2:3b" }] }) };
    return { ok: true, json: async () => ({ done: true, response: "SALUD_OK", prompt_eval_count: 4, eval_count: 2 }) }; };
  const adapter = new OllamaLocalAdapter();
  assert.equal((await adapter.probe()).status, "NOT_CONFIGURED");
  assert.equal((await adapter.generateCanonical(request)).error, "PROVIDER_NOT_CONFIGURED");
  assert.equal(calls, 0);
  process.env.HUGO_OLLAMA_ENABLED = "true";
  process.env.HUGO_OLLAMA_BASE_URL = "https://example.com";
  assert.equal((await adapter.probe()).status, "NOT_CONFIGURED");
  process.env.HUGO_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
  const healthy = await adapter.probe();
  assert.equal(healthy.status, "CONNECTED");
  assert.equal(healthy.dataAuthorized, false);
  const before = calls;
  assert.equal((await adapter.generateCanonical(request)).error, "PAY0_DATA_NOT_AUTHORIZED_FOR_LOCAL_MODEL");
  assert.equal(calls, before);
  process.env.HUGO_OLLAMA_ALLOW_PAY0_DATA = "true";
  assert.equal((await adapter.probe()).dataAuthorized, true);
  const generated = await adapter.generateCanonical(request);
  assert.equal(generated.answer, "SALUD_OK");
  assert.equal(generated.provider, "OLLAMA_LOCAL");
  console.log("PASS disabled default, loopback only, health, no PAY0 context without explicit gate, synthetic generation");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { for (const key of keys) original[key] === undefined ? delete process.env[key] : process.env[key] = original[key]; global.fetch = oldFetch; });
