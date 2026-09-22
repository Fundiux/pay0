// Isolated synthetic comparison. Does not change Hugo's production adapter or model configuration.
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) throw Error('REAL_MODEL_REQUIRED');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const admin = require('../../../functions/node_modules/firebase-admin');
const { hugoV2Prompt } = require('../../../functions/lib/modules/agent007/hugoCore/hugoV2Prompt');
const run = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase6-real-model-results.json'), 'utf8'));
const family = run.families.find(row => row.id === 'duplicate-document');
const arm = family.arms[1];
const context = { schemaVersion: 'context-v2', questionIntent: 'REASON', folioConsultado: family.folio, activeEntity: { type: family.entityType, folio: family.folio },
  solicitudes: arm.contextSnapshot.currentFacts.solicitudes, pagos: arm.contextSnapshot.currentFacts.pagos,
  evidenceBoundaries: arm.contextSnapshot.boundaries, learningExperiences: arm.contextSnapshot.learningExperiences,
  memoriasHistoricas: [], observacionesHistoricasNoVerificadas: [], complementosPendientes: [], capacidadesIq: {}, dudasPendientes: [] };
const message = `¿Por qué ${family.folio} está en ${family.status.toLowerCase()}? Indica qué comprobarías antes de actuar.`;
const { system, prompt } = hugoV2Prompt(message, 'Evaluador', context, []);
const schema = { type: 'OBJECT', properties: { answer: { type: 'STRING' }, claims: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
  text: { type: 'STRING' }, evidenceIds: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['text', 'evidenceIds'] } },
  uncertainties: { type: 'ARRAY', items: { type: 'STRING' } }, referencedEntities: { type: 'ARRAY', items: { type: 'STRING' } },
  experienceReferences: { type: 'ARRAY', items: { type: 'STRING' } }, proposedActions: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['answer', 'claims', 'uncertainties', 'referencedEntities', 'experienceReferences', 'proposedActions'] };
async function call(token, structured) {
  const started = performance.now(), project = process.env.GCLOUD_PROJECT || 'pay-0-system';
  const endpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;
  const variantSystem = structured ? `${system} Devuelve un objeto JSON interno; cada afirmación objetiva debe citar IDs de evidencia disponibles. El campo answer debe ser español natural.` : system;
  const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: variantSystem }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.35, maxOutputTokens: 1200, ...(structured ? { responseMimeType: 'application/json', responseSchema: schema } : {}) } }),
    signal: AbortSignal.timeout(35_000) });
  if (!response.ok) return { structured, error: `HTTP_${response.status}`, latencyMs: Math.round(performance.now() - started) };
  const payload = await response.json(), candidate = payload.candidates?.[0], text = candidate?.content?.parts?.map(part => part.text || '').join('') || '';
  const result = { structured, error: null, finishReason: candidate?.finishReason || null, latencyMs: Math.round(performance.now() - started),
    tokenUsage: { input: payload.usageMetadata?.promptTokenCount ?? null, output: payload.usageMetadata?.candidatesTokenCount ?? null,
      reasoning: payload.usageMetadata?.thoughtsTokenCount ?? null }, response: text };
  if (structured && text) { try { const parsed = JSON.parse(text), allowed = new Set([family.folio, family.issueCode, family.priorExperienceId]);
      result.validation = { jsonParsed: true, hasAnswer: typeof parsed.answer === 'string', claims: Array.isArray(parsed.claims) ? parsed.claims.length : null,
        unknownEvidenceIds: (parsed.claims || []).flatMap(claim => claim.evidenceIds || []).filter(id => !allowed.has(id)),
        unknownEntities: (parsed.referencedEntities || []).filter(id => id !== family.folio),
        unknownExperiences: (parsed.experienceReferences || []).filter(id => id !== family.priorExperienceId),
        experienceReferenced: (parsed.experienceReferences || []).includes(family.priorExperienceId) }; }
    catch { result.validation = { jsonParsed: false }; } }
  return result;
}
async function main() { admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'pay-0-system' });
  const credential = admin.app().options.credential, results = [];
  for (const structured of [false, true]) { results.push(await call(await credential.getAccessToken(), structured)); console.log(structured ? 'structured' : 'freeform', results.at(-1).error || results.at(-1).finishReason); }
  fs.writeFileSync(path.join(__dirname, 'phase6-structured-response.json'), JSON.stringify({ schemaVersion: 'hugo-phase6-structured-v1', syntheticOnly: true,
    caseId: family.id, contextSnapshotDigest: require('node:crypto').createHash('sha256').update(JSON.stringify(context)).digest('hex'),
    model: 'gemini-2.5-flash', maxOutputTokens: 1200, temperature: 0.35, results }, null, 2) + '\n'); }
main().catch(error => { console.error(`STRUCTURED_EXPERIMENT_BLOCKED: ${error?.name || 'unknown'}`); process.exitCode = 1; });
