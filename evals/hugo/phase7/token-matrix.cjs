// Eval-only token matrix. It never changes the production adapter configuration.
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) throw Error('LIVE_MODEL_REQUIRED');
const fs = require('node:fs'); const path = require('node:path'); const { performance } = require('node:perf_hooks');
const admin = require('../../../functions/node_modules/firebase-admin');
const { hugoV2Prompt } = require('../../../functions/lib/modules/agent007/hugoCore/hugoV2Prompt');
const compactExperience = { id: 'p7_token_experience', scope: { rootId: 'phase7-synthetic-root', domain: 'SOLICITUDES', taskType: 'REASON', entityType: 'SOLICITUD' }, situation: { entityType: 'SOLICITUD', status: 'EN_REVISION', issueCode: 'LOCAL_TOKEN_A' }, expectedBehavior: 'VERIFY_DOCUMENT_VERSION_BEFORE_DECISION', correction: { originalBehavior: 'COPY_PRIOR_ACTION', correctedBehavior: 'VERIFY_DOCUMENT_VERSION_BEFORE_DECISION', reasonCode: 'OUTCOME_SUPPORTED_CORRECTION' }, outcome: { type: 'VERIFIED_SUCCESS', verified: true }, historical: true };
const fullExperience = { ...compactExperience, revision: 4, state: 'VERIFIED', entityReferences: [{ sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: 'prior_token' }], createdFrom: { memoryId: 'memory_token', observationId: 'observation_token', decisionId: 'decision_token', outcomeId: 'outcome_token', traceId: null }, corrections: [compactExperience.correction], governance: { internalTrainingAuthorization: 'REVIEW_REQUIRED', externalProviderAuthorization: 'NOT_APPROVED' }, audit: { revisions: [1,2,3,4], lineagePreserved: true } };
const configs = [
  { id: 'baseline-compact-1200', representation: 'COMPACT', thinkingBudget: null, outputLimit: 1200, noiseCount: 0 },
  { id: 'bounded512-compact-1200', representation: 'COMPACT', thinkingBudget: 512, outputLimit: 1200, noiseCount: 0 },
  { id: 'bounded256-compact-1200', representation: 'COMPACT', thinkingBudget: 256, outputLimit: 1200, noiseCount: 0 },
  { id: 'bounded512-compact-800', representation: 'COMPACT', thinkingBudget: 512, outputLimit: 800, noiseCount: 0 },
  { id: 'bounded512-full-1200', representation: 'FULL', thinkingBudget: 512, outputLimit: 1200, noiseCount: 0 },
  { id: 'bounded512-compact-noisy-1200', representation: 'COMPACT', thinkingBudget: 512, outputLimit: 1200, noiseCount: 35 },
];
function context(config) { const noise = Array.from({ length: config.noiseCount }, (_, i) => ({ id: `noise_${i}`, kind: 'OBSERVATION', status: 'HISTORICAL', content: `Synthetic unrelated historical observation ${i} with no authority over current facts.` })); return { schemaVersion: 'hugo-context-v2', questionIntent: 'REASON', folioConsultado: 'S71999', solicitudes: [{ id: 'current_token', folio: 'S71999', estado: 'EN_REVISION', monto: 120, issueCode: 'LOCAL_TOKEN_A' }], pagos: [], memoriasHistoricas: [], observacionesHistoricasNoVerificadas: noise, learningExperiences: [config.representation === 'FULL' ? fullExperience : compactExperience], evidenceBoundaries: { currentEntity: { completeness: 'COMPLETE', scope: 'S71999' } } }; }
async function main() {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'pay-0-system' });
  const project = process.env.GCLOUD_PROJECT || 'pay-0-system', endpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`, results = [];
  for (const config of configs) for (let repeat = 1; repeat <= 3; repeat++) {
    const ctx = context(config), { system, prompt } = hugoV2Prompt('Por que S71999 esta en revision? Indica que comprobar antes de actuar.', 'Evaluador', ctx, []);
    const generationConfig = { temperature: 0.35, maxOutputTokens: config.outputLimit };
    if (config.thinkingBudget != null) generationConfig.thinkingConfig = { thinkingBudget: config.thinkingBudget };
    const token = await admin.app().options.credential.getAccessToken(), started = performance.now();
    try { const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }), signal: AbortSignal.timeout(35_000) });
      if (!response.ok) { results.push({ ...config, repeat, contextChars: JSON.stringify(ctx).length, error: `HTTP_${response.status}`, latencyMs: Math.round(performance.now()-started) }); }
      else { const payload = await response.json(), candidate = payload.candidates?.[0]; results.push({ ...config, repeat, contextChars: JSON.stringify(ctx).length, finishReason: candidate?.finishReason || null, latencyMs: Math.round(performance.now()-started), inputTokens: payload.usageMetadata?.promptTokenCount ?? null, outputTokens: payload.usageMetadata?.candidatesTokenCount ?? null, reasoningTokens: payload.usageMetadata?.thoughtsTokenCount ?? null, behaviorPresent: /versi[oó]n.*documento/i.test(candidate?.content?.parts?.map(part=>part.text||'').join('') || ''), response: candidate?.content?.parts?.map(part=>part.text||'').join('') || null }); }
    } catch (error) { results.push({ ...config, repeat, contextChars: JSON.stringify(ctx).length, error: /abort|timeout/i.test(error?.name || '') ? 'TIMEOUT' : 'SERVICE_UNAVAILABLE', latencyMs: Math.round(performance.now()-started) }); }
    process.stdout.write(`${config.id} ${repeat}: ${results.at(-1).error || results.at(-1).finishReason}\n`);
  }
  fs.writeFileSync(path.join(__dirname, 'phase7-token-matrix.json'), JSON.stringify({ schemaVersion: 'hugo-phase7-token-matrix-v1', syntheticOnly: true, productionConfigChanged: false, matrixFrozenBeforeCalls: true, results }, null, 2) + '\n');
}
main().catch(error => { console.error(error?.message || error); process.exitCode = 1; });
