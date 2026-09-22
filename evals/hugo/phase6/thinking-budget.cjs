// Isolated Vertex diagnostic. It does not modify production model configuration.
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) throw Error('LIVE_MODEL_REQUIRED');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const admin = require('../../../functions/node_modules/firebase-admin');
const { hugoV2Prompt } = require('../../../functions/lib/modules/agent007/hugoCore/hugoV2Prompt');
const cases = require('../phase4-dataset.cjs');
const row = cases.find(x => x.id === 'experience-relevant');
const context = { ...row.v2Context, solicitudes: row.v2Context.solicitudes.slice(0, 1), pagos: [], complementosPendientes: [],
  observacionesHistoricasNoVerificadas: [], memoriasHistoricas: row.v2Context.memoriasHistoricas.map(x => ({ id: x.id, kind: x.kind, status: x.status, content: x.content })) };
const { system, prompt } = hugoV2Prompt(row.message, 'Evaluador', context, []);
async function main() {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'pay-0-system' });
  const endpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${process.env.GCLOUD_PROJECT || 'pay-0-system'}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;
  const results = [];
  for (let repeat = 1; repeat <= 2; repeat++) {
    const token = await admin.app().options.credential.getAccessToken(), started = performance.now();
    const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 512 } } }), signal: AbortSignal.timeout(35_000) });
    if (!response.ok) { results.push({ repeat, error: `HTTP_${response.status}`, latencyMs: Math.round(performance.now() - started) }); console.log(`repeat ${repeat}: HTTP_${response.status}`); continue; }
    const payload = await response.json(), candidate = payload.candidates?.[0];
    results.push({ repeat, finishReason: candidate?.finishReason || null, latencyMs: Math.round(performance.now() - started),
      inputTokens: payload.usageMetadata?.promptTokenCount ?? null, outputTokens: payload.usageMetadata?.candidatesTokenCount ?? null,
      reasoningTokens: payload.usageMetadata?.thoughtsTokenCount ?? null,
      response: candidate?.content?.parts?.map(part => part.text || '').join('') || null });
    console.log(`repeat ${repeat}: ${results.at(-1).finishReason}`);
  }
  fs.writeFileSync(path.join(__dirname, 'phase6-thinking-budget.json'), JSON.stringify({ schemaVersion: 'hugo-phase6-thinking-v1', syntheticOnly: true,
    caseId: row.id, contextChars: JSON.stringify(context).length, promptVersion: 'hugo-v2', model: 'gemini-2.5-flash',
    experimentOnly: true, maxOutputTokens: 1200, thinkingBudget: 512, results }, null, 2) + '\n');
}
main().catch(error => { console.error(`THINKING_BUDGET_BLOCKED: ${error?.name || 'unknown'}`); process.exitCode = 1; });
