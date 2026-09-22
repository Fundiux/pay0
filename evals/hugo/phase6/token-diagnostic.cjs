// Live synthetic diagnostic using the current production adapter and unchanged output limit.
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) throw Error('LIVE_MODEL_REQUIRED');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const admin = require('../../../functions/node_modules/firebase-admin');
const { VertexGeminiAdapter } = require('../../../functions/lib/modules/agent007/vertexGeminiAdapter');
const cases = require('../phase4-dataset.cjs');
const row = cases.find(x => x.id === 'experience-relevant');
const compact = { ...row.v2Context, solicitudes: row.v2Context.solicitudes.slice(0, 1), pagos: [], complementosPendientes: [],
  observacionesHistoricasNoVerificadas: [], memoriasHistoricas: row.v2Context.memoriasHistoricas.map(x => ({ id: x.id, kind: x.kind, status: x.status, content: x.content })) };
async function main() {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'pay-0-system' });
  await admin.app().options.credential.getAccessToken();
  const adapter = new VertexGeminiAdapter(), results = [];
  for (const repeat of [1, 2]) for (const variant of [{ name: 'original', context: row.v2Context }, { name: 'compact', context: compact }]) {
    const started = performance.now(); const response = await adapter.generate({ message: row.message, name: 'Evaluador', context: variant.context, history: [], promptVersion: 'hugo-v2' });
    results.push({ repeat, variant: variant.name, contextChars: JSON.stringify(variant.context).length,
      memoryChars: JSON.stringify(variant.context.memoriasHistoricas || []).length, experienceChars: JSON.stringify(variant.context.learningExperiences || []).length,
      latencyMs: Math.round(performance.now() - started), finish: response.error || 'COMPLETE', attempts: response.attempts || [],
      tokenUsage: response.tokenUsage, outputChars: response.text?.length || 0, response: response.text });
    console.log(`repeat ${repeat} ${variant.name}: ${response.error || 'COMPLETE'}`);
  }
  fs.writeFileSync(path.join(__dirname, 'phase6-token-diagnostic.json'), JSON.stringify({ schemaVersion: 'hugo-phase6-token-v1', syntheticOnly: true,
    historicalPhase4Failure: 'MAX_TOKENS', maxOutputTokens: 1200, unchangedModelConfiguration: true,
    inferenceLimit: 'No Phase 4 discarded-candidate usage was recorded; absence of a new MAX_TOKENS failure cannot isolate its original cause.', results }, null, 2) + '\n');
}
main().catch(error => { console.error(`PHASE6_TOKEN_DIAGNOSTIC_BLOCKED: ${error?.name || 'unknown'}`); process.exitCode = 1; });
