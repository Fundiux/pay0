// Isolated synthetic Vertex diagnostic. No Firestore reads or learning export.
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) throw Error('Isolated model diagnostic required');
const fs = require('node:fs');
const path = require('node:path');
const admin = require('../../../functions/node_modules/firebase-admin');
const { VertexGeminiAdapter } = require('../../../functions/lib/modules/agent007/vertexGeminiAdapter');
const cases = require('../phase4-dataset.cjs');
const row = cases.find(x => x.id === 'experience-relevant');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'pay-0-system' });
const compact = { ...row.v2Context, solicitudes: row.v2Context.solicitudes.slice(0, 1), pagos: [], complementosPendientes: [], observacionesHistoricasNoVerificadas: [],
  memoriasHistoricas: row.v2Context.memoriasHistoricas.map(x => ({ id: x.id, kind: x.kind, status: x.status, content: x.content })) };
(async () => {
  await admin.app().options.credential.getAccessToken();
  const adapter = new VertexGeminiAdapter(), variants = [{ name: 'original', context: row.v2Context, promptVersion: 'hugo-v2' },
    { name: 'compact-context', context: compact, promptVersion: 'hugo-v2' },
    { name: 'compact-context-legacy-prompt', context: compact, promptVersion: 'legacy-v1' }], results = [];
  for (const variant of variants) {
    const started = Date.now(); const response = await adapter.generate({ message: row.message, name: 'Evaluador', context: variant.context, history: [], promptVersion: variant.promptVersion });
    results.push({ name: variant.name, contextChars: JSON.stringify(variant.context).length, elapsedMs: Date.now() - started,
      model: response.model, promptVersion: response.promptVersion, error: response.error || null, completed: !!response.text, tokenUsage: response.tokenUsage,
      response: response.text });
    console.log(`${variant.name}: ${response.error || 'COMPLETE'}`);
  }
  const artifact = { schemaVersion: 'hugo-phase5-token-diagnostic-v1', syntheticOnly: true, sourceCaseId: row.id, maxOutputTokens: 1200,
    historicalFailure: 'MAX_TOKENS', variants: results, inferenceLimit: 'The adapter does not expose token usage for discarded MAX_TOKENS candidates or hidden reasoning; this comparison cannot isolate the cause.' };
  fs.writeFileSync(path.join(__dirname, 'phase5-token-diagnostic.json'), JSON.stringify(artifact, null, 2) + '\n');
})().catch(error => { console.error(`TOKEN_DIAGNOSTIC_BLOCKED: ${error?.code || error?.message || 'unknown'}`); process.exitCode = 1; });
