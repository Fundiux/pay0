const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(process.env.HUGO_TEST_FUNCTIONS_ROOT || 'functions');
const localRequire = createRequire(path.join(root, 'package.json'));
const { Firestore } = localRequire('firebase-admin/firestore');
const { initializeApp, getApps } = localRequire('firebase-admin/app');
const { OpenAiResponsesAdapter } = localRequire('./lib/modules/agent007/openAiResponsesAdapter');
const { VertexGeminiAdapter } = localRequire('./lib/modules/agent007/vertexGeminiAdapter');
const { FirestoreHugoDataStore } = localRequire('./lib/modules/agent007/firestoreHugoDataStore');
const request = { schemaVersion: 'hugo-model-request-v1', task: { userInput: 'Hola', intent: 'GENERAL', name: 'Prueba' }, conversation: { history: [] }, intelligence: { contextSnapshot: {}, currentEvidence: {}, historicalMemories: [], historicalObservations: [], learningExperiences: [], evidenceBoundaries: {}, conflicts: [], allowedActions: [] }, generation: { promptVersion: 'hugo-v2', capability: 'STRONG_EXTERNAL' } };

async function persist(usage) {
  const db = new Firestore({ projectId: 'demo-hugo-offline' });
  let committed = false;
  const originalBatch = db.batch.bind(db);
  db.batch = () => {
    const batch = originalBatch(); // Real SDK validates every write before commit.
    batch.commit = async () => { committed = true; return []; }; // Never connects.
    return batch;
  };
  await new FirestoreHugoDataStore(db).saveTurn({ rootId: 'root-test', uid: 'actor-test', conversationId: 'root-test_actor-test', text: 'Hola', reply: 'Hola', source: 'MODEL', capabilityExecuted: false, contextSummary: {}, recentEntities: [], traceId: 'trace-test', trace: { tokenUsage: usage, auditZero: 0, auditFalse: false, auditNull: null } });
  assert.equal(committed, true);
}

for (const provider of ['OPENAI', 'GOOGLE_VERTEX', 'GOOGLE_VERTEX_RETRY']) {
  for (const [label, raw, expected] of [
    ['missing details', { input: 7, output: 2 }, { input: 7, output: 2 }],
    ['no usage', {}, {}],
    ['zero details', { input: 0, output: 0, cachedInput: 0, reasoning: 0 }, { input: 0, output: 0, cachedInput: 0, reasoning: 0 }],
    ['null details', { input: 7, output: 2, cachedInput: null, reasoning: null }, { input: 7, output: 2, cachedInput: null, reasoning: null }],
  ]) {
    test(`${provider}: ${label} survives real Firestore write validation`, async () => {
      const priorFetch = global.fetch;
      const priorEnv = { ...process.env };
      process.env.HUGO_OPENAI_ENABLED = 'true';
      process.env.OPENAI_API_KEY = 'synthetic-test-only';
      delete process.env.FIRESTORE_EMULATOR_HOST;
      delete process.env.FUNCTIONS_EMULATOR;
      if (!getApps().length) initializeApp({ projectId: 'demo-hugo-offline', credential: { getAccessToken: async () => ({ access_token: 'synthetic-test-only', expires_in: 3600 }) } });
      let calls = 0;
      global.fetch = async () => ({ ok: true, json: async () => provider === 'OPENAI' ? {
        output_text: 'Hola', usage: { input_tokens: raw.input, output_tokens: raw.output, input_tokens_details: { cached_tokens: raw.cachedInput }, output_tokens_details: { reasoning_tokens: raw.reasoning } },
      } : { candidates: [{ finishReason: provider === 'GOOGLE_VERTEX_RETRY' && calls++ === 0 ? 'MAX_TOKENS' : 'STOP', content: { parts: [{ text: 'Hola' }] } }], usageMetadata: { promptTokenCount: raw.input, candidatesTokenCount: raw.output, cachedContentTokenCount: raw.cachedInput, thoughtsTokenCount: raw.reasoning } } });
      try {
        const adapter = provider === 'OPENAI' ? new OpenAiResponsesAdapter() : new VertexGeminiAdapter();
        const result = await adapter.generateCanonical(request);
        assert.equal(result.text, 'Hola');
        await persist(result.tokenUsage);
        assert.deepEqual(result.tokenUsage, expected);
        if (provider === 'GOOGLE_VERTEX_RETRY') assert.equal(calls, 2);
      } finally { global.fetch = priorFetch; process.env = priorEnv; }
    });
  }
}

test('real Firestore validation reproduces the original undefined failure', async () => {
  await assert.rejects(persist({ input: 7, output: 2, cachedInput: undefined }), /tokenUsage.cachedInput/);
});
