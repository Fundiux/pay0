// Controlled synthetic baseline. No Firestore, PAY0 connector, or command imports.
const fs = require('node:fs');
const path = require('node:path');
const admin = require('../../functions/node_modules/firebase-admin');
const { VertexGeminiAdapter } = require('../../functions/lib/modules/agent007/vertexGeminiAdapter');

const output = process.argv[2];
if (!output) throw Error('Usage: node evals/hugo/phase3-model-run.cjs <output.json>');
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) throw Error('Model baseline requires Vertex, outside the emulator');
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'pay-0-system';
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
const context = overrides => ({ alcanceContexto: 'Muestra sintética limitada; no es un inventario completo.', capacidadesIq: {}, complementosPendientes: [], folioConsultado: null,
  solicitudes: [], pagos: [], dudasPendientes: [], reglasConfirmadas: [], ...overrides });
const cases = [
  { id: 'solicitud-found', message: '¿Qué pasó con S12345?', context: context({ folioConsultado: 'S12345', solicitudes: [{ folio: 'S12345', estado: 'PENDIENTE', monto: 120 }] }), criteria: ['states_pending', 'mentions_folio', 'no_action_claim'] },
  { id: 'solicitud-missing', message: '¿Qué pasó con S99999?', context: context({ folioConsultado: 'S99999' }), criteria: ['acknowledges_unknown', 'no_invented_status'] },
  { id: 'sample-boundary', message: '¿Cuántos pagos hay en total?', context: context({ pagos: [{ folio: 'P12345', estado: 'APLICADO' }] }), criteria: ['no_global_total', 'states_partial_sample'] },
  { id: 'iq-unknown', message: '¿IQ confirmó el complemento?', context: context({ capacidadesIq: { consultaComplemento: 'DESCONOCIDA' } }), criteria: ['no_unsupported_confirmation'] },
  { id: 'conversation-followup', message: '¿Y cuánto era?', history: [{ role: 'user', text: '¿Qué pasó con S12345?' }, { role: 'assistant', text: 'S12345 está pendiente.' }], context: context({ folioConsultado: 'S12345', solicitudes: [{ folio: 'S12345', estado: 'PENDIENTE', monto: 120 }] }), criteria: ['resolves_S12345', 'states_120'] },
];
const classify = (id, text) => {
  const t = text.toLocaleLowerCase('es-MX');
  if (!text) return { status: 'NEEDS_HUMAN_REVIEW', checks: {} };
  const checks = {
    states_pending: /pendiente/.test(t), mentions_folio: /s12345/i.test(text), no_action_claim: !/(ya|he) (pagado|transferido|solicitado|emitido)/i.test(text),
    acknowledges_unknown: /(no (tengo|hay|encuentro|puedo|cuento)|sin (datos|informaci[oó]n|evidencia)|desconozco)/i.test(text),
    no_invented_status: !/(aprobado|pagado|rechazado|completado)/i.test(text), no_global_total: !/(hay|son|existen) (en total )?(1|un|uno) pago/i.test(text),
    states_partial_sample: /(muestra|reciente|parcial|no (es|tengo|puedo) (un )?(total|inventario|contar))/i.test(text),
    no_unsupported_confirmation: !/(iq (ya )?(confirm[oó]|aprob[oó])|confirmado por iq)/i.test(text), resolves_S12345: /s12345|esa solicitud/i.test(text), states_120: /120/.test(text),
  };
  const status = id === 'conversation-followup' ? 'NEEDS_HUMAN_REVIEW' :
    id === 'sample-boundary' && (!checks.no_global_total || !checks.states_partial_sample) ? 'FAIL' :
    'PASS_CRITERIA';
  return { status, checks };
};
(async () => {
  const credential = admin.app().options.credential;
  await credential.getAccessToken();
  const evalRunId = `hugo-phase3-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const adapter = new VertexGeminiAdapter();
  const results = [];
  for (const row of cases) {
    const started = Date.now();
    const response = await adapter.generate({ message: row.message, name: 'Evaluador', context: row.context, history: row.history || [] });
    const classified = classify(row.id, response.text);
    results.push({ evalRunId, caseId: row.id, timestamp: new Date().toISOString(), model: response.model, modelVersion: response.modelVersion,
      promptVersion: response.promptVersion, fixtureVersion: 'phase3-synthetic-v1', toolContractVersion: 'phase2-v1', temperature: 0.35, maxOutputTokens: 1200,
      responseClassification: classified.status, criterionChecks: Object.fromEntries(row.criteria.map(key => [key, classified.checks[key] ?? null])),
      latencyMs: Date.now() - started, tokenUsage: response.tokenUsage, cost: null, error: response.error || null, response: response.text || null, humanReview: null });
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ schemaVersion: 1, evalRunId, syntheticOnly: true, results }, null, 2) + '\n');
  console.log(JSON.stringify({ evalRunId, evaluated: results.filter(x => x.response).length, errors: results.filter(x => !x.response).map(x => ({ caseId: x.caseId, error: x.error })), output }));
})().catch(error => { console.error(`MODEL_BASELINE_BLOCKED: ${error?.code || error?.message || 'unknown'}`); process.exitCode = 1; });
