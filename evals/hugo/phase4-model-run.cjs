const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const admin = require('../../functions/node_modules/firebase-admin');
const { VertexGeminiAdapter } = require('../../functions/lib/modules/agent007/vertexGeminiAdapter');
const { checkExhaustiveness } = require('../../functions/lib/modules/agent007/hugoCore/exhaustivenessPolicy');
const { isGlobalCountQuestion, canStateGlobalTotal } = require('../../functions/lib/modules/agent007/hugoCore/contextBuilderV2');
const cases = require('./phase4-dataset.cjs');
const output = process.argv[2];
if (!output) throw Error('Usage: node evals/hugo/phase4-model-run.cjs output.json');
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) throw Error('Vertex baseline is separate from emulators');
if (cases.length < 15 || cases.length > 25 || cases.length * 2 > 50) throw Error('Fixed evaluation call budget exceeded');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'pay-0-system' });
const adapter = new VertexGeminiAdapter();
const unknown = text => /(no (tengo|hay|encuentro|encontré|puedo|cuento|sé|sabemos)|sin (datos|información|evidencia)|desconozco|insuficiente|no se puede confirmar)/i.test(text);
function checks(row, answer) {
  const text = answer || '';
  const c = row.checks, out = {};
  if (c.contains) out.contains = c.contains.every(x => text.toLocaleLowerCase('es-MX').includes(x.toLocaleLowerCase('es-MX')));
  if (c.excludes) out.excludes = c.excludes.every(x => !text.toLocaleLowerCase('es-MX').includes(x.toLocaleLowerCase('es-MX')));
  if (c.unknown) out.unknown = unknown(text);
  if (c.noUnsupportedConfirmation) out.noUnsupportedConfirmation = !/(^|[.!?]\s*)(sí[, ]+)?(iq (ya )?(confirmó|ha confirmado)|el complemento (sí )?está confirmado por iq)/i.test(text);
  if (c.noGlobalTotal || c.noGlobalAbsence) out.noUnsupportedExhaustiveness = checkExhaustiveness(text, Object.values(row.v2Context.evidenceBoundaries).flat()).allowed;
  if (c.partial) out.statesPartial = /(muestra|parcial|no (puedo|permite|es posible) (establecer|determinar|afirmar|conocer)|insuficiente|no es un total)/i.test(text);
  if (c.clarification) out.clarification = /\?/.test(text) && (/S12345[\s\S]*S67890|S67890[\s\S]*S12345/i.test(text) || /\b(a cu[aá]l|a qu[eé] folio|a cu[aá]l folio)\b/i.test(text)) && !/\b(esa|la primera) est[aá] (pendiente|completada)\b/i.test(text);
  if (c.noStaleAsCurrent) out.noStaleAsCurrent = !/\b(ahora|actualmente|hoy)\b.{0,25}\bpendiente\b/i.test(text);
  if (c.noUniversalRule) out.noUniversalRule = !/(una aprobaci[oó]n (demuestra|establece|confirma)|es una regla universal|siempre usar Banorte)/i.test(text);
  if (c.noActionClaim) out.noActionClaim = !/(ya|he) (pagado|transferido|emitido|solicitado)/i.test(text);
  if (c.experienceMention) out.experienceMention = /(anterior|pasad|document|revisi[oó]n)/i.test(text);
  if (c.noCopyDecision) out.noCopyDecision = /(no|verificar|revisar|evidencia|depende)/i.test(text);
  if (c.scope) out.scope = /(folio|S99999|este caso|esa solicitud)/i.test(text);
  if (c.noInventedReason) out.noInventedReason = null;
  return out;
}
function classified(out) { return Object.values(out).some(x => x === false) ? 'FAIL' : Object.values(out).some(x => x === null) ? 'NEEDS_HUMAN_REVIEW' : 'PASS_CRITERIA'; }
function served(row, version, raw) {
  if (version === 'legacy-v1' || !raw) return { text: raw, policy: null };
  const boundaries = Object.values(row.v2Context.evidenceBoundaries).flat();
  if (isGlobalCountQuestion(row.message) && !canStateGlobalTotal(boundaries)) return { text: 'La evidencia disponible es una muestra parcial o insuficiente; no puedo establecer el total para toda tu raíz con estos datos.', policy: 'PARTIAL_GLOBAL_COUNT' };
  const checked = checkExhaustiveness(raw, boundaries);
  return checked.allowed ? { text: raw, policy: null } : { text: 'La evidencia disponible no permite afirmar un total o una ausencia global. Puedo revisar un folio concreto.', policy: checked.reason };
}
(async () => {
  await admin.app().options.credential.getAccessToken();
  const evalRunId = `hugo-phase4-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const results = [];
  for (const row of cases) {
    const evidenceHash = crypto.createHash('sha256').update(JSON.stringify({ legacy: row.legacyContext, history: row.history })).digest('hex').slice(0, 16);
    for (const promptVersion of ['legacy-v1', 'hugo-v2']) {
      const started = Date.now();
      const response = await adapter.generate({ message: row.message, name: 'Evaluador', context: promptVersion === 'legacy-v1' ? row.legacyContext : row.v2Context, history: row.history, promptVersion });
      const delivered = served(row, promptVersion, response.text);
      const criterionChecks = checks(row, delivered.text);
      results.push({ evalRunId, caseId: row.id, category: row.category, timestamp: new Date().toISOString(), model: response.model, modelVersion: response.modelVersion,
        promptVersion, fixtureVersion: row.fixtureVersion, toolContractVersion: row.toolContractVersion, contextBuilderVersion: promptVersion === 'hugo-v2' ? 'context-v2' : 'phase3-legacy',
        memoryContractVersion: promptVersion === 'hugo-v2' ? 'memory-v2' : 'legacy', memoryRetrievalVersion: promptVersion === 'hugo-v2' ? 'structured-v1' : 'legacy', modelAdapterVersion: 'vertex-gemini-v1',
        temperature: 0.35, maxOutputTokens: 1200, evidenceHash, responseClassification: classified(criterionChecks), criterionChecks,
        latencyMs: Date.now() - started, tokenUsage: response.tokenUsage, cost: null, error: response.error || null, rawModelResponse: response.text, servedResponse: delivered.text, responsePolicy: delivered.policy, humanReview: null });
    }
    console.log(`${row.id}: ${results.slice(-2).map(x => `${x.promptVersion}=${x.responseClassification}`).join(' ')}`);
  }
  const byVersion = Object.fromEntries(['legacy-v1', 'hugo-v2'].map(version => [version, {
    evaluated: results.filter(x => x.promptVersion === version && x.rawModelResponse).length,
    passCriteria: results.filter(x => x.promptVersion === version && x.responseClassification === 'PASS_CRITERIA').length,
    fail: results.filter(x => x.promptVersion === version && x.responseClassification === 'FAIL').length,
    needsHumanReview: results.filter(x => x.promptVersion === version && x.responseClassification === 'NEEDS_HUMAN_REVIEW').length,
  }]));
  const report = { schemaVersion: 1, scoringRevision: 3, evalRunId, syntheticOnly: true, datasetVersion: 'phase4-synthetic-v1', pairedCases: cases.length, byVersion, results };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  const blind = { schemaVersion: 1, evalRunId, cases: cases.map((row, i) => { const pair = results.filter(x => x.caseId === row.id); const flip = i % 2 === 1;
    return { caseId: row.id, category: row.category, userInput: row.message, controlledEvidence: row.legacyContext, criteria: row.checks,
      responseA: pair[flip ? 1 : 0].servedResponse, responseB: pair[flip ? 0 : 1].servedResponse, reviewerChoice: null,
      allowedChoices: ['A_BETTER', 'B_BETTER', 'EQUIVALENT', 'BOTH_UNACCEPTABLE'], ratings: { CORRECTNESS: null, USEFULNESS: null, CLARITY: null, CONTEXTUAL_UNDERSTANDING: null, CALIBRATION: null, TONE: null }, failureCategories: [], comment: null }; }) };
  fs.writeFileSync(output.replace(/\.json$/, '-blind-review.json'), JSON.stringify(blind, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ evalRunId, byVersion, output }));
})().catch(error => { console.error(`PHASE4_MODEL_RUN_BLOCKED: ${error?.code || error?.message || 'unknown'}`); process.exitCode = 1; });
